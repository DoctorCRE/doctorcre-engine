import { type Selectable, sql, type Transaction } from "kysely";
import { z } from "zod";
import { recentDocTurns } from "./doc.ts";
import { recordDocPoll } from "./doc-link.ts";
import { type DocClaimState, validateDocAnswer } from "./doc-tools.ts";
import type { DB } from "./next-database.d.ts";

const clearClaim = { claim_id: null, claim_until: null, claim_state: null };
const initialClaim = { reads: 0, sources: {} } satisfies DocClaimState;
const unexpired = sql<boolean>`claim_until > clock_timestamp()`;
const leaseEnd = sql<string>`clock_timestamp() + interval '60 seconds'`;
const sourceHash = sql`sha256(convert_to(jsonb_build_array(e.subject, e.body)::text, 'UTF8'))`;

type ClaimableTurn = Pick<
	Selectable<DB["doc_turn"]>,
	"id" | "conversation_id" | "position" | "question" | "context"
>;

async function claimDocTurn(tx: Transaction<DB>, owner: string) {
	const {
		rows: [turn],
	} = await sql<ClaimableTurn>`
		with cutoff as materialized (select clock_timestamp() as checked_at)
		select t.id, t.conversation_id, t.position, t.question, t.context
		from doc_turn t cross join cutoff
		where t.owner_user_id = ${owner}
		  and (t.state = 'queued' or (t.state = 'working' and t.claim_until <= cutoff.checked_at))
		  and not exists (
			select 1 from doc_turn active
			where active.owner_user_id = ${owner} and active.state = 'working'
			  and active.claim_until > cutoff.checked_at
		  )
		order by t.created_at, t.id
		limit 1 for update of t
	`.execute(tx);
	if (!turn) return null;
	const { conversation_id, ...question } = turn;
	const history = await recentDocTurns(tx, conversation_id, turn.position);
	const claim_id = crypto.randomUUID();
	const { claim_until } = await tx
		.updateTable("doc_turn")
		.set({
			state: "working",
			claim_id,
			claim_until: leaseEnd,
			claim_state: initialClaim,
		})
		.where("id", "=", turn.id)
		.where("owner_user_id", "=", owner)
		.returning(sql<string>`to_jsonb(claim_until) #>> '{}'`.as("claim_until"))
		.executeTakeFirstOrThrow();
	return {
		kind: "turn" as const,
		claim_id,
		claim_until,
		conversation_id,
		turn: question,
		history,
	};
}

const destination = z.strictObject({
	kind: z.enum(["deal", "vendor"]),
	id: z.uuid(),
});
const source = z.object({
	activity_id: z.uuid(),
	subject: z.string(),
	body: z.string(),
});
const judgmentWork = z.discriminatedUnion("kind", [
	source.extend({ kind: z.literal("email_summary") }),
	source.extend({
		kind: z.literal("email_filing"),
		destinations: z.array(destination).min(1),
	}),
]);

export async function claimDocWork(
	tx: Transaction<DB>,
	owner: string,
	acceptsJudgment: boolean,
) {
	// Turns still run before the separate judgment storage migration.
	const {
		rows: [storage],
	} = await sql<{ installed: boolean }>`
		select to_regclass('next.doc_judgment_job') is not null as installed
	`.execute(tx);
	const installed = storage?.installed;
	if (installed) {
		const active = await tx
			.selectFrom("doc_judgment_job")
			.select("id")
			.where("owner_user_id", "=", owner)
			.where(unexpired)
			.executeTakeFirst();
		if (active) return null;
	}
	const turn = await claimDocTurn(tx, owner);
	if (turn || !acceptsJudgment || !installed) return turn;

	const claim_id = crypto.randomUUID();
	const {
		rows: [job],
	} = await sql<{ claim_until: string }>`
		with candidate as (
			select id, activity_id
			from doc_judgment_job
			where owner_user_id = ${owner}
			  and (state = 'queued' or (state = 'working' and claim_until <= clock_timestamp()))
			  and not exists (
				select 1 from doc_turn where owner_user_id = ${owner} and ${unexpired}
			  )
			order by created_at, id
			limit 1 for update
		)
		update doc_judgment_job j
		set state = 'working', claim_id = ${claim_id}, claim_until = ${leaseEnd},
			claim_source_hash = ${sourceHash}
		from candidate join email e using (activity_id)
		where j.id = candidate.id
		returning j.kind, j.activity_id, j.destinations, e.subject, e.body,
			to_jsonb(j.claim_until) #>> '{}' as claim_until
	`.execute(tx);
	if (!job) return null;
	return { ...judgmentWork.parse(job), claim_id, claim_until: job.claim_until };
}

