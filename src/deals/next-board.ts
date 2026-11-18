import { type Expression, sql, type Transaction } from "kysely";
import type { DB } from "../next-database.d.ts";
import { asText } from "../reader.ts";
import type { Scope } from "./board.ts";

const CLOSED_PHASES = ["closed", "invoiced"];
const ENDED_PHASES = [...CLOSED_PHASES, "dead"];
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
					.select(["pc.phase", "pc.happened_at"])
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
					else (last_close.happened_at at time zone 'America/Chicago')::date end)::text`.as(
					"closed_on",
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
		});

export async function readNextBoardDeals(
	db: Transaction<DB>,
	{ workspace, account }: Scope,
	list: BoardList = "open",
) {
	const rows = selectNextDeals(db)
		.leftJoin("market as m", "m.id", "d.market_id")
		.leftJoin("deal_invoiced as invoice", "invoice.deal_id", "d.id")
		.select((eb) => [
			asText(eb.ref("invoice.invoiced_on")).as("invoiced_on"),
			sql<string | null>`case when imported.deal_id is not null and not exists (
					select from change ch where ch.table_name = 'deal' and ch.record = jsonb_build_object('id', d.id)
					and ch.action = 'update' and ch.new_value ? 'market_id'
				) then imported.city else m.name end`.as("market"),
			// The seen_change_id a save sends back; a float8 reads as a number, a bigint as text.
			sql<number>`(select coalesce(max(ch.id), 0)::float8 from change ch
				where ch.table_name = 'deal' and ch.record = jsonb_build_object('id', d.id))`.as(
				"seen",
			),
		])
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
				.orderBy("attention", "desc"),
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
		.orderBy("name")
		.execute();
}
