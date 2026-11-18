import { type Expression, sql, type Transaction } from "kysely";
import { jsonObjectFrom } from "kysely/helpers/postgres";
import type { DB } from "../next-database.d.ts";
import { asText } from "../reader.ts";
import type { BoardInputs, Scope } from "./board.ts";
import { CLOSED_PHASES, ENDED_PHASES } from "./shared.ts";

type BoardList = "open" | "closed" | "lost";
// Today's board groups by brand and owner as they stand on the partners' calendar day.
const covers = (from: Expression<string>, to: Expression<string | null>) =>
	sql<boolean>`daterange(${from}, ${to}) @> (now() at time zone 'America/Chicago')::date`;

// What the board and the deal page both show of a deal. A deal can have no client yet.
export const selectNextDeals = (db: Transaction<DB>) =>
	db
		.selectFrom("deal as d")
		.leftJoin("deal_party as c", (join) =>
			join.onRef("c.deal_id", "=", "d.id").on("c.role", "=", "client"),
		)
		.leftJoin("party as cp", "cp.id", "c.party_id")
		.innerJoin("app_user as owner", "owner.id", "d.owner_user_id")
		.leftJoin("app_user as parker", "parker.id", "d.parked_by_user_id")
		.leftJoin("imported_deal_board as imported", "imported.deal_id", "d.id")
		.leftJoinLateral(
			(eb) =>
				eb
					.selectFrom("deal_phase_change as pc")
					.select([
						"pc.phase",
						"pc.happened_at",
						"pc.reason",
						"pc.changed_at",
						"pc.changed_by_job",
					])
					.whereRef("pc.deal_id", "=", "d.id")
					.orderBy("pc.happened_at", "desc")
					.limit(1)
					.as("p"),
			(join) => join.onTrue(),
		)
		.leftJoinLateral(
			(eb) =>
				eb
					.selectFrom("deal_phase_change as pc")
					.select("pc.happened_at")
					.whereRef("pc.deal_id", "=", "d.id")
					.where("pc.phase", "=", "closed")
					.where("p.phase", "in", CLOSED_PHASES)
					.orderBy("pc.happened_at", "desc")
					.limit(1)
					.as("last_close"),
			(join) => join.onTrue(),
		)
		.leftJoinLateral(
			(eb) =>
				eb
					.selectFrom("client_brand as b")
					.innerJoin("national_account as na", "na.party_id", "b.brand_id")
					.innerJoin("party as ap", "ap.id", "na.party_id")
					.leftJoin("national_account_owner as o", (join) =>
						join
							.onRef("o.account_id", "=", "na.party_id")
							.on((eb) => covers(eb.ref("o.started_on"), eb.ref("o.ended_on"))),
					)
					.leftJoin("app_user as ao", "ao.id", "o.owner_id")
					.select([
						"na.party_id as account_client_id",
						"ap.name as account_name",
						"ao.slug as account_owner",
					])
					.whereRef("b.location_id", "=", "c.party_id")
					.where((eb) => covers(eb.ref("b.started_on"), eb.ref("b.ended_on")))
					.as("a"),
			(join) => join.onTrue(),
		)
		.select((eb) => {
			const importedHistory = eb.and([
				eb("imported.phase", "is not", null),
				eb(
					"imported.phase_at",
					"is not distinct from",
					eb.ref("p.happened_at"),
				),
			]);
			return [
				eb
					.case()
					.when(importedHistory)
					.then(eb.ref("imported.phase"))
					.else(eb.ref("p.phase"))
					.end()
					.as("phase"),
				sql<
					"won" | "lost" | null
				>`case when ${importedHistory} then imported.outcome
					when p.phase = 'dead' then 'lost' when last_close.happened_at is not null then 'won' end`.as(
					"outcome",
				),
				sql<string | null>`(case when ${importedHistory} then imported.closed_on
					when p.phase = 'dead' then (p.happened_at at time zone 'America/Chicago')::date
					else (last_close.happened_at at time zone 'America/Chicago')::date end)::text`.as(
					"closed_on",
				),
				sql<string | null>`case when p.phase = 'dead' then p.reason end`.as(
					"lost_reason",
				),
				"d.id",
				"d.name",
				// Today's one deal type is the kind, else the reason, under its old slug.
				sql<
					string | null
				>`coalesce(d.kind, case d.reason when 'start_up' then 'startup' else d.reason end)`.as(
					"type",
				),
				"owner.slug as owner",
				"d.needs_attention as attention",
				"c.party_id as client_id",
				"cp.name as client_name",
				"a.account_client_id",
				"a.account_name",
				"a.account_owner",
				jsonObjectFrom(
					eb
						.selectFrom("invoice_email as invoice")
						.innerJoin("deal_phase_change as prior", (join) =>
							join
								.onRef("prior.deal_id", "=", "invoice.deal_id")
								.onRef("prior.happened_at", "=", "invoice.prior_phase_at"),
						)
						.select((eb) => [
							"invoice.id as event_id",
							"prior.phase as prior_phase",
							"p.phase",
							"p.reason",
							asText(eb.ref("invoice.email_date")).as("evidence_date"),
							asText(eb.ref("p.changed_at")).as("recorded_at"),
							sql.lit(true).as("automatic"),
						])
						.whereRef("invoice.deal_id", "=", "d.id")
						.whereRef("invoice.applied_phase_at", "=", "p.happened_at")
						.where("invoice.status", "=", "applied")
						.where("p.changed_by_job", "=", "lead_stage"),
				).as("phase_change"),
				eb
					.case()
					.when("a.account_client_id", "is", null)
					.then("team")
					.else("national_account")
					.end()
					.as("workspace_kind"),
				eb
					.case()
					.when("d.parking_reason", "is", null)
					.then("active")
					.else("parked")
					.end()
					.as("operating_state"),
				"d.parking_reason",
				"d.parking_note",
				asText(eb.ref("d.parked_at")).as("parked_at"),
				"parker.slug as parked_by",
			];
		})
		.select([
			sql<
				string | null
			>`(select invoiced_on::text from deal_invoiced where deal_id = d.id)`.as(
				"invoiced_on",
			),
			sql<
				string | null
			>`(select due_on::text from deal_next_date where deal_id = d.id)`.as(
				"next_date",
			),
			sql<string | null>`case when imported.deal_id is not null and not exists (
				select from change ch where ch.table_name = 'deal' and ch.record = jsonb_build_object('id', d.id)
				and ch.action = 'update' and ch.new_value ? 'market_id'
			) then imported.city else (select name from market where id = d.market_id) end`.as(
				"market",
			),
			sql<number>`(select coalesce(max(ch.id), 0)::float8 from change ch
				where ch.table_name = 'deal' and ch.record = jsonb_build_object('id', d.id))`.as(
				"seen",
			),
			sql<
				string | null
			>`(select (max(a.happened_at) at time zone 'America/Chicago')::date::text
				from activity_about ab join activity a on a.id = ab.activity_id
				where ab.deal_id = d.id and (a.kind in ('email', 'meeting') or a.kind = 'call' and a.reached))`.as(
				"last_touch",
			),
			sql<string | null>`(select what from next_step
				where deal_id = d.id and status = 'open' and item_title is null
				order by created_at desc, id desc limit 1)`.as("next_step"),
			sql`(select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.item_title,
				'status', s.status, 'due_on', s.due_on, 'bullets', s.item_bullets, 'source_ref', s.source_ref)
				order by s.created_at, s.id), '[]') from next_step s
				where s.deal_id = d.id and s.item_title is not null and s.status not in ('cancelled', 'expired'))`.as(
				"items",
			),
			sql`(select coalesce(jsonb_object_agg(phase, started_on), '{}') from (
				select phase, min((happened_at at time zone 'America/Chicago')::date) as started_on
				from deal_phase_change where deal_id = d.id group by phase
			) dates)`.as("phase_started_on"),
			sql<
				string | null
			>`(select p.name from deal_party dp join party p on p.id = dp.party_id
				where dp.deal_id = d.id and dp.role = 'market_agent'
				order by dp.created_at desc, dp.party_id limit 1)`.as("market_agent"),
			sql`(select coalesce(jsonb_agg(to_jsonb(vendor) - 'name' order by vendor.role, vendor.name, vendor.party_id), '[]') from (
				select dp.role, dp.party_id, p.name,
					case when p.kind = 'company' then jsonb_build_object('name', p.name)
						else (select jsonb_build_object('name', company.name) from party_company pc
							join party company on company.id = pc.company_id where pc.person_id = p.id
							and pc.ended_on is null order by pc.started_on desc nulls last, pc.id limit 1) end as company,
					case when p.kind = 'person' then jsonb_build_object('name', p.name,
						'email', (select address from party_email where party_id = p.id and is_primary),
						'phone', (select concat(number, ' x' || extension) from party_phone where party_id = p.id and is_primary)) end as contact
				from deal_party dp join role r on r.slug = dp.role join party p on p.id = dp.party_id
				where dp.deal_id = d.id and r.category_of = 'vendor'
			) vendor)`.as("vendors"),
		]);

