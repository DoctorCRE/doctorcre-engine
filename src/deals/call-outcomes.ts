import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { jsonArrayFrom } from "kysely/helpers/postgres";
import { answerNextRead, checkFields, Refusal, refuse } from "../answer.ts";
import { visibleSuggestion } from "../home-inbox-review.ts";
import type { DB } from "../next-database.d.ts";
import type { DatabaseEnv } from "../reader.ts";
import { isUuid } from "../uuid.ts";

const MAX_CALLS = 50;

async function readCallOutcomes(
	db: Transaction<DB>,
	userId: string,
	dealId: string,
) {
	const deal = await db
		.selectFrom("deal")
		.select(["id as deal_id", "name as deal_name"])
		.where("id", "=", dealId)
		.executeTakeFirst();
	if (!deal) return new Refusal(404, "not_found");

	const forPartner = sql<boolean>`${userId}::uuid in (a.changed_by_user_id, a.changed_for_user_id)`;
	const calls = await db
		.selectFrom("activity_about as link")
		.innerJoin("activity as a", "a.id", "link.activity_id")
		.innerJoinLateral(
			(eb) =>
				db
					.selectNoFrom(
						jsonArrayFrom(
							eb
								.selectFrom("proposal as p")
								.leftJoin("next_step as step", "step.id", "p.next_step_id")
								.leftJoin("app_user as owner", (join) =>
									join.on(
										sql<boolean>`owner.id = coalesce(p.owner_party_id, step.owner_party_id)`,
									),
								)
								.select([
									"p.id as proposal_id",
									"p.kind",
									"p.status",
									"p.evidence",
									"p.from_phase",
									"p.to_phase",
									"p.phase_on",
									"p.next_step_id",
									"owner.slug as owner",
								])
								.select(({ fn }) => [
									fn.coalesce("p.what", "step.what").as("what"),
									fn.coalesce("p.due_on", "step.due_on").as("due_on"),
								])
								.whereRef("p.activity_id", "=", "a.id")
								.where("p.deal_id", "=", deal.deal_id)
								.where((eb) =>
									eb.or([
										forPartner,
										eb("p.proposed_by_job", "=", "old_system"),
									]),
								)
								.where(sql<boolean>`case when p.kind = 'next_step_done' then
								step.owner_party_id = ${userId}::uuid and (p.status <> 'pending' or step.status = 'open')
								else p.decided_by_user_id = ${userId}::uuid or ${visibleSuggestion(userId)} end`)
								.orderBy("p.created_at")
								.orderBy("p.id"),
						).as("proposals"),
					)
					.as("outcomes"),
			(join) => join.onTrue(),
		)
		.select([
			"a.id as activity_id",
			sql<string>`to_jsonb(a.happened_at) #>> '{}'`.as("started_at"),
			sql<string>`(a.happened_at at time zone 'America/Chicago')::date::text`.as(
				"call_date",
			),
			"outcomes.proposals",
		])
		.where("link.deal_id", "=", deal.deal_id)
		.where("a.kind", "=", "call")
		.where((eb) =>
			eb.or([
				forPartner,
				eb.and([
					eb("a.changed_by_job", "=", "old_system"),
					eb("a.changed_by_user_id", "is", null),
					eb("a.changed_for_user_id", "is", null),
				]),
			]),
		)
		.where((eb) =>
			eb.or([
				eb("a.changed_by_job", "=", "call_capture"),
				sql<boolean>`json_array_length(outcomes.proposals) > 0`,
			]),
		)
		.orderBy("a.happened_at", "desc")
		.orderBy("a.id")
		.limit(MAX_CALLS)
		.execute();
	return { ...deal, calls };
}

export const dealCallOutcomes = new Hono<DatabaseEnv>().get(
	"/deals/:deal/call-outcomes",
	async (c): Promise<Response> => {
		const refused = checkFields(new URL(c.req.url).searchParams, []);
		if (refused) return refuse(c, refused);
		const dealId = c.req.param("deal");
		if (!isUuid(dealId)) return refuse(c, new Refusal(404, "not_found"));
		return answerNextRead(c, "read-call-outcomes", (tx, userId) =>
			readCallOutcomes(tx, userId, dealId),
		);
	},
);