const judgmentOutcome = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("answered"), result: z.unknown() }),
	z.strictObject({ kind: z.enum(["failed", "signed_out", "plan_limited"]) }),
]);
const text = z
	.string()
	.trim()
	.min(1)
	.refine((value) => value.isWellFormed() && !value.includes("\0"));
const summaryResult = z.strictObject({
	summary: text.refine((value) => [...value].length <= 300),
	action_title: text.refine((value) => [...value].length <= 90).nullable(),
});
const filingResult = z.strictObject({
	facts: z.array(z.strictObject({ destination, text, quote: text })),
});

function validateJudgment(
	outcome: unknown,
	work: z.infer<typeof judgmentWork>,
) {
	if (work.kind === "email_summary")
		return summaryResult.safeParse(outcome).data;
	const result = filingResult.safeParse(outcome).data;
	return result?.facts.every(
		({ destination, quote }) =>
			work.destinations.some(
				({ kind, id }) => kind === destination.kind && id === destination.id,
			) &&
			(work.body.includes(quote) || work.subject.includes(quote)),
	)
		? result
		: undefined;
}

export async function finishDocJudgment(
	tx: Transaction<DB>,
	owner: string,
	claim_id: string,
	payload: unknown,
) {
	const { data: outcome } = judgmentOutcome.safeParse(payload);
	if (!outcome) return 400;
	const {
		rows: [job],
	} = await sql<{ id: string }>`
		select j.id, j.kind, j.activity_id, j.destinations, e.subject, e.body
		from doc_judgment_job j join email e using (activity_id)
		where j.owner_user_id = ${owner} and j.claim_id = ${claim_id} and ${unexpired}
		  and (j.claim_source_hash = ${sourceHash} or ${outcome.kind} <> 'answered')
	`.execute(tx);
	if (!job) return 404;
	const result =
		outcome.kind === "answered"
			? validateJudgment(outcome.result, judgmentWork.parse(job))
			: null;
	if (result === undefined) return 422;

	const { kind } = outcome;
	const blocked = kind === "signed_out" || kind === "plan_limited";
	const saved = await tx
		.updateTable("doc_judgment_job")
		.set({
			state: blocked ? "queued" : kind,
			claim_id: null,
			claim_until: null,
			claim_source_hash: null,
			result,
		})
		.where("id", "=", job.id)
		.where("claim_id", "=", claim_id)
		.where(unexpired)
		.where(sql<boolean>`${kind} <> 'answered' or exists (
			select 1 from email e
			where e.activity_id = doc_judgment_job.activity_id and ${sourceHash} = claim_source_hash
		)`)
		.executeTakeFirst();
	if (!saved.numUpdatedRows) return 404;
	if (blocked) await recordDocPoll(tx, owner, kind);
	return 204;
}

type DocResult = { claim_id: string } & (
	| { kind: "answered"; answer: unknown }
	| { kind: "failed" | "signed_out" | "plan_limited" }
);

export async function finishDocTurn(
	tx: Transaction<DB>,
	owner: string,
	result: DocResult,
) {
	const { kind, claim_id } = result;
	const {
		rows: [turn],
	} = await sql<{ id: string; claim_state: DocClaimState }>`
		with locked as (
			select id, claim_state, claim_until from doc_turn
			where owner_user_id = ${owner} and claim_id = ${claim_id} and state = 'working'
			for update
		)
		select id, claim_state from locked where ${unexpired}
	`.execute(tx);
	if (!turn) return 404;

	let answer = null;
	if (kind === "answered") {
		try {
			answer = validateDocAnswer(result.answer, turn.claim_state);
		} catch {
			return 422;
		}
	}
	const blocked = kind === "signed_out" || kind === "plan_limited";
	const saved = await tx
		.updateTable("doc_turn")
		.set({ state: blocked ? "queued" : kind, ...clearClaim, answer })
		.where("id", "=", turn.id)
		.where("owner_user_id", "=", owner)
		.where(unexpired)
		.executeTakeFirst();
	if (!saved.numUpdatedRows) return 404;
	if (blocked) await recordDocPoll(tx, owner, kind);
	return 204;
}
