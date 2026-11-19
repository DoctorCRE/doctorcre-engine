import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { sql, type Transaction } from "kysely";
import { Refusal, refuse } from "../answer.ts";
import { PARTNERS } from "../clients/read.ts";
import type { JsonObject } from "../database.d.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import type { DatabaseEnv } from "../reader.ts";
import { fit, isChangeId, isUuid, optional } from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";
import { isMonday, reviewVersion } from "./read.ts";

type ReviewTarget = {
	week_of: string;
	deal_id: string | null;
	party_id: string | null;
};
const versionFields = { idempotency_key: isUuid, seen_change_id: isChangeId };
const required = ["idempotency_key", "seen_change_id"] as const;
const markFields = {
	...versionFields,
	week_of: isMonday,
	deal_id: optional(isUuid),
	party_id: optional(isUuid),
};

function parseMark(body: JsonObject) {
	const args = fit(
		body,
		markFields,
		[...required, "week_of"],
		["deal_id", "party_id"],
	);
	if (args instanceof Refusal) return args;
	if (args.deal_id && args.party_id)
		return new Refusal(400, "invalid_field_value", {
			fields: ["deal_id", "party_id"],
		});
	return {
		...args,
		// Match the UUID text that Undo uses for the advisory lock.
		deal_id: args.deal_id?.toLowerCase() ?? null,
		party_id: args.party_id?.toLowerCase() ?? null,
	};
}

async function checkVersion(
	tx: Transaction<DB>,
	target: ReviewTarget,
	seen: number,
) {
	const { week_of, deal_id, party_id } = target;
	const key = `weekly-review:${week_of}:${deal_id ?? ""}:${party_id ?? ""}`;
	await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(
		tx,
	);
	const version = reviewVersion(
		sql.val(week_of),
		sql.val(deal_id),
		sql.val(party_id),
	);
	const current = await tx
		.selectNoFrom(version.as("version"))
		.executeTakeFirstOrThrow();
	if (current.version !== seen)
		throw new SaveRefusal(
			new Refusal(409, "version_conflict", {
				current_version: current.version,
			}),
		);
}

async function mark(
	tx: Transaction<DB>,
	request: ReviewTarget & { seen_change_id: number },
) {
	const { week_of, deal_id, party_id, seen_change_id } = request;
	await checkVersion(tx, request, seen_change_id);
	const existing = await tx
		.selectFrom("weekly_review")
		.select("id as review_id")
		.where("week_of", "=", week_of)
		.where("deal_id", "is not distinct from", deal_id)
		.where("party_id", "is not distinct from", party_id)
		.executeTakeFirst();
	if (existing) return { ...existing, existing: true };
	const {
		rows: [added],
	} = await sql<{ review_id: string }>`
		insert into weekly_review (week_of, deal_id, party_id) values (${week_of}, ${deal_id}, ${party_id})
		returning id as review_id`.execute(tx);
	if (!added) throw new Error("Weekly review insert did not return its id");
	return added;
}

async function undo(
	tx: Transaction<DB>,
	{ id, seen_change_id }: { id: string; seen_change_id: number },
) {
	const {
		rows: [target],
	} = await sql<ReviewTarget>`
		select value->>'week_of' as week_of, value->>'deal_id' as deal_id, value->>'party_id' as party_id
		from (select coalesce(new_value, old_value) as value from change
			where table_name = 'weekly_review' and record = jsonb_build_object('id', ${id}::uuid)
			order by change.id desc limit 1) history`.execute(tx);
	const missing = new SaveRefusal(new Refusal(404, "not_found"));
	if (!target) throw missing;
	await checkVersion(tx, target, seen_change_id);
	const {
		rows: [removed],
	} = await sql<{ review_id: string }>`
		delete from weekly_review where id = ${id} returning id as review_id`.execute(
		tx,
	);
	if (!removed) throw missing;
	return removed;
}

const reviewPartner = createMiddleware<DatabaseEnv>(async (c, next) => {
	if (!PARTNERS.some((slug) => slug === c.get("partner").slug))
		return refuse(c, new Refusal(403, "AUTHORIZATION_REFUSED"));
	await next();
});

export const mondayReviewMarks = new Hono<DatabaseEnv & NextSaveEnv>()
	.post("/weekly-reviews", reviewPartner, (c) =>
		answerNextSave(c, "mark-weekly-review", parseMark, mark, (result) =>
			result.existing ? 200 : 201,
		),
	)
	.post("/weekly-reviews/:id/remove", reviewPartner, (c) =>
		answerNextSave(
			c,
			"undo-weekly-review",
			(body) => {
				const id = c.req.param("id");
				if (!isUuid(id))
					return new Refusal(400, "invalid_field_value", { fields: ["id"] });
				const args = fit(body, versionFields, required);
				return args instanceof Refusal ? args : { ...args, id };
			},
			undo,
		),
	);
