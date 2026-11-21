import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { recentDocTurns } from "./doc.ts";
import { recordDocPoll } from "./doc-link.ts";
import { type DocClaimState, validateDocAnswer } from "./doc-tools.ts";
import type { DB } from "./next-database.d.ts";
import { UUID } from "./uuid.ts";

const clearClaim = { claim_id: null, claim_until: null, claim_state: null };
const clearJudgmentClaim = {
	claim_id: null,
	claim_until: null,
	claim_source_hash: null,
};
const initialClaim = { reads: 0, sources: {} } satisfies DocClaimState;
const unexpired = sql<boolean>`claim_until > clock_timestamp()`;
const leaseEnd = sql<string>`clock_timestamp() + interval '60 seconds'`;
const claimUntilText = sql<string>`to_jsonb(claim_until) #>> '{}'`.as(
	"claim_until",
);
const sourceHash = sql`sha256(convert_to(jsonb_build_array(e.subject, e.body)::text, 'UTF8'))`;

async function claimDocTurn(tx: Transaction<DB>, owner: string, id: string) {
	const claim_id = crypto.randomUUID();
	const { conversation_id, claim_until, ...turn } = await tx
		.updateTable("doc_turn")
		.set({
			state: "working",
			claim_id,
			claim_until: leaseEnd,
			claim_state: initialClaim,
		})
		.where("id", "=", id)
		.where("owner_user_id", "=", owner)
		.returning([
			"id",
			"conversation_id",
			"position",
			"question",
			"context",
			claimUntilText,
		])
		.executeTakeFirstOrThrow();
	const history = await recentDocTurns(tx, conversation_id, turn.position);
	return {
		kind: "turn" as const,
		claim_id,
		claim_until,
		conversation_id,
		turn,
		history,
	};
}

const destination = z.strictObject({
	kind: z.enum(["deal", "vendor"]),
	id: z.string().regex(UUID),
});
type JudgmentInput = {
	kind: "email_summary" | "email_filing";
	activity_id: string;
	subject: string;
	body: string;
	destinations: z.infer<typeof destination>[];
};

const judgmentInput = sql`j.kind, j.activity_id, e.subject, e.body,
	coalesce((select jsonb_agg(jsonb_build_object(
		'kind', case when deal_id is null then 'vendor' else 'deal' end,
		'id', coalesce(deal_id, vendor_id)
	) order by position) from doc_judgment_destination where job_id = j.id), '[]') as destinations`;

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
	const mailQueue = storage?.installed
		? sql`
		union all
		select 'mail', id, created_at, claim_until from doc_judgment_job
		where owner_user_id = ${owner} and state in ('queued', 'working')
	`
		: sql``;
	while (true) {
		const {
			rows: [candidate],
		} = await sql<{ queue: "turn" | "mail"; id: string }>`
			with pending as (
				select 'turn' as queue, id, created_at, claim_until from doc_turn
				where owner_user_id = ${owner} and state in ('queued', 'working')
				${mailQueue}
			)
			select queue, id from pending
			where (queue = 'turn' or ${acceptsJudgment})
			  and not exists (select 1 from pending where claim_until > statement_timestamp())
			order by queue <> 'turn', created_at, id
			limit 1
		`.execute(tx);
		if (!candidate) return null;
		if (candidate.queue === "turn")
			return claimDocTurn(tx, owner, candidate.id);

		const {
			rows: [job],
		} = await sql<JudgmentInput & { claim_source_hash: Buffer }>`
			select ${judgmentInput}, ${sourceHash} as claim_source_hash
			from doc_judgment_job j join email e using (activity_id)
			where j.id = ${candidate.id} and j.owner_user_id = ${owner}
			for update of j
		`.execute(tx);
		const update = tx
			.updateTable("doc_judgment_job")
			.where("id", "=", candidate.id)
			.where("owner_user_id", "=", owner);
		const hasDestinations = Boolean(job?.destinations.length);
		if (!job || (job.kind === "email_filing") !== hasDestinations) {
			await update.set({ state: "failed", ...clearJudgmentClaim }).execute();
			continue;
		}

		const { destinations, claim_source_hash, ...input } = job;
		const claim_id = crypto.randomUUID();
		const { claim_until } = await update
			.set({
				state: "working",
				claim_id,
				claim_until: leaseEnd,
				claim_source_hash,
			})
			.returning(claimUntilText)
			.executeTakeFirstOrThrow();
		const work = { ...input, claim_id, claim_until };
		return work.kind === "email_filing" ? { ...work, destinations } : work;
	}
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

function validateJudgment(outcome: unknown, work: JudgmentInput) {
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
	} = await sql<JudgmentInput & { id: string }>`
		select j.id, ${judgmentInput}
		from doc_judgment_job j join email e using (activity_id)
		where j.owner_user_id = ${owner} and j.claim_id = ${claim_id} and ${unexpired}
		  and (j.claim_source_hash = ${sourceHash} or ${outcome.kind} <> 'answered')
	`.execute(tx);
	if (!job) return 404;
	const result =
		outcome.kind === "answered" ? validateJudgment(outcome.result, job) : null;
	if (result === undefined) return 422;

	const { kind } = outcome;
	const blocked = kind === "signed_out" || kind === "plan_limited";
	const saved = await tx
		.updateTable("doc_judgment_job")
		.set({
			state: blocked ? "queued" : kind,
			...clearJudgmentClaim,
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