function nextBoardQuery(
	db: Transaction<DB>,
	{ workspace, account }: Scope,
	list: BoardList = "open",
) {
	const rows = selectNextDeals(db)
		.where("c.party_id", "is not", null)
		.$if(workspace !== "all", (q) =>
			q.where(
				"a.account_client_id",
				workspace === "team" ? "is" : "is not",
				null,
			),
		)
		.$if(account !== null, (q) => q.where("a.account_client_id", "=", account));

	return db
		.selectFrom(rows.as("board"))
		.selectAll()
		.$if(list === "open", (q) =>
			q
				.where("outcome", "is", null)
				.where("closed_on", "is", null)
				.where("invoiced_on", "is", null)
				.where((eb) =>
					eb.or([eb("phase", "is", null), eb("phase", "not in", ENDED_PHASES)]),
				)
				.orderBy("attention", "desc")
				.orderBy("next_date", (o) => o.asc().nullsLast()),
		)
		.$if(list === "closed", (q) =>
			q
				.where("outcome", "is distinct from", "lost")
				.where((eb) =>
					eb.or([
						eb("phase", "in", CLOSED_PHASES),
						eb("outcome", "=", "won"),
						eb("closed_on", "is not", null),
						eb("invoiced_on", "is not", null),
					]),
				),
		)
		.$if(list === "lost", (q) => q.where("outcome", "=", "lost"))
		.$if(list !== "open", (q) =>
			q.orderBy("closed_on", (o) => o.desc().nullsLast()),
		)
		.orderBy("name");
}

