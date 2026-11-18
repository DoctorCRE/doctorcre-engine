import { type Expression, sql, type Transaction } from "kysely";
import { jsonArrayFrom, jsonObjectFrom } from "kysely/helpers/postgres";
import type { DB } from "../next-database.d.ts";
import { asText } from "../reader.ts";
import { checklistOf } from "./checklist.ts";
import { selectNextDeals } from "./next-board.ts";

const HISTORY_CAP = 500;

export async function readNextDealDetail(db: Transaction<DB>, deal: string) {
	const record = await selectNextDeals(db)
		.select((eb) => [
			sql.lit("deal-timeline.v1").as("schema_version"),
			sql.lit("deal-items.v1").as("item_schema_version"),
			"d.id as deal_id",
			"d.closed_value",
			"d.reason",
			asText(sql`(now() at time zone 'America/Chicago')::date`)
				.$notNull()
				.as("today"),
			jsonArrayFrom(
				eb
					.selectFrom("commission_payment as payment")
					.select((eb) => [
						"payment.id as commission_id",
						eb
							.case()
							.when("payment.received_on", "is not", null)
							.then("received")
							.else("unpaid")
							.end()
							.as("status"),
						asText(eb.ref("payment.received_on")).as("received_on"),
					])
					.whereRef("payment.deal_id", "=", "d.id")
					// A copied expected commission still leaves the receipt incomplete.
					.where((eb) =>
						eb.not(
							eb.exists(
								eb
									.selectFrom("commission")
									.select("deal_id")
									.whereRef("deal_id", "=", "payment.deal_id")
									.where("expected", "is not", null),
							),
						),
					)
					.orderBy("payment.id"),
			).as("commissions"),
			jsonArrayFrom(stepsOf(db, eb.ref("d.id"))).as("next_actions"),
			jsonArrayFrom(partiesOf(db, eb.ref("d.id"))).as("participants"),
			jsonArrayFrom(
				activityHistoryOf(db, eb.ref("d.id"))
					.where("a.kind", "<>", "note")
					.select((eb) => [
						"a.summary",
						asText(eb.ref("a.happened_at")).as("occurred_at"),
					]),
			).as("activities"),
			jsonArrayFrom(
				activityHistoryOf(db, eb.ref("d.id"))
					.where("a.kind", "=", "note")
					.select((eb) => [
						"a.summary as text",
						asText(eb.ref("a.happened_at")).as("created_at"),
					]),
			).as("thread"),
			sql<
				{
					conversation_id: string | null;
					subject: string;
					latest_message_at: string;
				}[]
			>`(
				select coalesce(jsonb_agg(to_jsonb(t) - 'email_id' order by latest_message_at desc, email_id desc), '[]')
				from (
					select distinct on (coalesce('thread:' || e.conversation_id, 'email:' || a.id))
						e.conversation_id, e.subject, a.happened_at as latest_message_at, a.id as email_id
					from activity_about ab join email e on e.activity_id = ab.activity_id
					join activity a on a.id = ab.activity_id where ab.deal_id = d.id
					order by coalesce('thread:' || e.conversation_id, 'email:' || a.id),
						a.happened_at desc, a.id desc
				) t
			)`.as("email_threads"),
			jsonArrayFrom(
				eb
					.selectFrom("critical_date as cd")
					.select((eb) => [
						"cd.id",
						"cd.kind",
						asText(eb.ref("cd.due_on")).as("due_on"),
						"cd.note",
						"cd.source",
						eb
							.case()
							.when("cd.status", "=", "done")
							.then("cleared")
							.else(eb.ref("cd.status"))
							.end()
							.as("status"),
					])
					.whereRef("cd.deal_id", "=", "d.id")
					.orderBy("cd.due_on")
					.orderBy("cd.id"),
			).as("critical_dates"),
			sql`(select coalesce(json_agg(doc order by prepared_at desc, id), '[]') from (
				select id, name, kind, note, created_at as prepared_at
				from document where deal_id = d.id order by created_at desc, id limit 20
			) doc)`.as("documents"),
			jsonObjectFrom(
				eb
					.selectFrom("current_lease as lease")
					.innerJoin("document as file", "file.id", "lease.document_id")
					.select((eb) => [
						"lease.id",
						"lease.version",
						asText(eb.ref("lease.executed_on")).as("executed_on"),
						asText(eb.ref("lease.commencement_on")).as("commencement_on"),
						asText(eb.ref("lease.expiration_on")).as("expiration_on"),
						"file.name as evidence_ref",
						sql.lit("current").as("status"),
					])
					.whereRef("lease.deal_id", "=", "d.id"),
			).as("lease"),
			sql<
				unknown[]
			>`(select coalesce(json_agg(e order by recorded_at desc, id desc), '[]') from (
				select c.id::text, c.changed_at as recorded_at, coalesce(u.slug, c.changed_by_job) as actor,
					c.source_event ->> 'verb' as verb, c.source_event ->> 'field' as field,
					c.source_event -> 'old_value' as old_value, c.source_event -> 'new_value' as new_value
				from imported_change c left join app_user u on u.id = c.changed_by_user_id
				where c.table_name = 'deal' and c.record = jsonb_build_object('id', d.id)
				union all
				select c.id || ':' || edit.key, c.changed_at, coalesce(u.slug, c.changed_by_job), 'update-deal',
					case edit.key
						when 'owner_user_id' then 'owner'
						when 'market_id' then 'market'
						when 'needs_attention' then 'attention'
						when 'closed_value' then 'won_value'
						else edit.key
					end,
					${dealEditValue("c.old_value")}, ${dealEditValue("c.new_value")}
				from change c left join app_user u on u.id = c.changed_by_user_id
				cross join lateral (
					select key from jsonb_object_keys(c.new_value) as fields(key)
					where key not in ('parking_reason', 'parking_note', 'parked_at', 'parked_by_user_id')
					union all
					select 'operating_state' where c.new_value ?| array['parking_reason', 'parking_note']
				) edit
				where c.table_name = 'deal' and c.record = jsonb_build_object('id', d.id) and c.action = 'update'
				order by recorded_at desc, id desc limit ${HISTORY_CAP}
			) e)`.as("events"),
		])
		.where("d.id", "=", deal)
		.executeTakeFirst();
	if (!record) return { error: "not_found" as const };
	const { today, commissions, reason, ...detail } = record;
	const checklist = checklistOf({
		deal: {
			id: detail.deal_id,
			owner: detail.owner,
			type: reason === "renewal" ? reason : detail.type,
			invoiced_on: detail.invoiced_on,
		},
		lease: detail.lease,
		criticalDates: detail.critical_dates,
		sections: "engine",
		commissions,
		requests: [],
		today,
	});
	return { ...detail, checklist };
}

