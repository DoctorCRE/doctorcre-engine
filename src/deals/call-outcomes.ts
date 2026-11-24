import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { jsonArrayFrom } from "kysely/helpers/postgres";
import { answerNextRead, checkFields, Refusal, refuse } from "../answer.ts";
import type { DB } from "../next-database.d.ts";
import type { DatabaseEnv } from "../reader.ts";
import { isUuid } from "../uuid.ts";
import {
	decidableCallProposal,
	openCopiedCallStepText,
	stepTextKey,
} from "./call-review.ts";

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

	const calls = await callOutcomeQuery(db, userId, dealId).execute();
	return {
		...deal,
		calls: calls.map((call) => ({
			...call,
			proposals: call.proposals.map(({ open_step_text, ...proposal }) => {
				const acceptBlocked =
					open_step_text !== null &&
					proposal.what !== null &&
					stepTextKey(open_step_text) !== stepTextKey(proposal.what)
						? "open_step_exists"
						: null;
				return { ...proposal, accept_blocked: acceptBlocked };
			}),
		})),
	};
}

export function callOutcomeQuery(
	db: Transaction<DB>,
	userId: string,
	dealId: string,
) {
	const proposals = db
		.selectFrom("proposal as p")
		.leftJoin("next_step as step", "step.id", "p.next_step_id")
		.where(sql<boolean>`p.activity_id = a.id`)
		.where("p.deal_id", "=", dealId)
		.where(decidableCallProposal(userId));
	const recentCalls = db
		.selectFrom("activity as a")
		.selectAll("a")
		.where("a.kind", "=", "call")
		.where(({ exists, selectFrom }) =>
			exists(
				selectFrom("activity_about as link")
					.select("link.activity_id")
					.whereRef("link.activity_id", "=", "a.id")
					.where("link.deal_id", "=", dealId),
			),
		)
		.where(
			sql<boolean>`(a.changed_by_job = 'call_capture' or exists (${proposals.select("p.id")}))`,
		)
		.orderBy("a.happened_at", "desc")
		.orderBy("a.id")
		.limit(MAX_CALLS);
	return db
		.selectFrom(recentCalls.as("a"))
		.select([
			"a.id as activity_id",
			sql<string>`to_jsonb(a.happened_at) #>> '{}'`.as("started_at"),
			sql<string>`(a.happened_at at time zone 'America/Chicago')::date::text`.as(
				"call_date",
			),
			jsonArrayFrom(
				proposals
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
						openCopiedCallStepText(userId).as("open_step_text"),
					])
					.select(({ fn }) => [
						fn.coalesce("p.what", "step.what").as("what"),
						fn.coalesce("p.due_on", "step.due_on").as("due_on"),
					])
					.orderBy("p.created_at")
					.orderBy("p.id"),
			).as("proposals"),
		])
		.orderBy("a.happened_at", "desc")
		.orderBy("a.id");
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