export const readNextBoardDeals = (
	db: Transaction<DB>,
	scope: Scope,
	list?: BoardList,
) => nextBoardQuery(db, scope, list).execute();

export async function readNextBoard(db: Transaction<DB>, input: BoardInputs) {
	const scope = {
		workspace: input.workspace ?? "all",
		account: input.account_client_id || null,
	};
	const deals = await nextBoardQuery(db, scope)
		.select([
			sql`(select coalesce(json_agg(action order by due_on nulls last, id), '[]') from (
				select s.id, u.slug as owner, s.due_on, 'next_action:' || s.id as item_id, s.what as description
				from next_step s left join app_user u on u.id = s.owner_party_id
				where s.deal_id = board.id and s.status = 'open' and s.item_title is null
				order by s.due_on nulls last, s.id limit 3
			) action)`.as("open_actions"),
			// Deal notes have their own section and did not feed the old card summary.
			sql`(select to_jsonb(latest) - 'id' from (
				select a.id, a.kind, a.summary, a.happened_at as occurred_at
				from activity_about ab join activity a on a.id = ab.activity_id
				where ab.deal_id = board.id and a.kind <> 'note'
				union all
				select id, 'completed_action', what, done_at
				from next_step where deal_id = board.id and status = 'done' and done_at is not null
				order by occurred_at desc, id desc limit 1
			) latest)`.as("last_step"),
		])
		.execute();
	const closed_deals = await readNextBoardDeals(db, scope, "closed");
	const lost_deals = await readNextBoardDeals(db, scope, "lost");
	// The client copy leaves prospects outside national_account.
	const { rows: accounts } = await sql`
		select na.party_id as account_client_id, p.name as account_name, u.slug as account_owner,
			(select min(value) from outside_id where party_id = na.party_id
				and source = 'old_system_ref' and value like 'C-%' having count(*) = 1) as account_client_ref,
			count(b.id) filter (where b.operating_state = 'active')::int as open_deals,
			count(b.id) filter (where b.operating_state = 'parked')::int as parked_deals,
			count(b.id) filter (where b.operating_state = 'active' and b.attention)::int as attention_deals,
			count(b.id) filter (where b.operating_state = 'active' and b.next_date::date < days.today)::int as overdue_deals,
			count(b.id) filter (where b.operating_state = 'active' and (b.last_touch is null or b.last_touch::date < days.today - 14))::int as stale_deals
		from national_account na join party p on p.id = na.party_id
		cross join (select (now() at time zone 'America/Chicago')::date as today) days
		left join national_account_owner o on o.account_id = na.party_id and daterange(o.started_on, o.ended_on) @> days.today
		left join app_user u on u.id = o.owner_id
		left join (${nextBoardQuery(db, { workspace: "all", account: null })}) b on b.account_client_id = na.party_id
		group by na.party_id, p.name, u.slug order by p.name`.execute(db);
	return {
		schema_version: "local-deals-board.v2",
		actor: input.partner,
		deals: deals.map((deal) => ({
			...deal,
			item_schema_version: "deal-items.v1",
			next_step_required: deal.next_step === null || deal.next_date === null,
		})),
		closed_deals,
		lost_deals,
		accounts,
		open_session: null,
	};
}