function dealEditValue(column: "c.old_value" | "c.new_value") {
	const value = sql.ref(column);
	return sql`case edit.key
		when 'owner_user_id' then to_jsonb((select slug from app_user where id = (${value} ->> edit.key)::uuid))
		when 'market_id' then to_jsonb((select name from market where id = (${value} ->> edit.key)::uuid))
		when 'operating_state' then to_jsonb(case
			when ${value} -> 'parking_reason' = 'null'::jsonb then 'Active'
			else concat_ws(' · ', 'Parked', case ${value} ->> 'parking_reason'
				when 'client_paused' then 'Client paused'
				when 'prospect_never_active' then 'Prospect never became active work'
				when 'other' then 'Other'
			end, ${value} ->> 'parking_note')
		end)
		else ${value} -> edit.key
	end`;
}

const stepsOf = (db: Transaction<DB>, deal: Expression<string>) =>
	db
		.selectFrom("next_step as s")
		.leftJoin("app_user as o", "o.id", "s.owner_party_id")
		.select((eb) => [
			"s.id",
			"o.slug as owner",
			"s.what as description",
			"s.item_title as title",
			"s.item_bullets as bullets",
			"s.source_ref",
			asText(eb.ref("s.due_on")).as("due_on"),
			"s.status",
			asText(eb.ref("s.hold_until")).as("hold_until"),
			asText(eb.ref("s.changed_at")).as("updated_at"),
		])
		.where("s.deal_id", "=", deal)
		.orderBy("s.created_at")
		.orderBy("s.id");

// The client is the deal's header, so the parties are everyone else on it, vendors and market agent included.
const partiesOf = (db: Transaction<DB>, deal: Expression<string>) =>
	db
		.selectFrom("deal_party as dp")
		.innerJoin("party as p", "p.id", "dp.party_id")
		.leftJoin("app_user as u", "u.id", "dp.party_id")
		.select(["dp.role", "p.name", "u.slug as actor", "dp.party_id"])
		.where("dp.deal_id", "=", deal)
		.where("dp.role", "<>", "client")
		.orderBy("dp.role")
		.orderBy("p.name");

const activityHistoryOf = (db: Transaction<DB>, deal: Expression<string>) =>
	db
		.selectFrom("activity as a")
		.innerJoin("activity_about as ab", "ab.activity_id", "a.id")
		.leftJoin("app_user as by", "by.id", "a.changed_by_user_id")
		.select((eb) => [
			"a.id",
			"a.kind",
			eb.fn.coalesce("by.slug", "a.changed_by_job").as("actor"),
		])
		.where("ab.deal_id", "=", deal)
		.orderBy("a.happened_at", "desc")
		.orderBy("a.id", "desc")
		.limit(HISTORY_CAP);
