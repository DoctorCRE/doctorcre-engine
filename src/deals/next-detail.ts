import { type Expression, sql, type Transaction } from "kysely";
import { jsonArrayFrom } from "kysely/helpers/postgres";
import type { DB } from "../next-database.d.ts";
import { asText } from "../reader.ts";
import { selectNextDeals } from "./next-board.ts";

export async function readNextDealDetail(db: Transaction<DB>, deal: string) {
	const record = await selectNextDeals(db)
		.select((eb) => [
			jsonArrayFrom(stepsOf(db, eb.ref("d.id"))).as("next_actions"),
			jsonArrayFrom(partiesOf(db, eb.ref("d.id"))).as("participants"),
			jsonArrayFrom(activitiesOf(db, eb.ref("d.id"))).as("activities"),
			jsonArrayFrom(emailsOf(db, eb.ref("d.id"))).as("email_threads"),
		])
		.where("d.id", "=", deal)
		.executeTakeFirst();
	if (!record) return { error: "not_found" as const };
	// As today, the deal's next step is its latest open step that is not a checklist item.
	const current = record.next_actions.findLast(
		(step) => step.status === "open" && step.title === null,
	);
	return {
		...record,
		next_step: current?.description ?? null,
		next_date: current?.due_on ?? null,
	};
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

const aboutDeal = (db: Transaction<DB>, deal: Expression<string>) =>
	db
		.selectFrom("activity as a")
		.innerJoin("activity_about as ab", "ab.activity_id", "a.id")
		.where("ab.deal_id", "=", deal)
		.orderBy("a.happened_at", "desc")
		.orderBy("a.id", "desc");

const activitiesOf = (db: Transaction<DB>, deal: Expression<string>) =>
	aboutDeal(db, deal)
		.leftJoin("app_user as by", "by.id", "a.changed_by_user_id")
		.select((eb) => [
			"a.id",
			asText(eb.ref("a.happened_at")).as("occurred_at"),
			eb.fn.coalesce("by.slug", "a.changed_by_job").as("actor"),
			"a.kind",
			"a.summary",
		]);

// The new section keeps no conversation id, so each email is its own thread.
const emailsOf = (db: Transaction<DB>, deal: Expression<string>) =>
	aboutDeal(db, deal)
		.innerJoin("email as e", "e.activity_id", "a.id")
		.select((eb) => [
			sql<null>`null`.as("conversation_id"),
			"e.subject",
			asText(eb.ref("a.happened_at")).as("latest_message_at"),
		]);
