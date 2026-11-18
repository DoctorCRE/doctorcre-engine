import { type Expression, sql, type Transaction } from "kysely";
import { jsonArrayFrom } from "kysely/helpers/postgres";
import type { DB } from "../next-database.d.ts";
import { asText } from "../reader.ts";
import { selectNextDeals } from "./next-board.ts";

const HISTORY_CAP = 500;

export async function readNextDealDetail(db: Transaction<DB>, deal: string) {
	const record = await selectNextDeals(db)
		.select((eb) => [
			sql.lit("deal-timeline.v1").as("schema_version"),
			sql.lit("deal-items.v1").as("item_schema_version"),
			"d.id as deal_id",
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
			sql`(select coalesce(json_agg(cd order by due_on, id), '[]') from (
				select id, kind, due_on, note, source, case when status = 'done' then 'cleared' else status end as status
				from critical_date where deal_id = d.id
			) cd)`.as("critical_dates"),
			sql`(select coalesce(json_agg(doc order by prepared_at desc, id), '[]') from (
				select id, name, kind, note, created_at as prepared_at
				from document where deal_id = d.id order by created_at desc, id limit 20
			) doc)`.as("documents"),
			sql`(select row_to_json(lease) from (
				select id, version, executed_on, commencement_on, expiration_on, 'current' as status
				from current_lease where deal_id = d.id
			) lease)`.as("lease"),
			sql<
				unknown[]
			>`(select coalesce(json_agg(e order by recorded_at desc, id desc), '[]') from (
				select c.id::text, c.changed_at as recorded_at, coalesce(u.slug, c.changed_by_job) as actor,
					c.source_event ->> 'verb' as verb, c.source_event ->> 'field' as field,
					c.source_event -> 'old_value' as old_value, c.source_event -> 'new_value' as new_value
				from imported_change c left join app_user u on u.id = c.changed_by_user_id
				where c.table_name = 'deal' and c.record = jsonb_build_object('id', d.id)
				union all
				select c.id::text, c.changed_at, coalesce(u.slug, c.changed_by_job), c.action,
					null, c.old_value, c.new_value
				from change c left join app_user u on u.id = c.changed_by_user_id
				where c.table_name = 'deal' and c.record = jsonb_build_object('id', d.id) and c.action = 'update'
				order by recorded_at desc, id desc limit ${HISTORY_CAP}
			) e)`.as("events"),
		])
		.where("d.id", "=", deal)
		.executeTakeFirst();
	return record ?? { error: "not_found" as const };
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
