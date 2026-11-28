import { type RawBuilder, sql, type Transaction } from "kysely";
import { z } from "zod";
import {
	filingDestination,
	saveFilingJudgment,
} from "./activity/filing-judgment.ts";
import {
	introductionMail,
	saveIntroductions,
	validateIntroductions,
} from "./activity/introduction-judgment.ts";
import { recentDocTurns } from "./doc.ts";
import type { judgmentClaimSchema } from "./doc-judgment-prompt.ts";
import { docLinkState, recordDocPoll } from "./doc-link.ts";
import { type DocClaimState, validateDocAnswer } from "./doc-tools.ts";
import type { DB } from "./next-database.d.ts";

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
const judgmentStorage = sql<{ installed: boolean }>`
	select to_regclass('next.doc_judgment_job') is not null as installed
`;

async function claimDocTurn(
	tx: Transaction<DB>,
	eligible: RawBuilder<boolean>,
) {
	const claim_id = crypto.randomUUID();
	const claimed = await tx
		.updateTable("doc_turn")
		.set({
			state: "working",
			claim_id,
			claim_until: leaseEnd,
			claim_state: initialClaim,
		})
		.where(eligible)
		.returning([
			"id",
			"conversation_id",
			"position",
			"question",
			"context",
			claimUntilText,
		])
		.executeTakeFirst();
	if (!claimed) return null;
	const { conversation_id, claim_until, ...turn } = claimed;
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

type JudgmentKind = z.infer<typeof judgmentClaimSchema>["kind"];
type JudgmentInput = {
	kind: JudgmentKind;
	activity_id: string;
	subject: string;
	body: string;
	destinations: z.infer<typeof filingDestination>[];
};

const judgmentInput = sql`j.kind, j.activity_id, e.subject, e.body,
	coalesce((select jsonb_agg(jsonb_build_object(
		'kind', case when deal_id is null then 'vendor' else 'deal' end,
		'id', coalesce(deal_id, vendor_id)
	) order by position) from doc_judgment_destination where job_id = j.id), '[]') as destinations`;

const mail = ["email_summary", "email_filing"] satisfies JudgmentKind[];
// Split and introduction jobs require a capable Mac on the partner's plan.
const mailKinds = {
	mac: [],
	mac_with_judgment: mail,
	mac_with_split: [...mail, "email_split"],
	backup: [],
	backup_mail: mail,
} satisfies Record<string, JudgmentKind[]>;

export async function claimDocWork(
	tx: Transaction<DB>,
	owner: string,
	runner: keyof typeof mailKinds,
	introductions = false,
) {
	await sql`select pg_advisory_xact_lock(hashtextextended(${`doc queue ${owner}`}, 0))`.execute(
		tx,
	);
	const eligible = (queuedAt: RawBuilder<unknown>) =>
		runner === "backup" || runner === "backup_mail"
			? sql`${queuedAt} <= statement_timestamp() - interval '2 minutes'
				or (select status from ${docLinkState(owner)} link) <> 'ready'`
			: sql`true`;
	const kinds: JudgmentKind[] = [...mailKinds[runner]];
	if (
		introductions &&
		(runner === "mac_with_judgment" || runner === "mac_with_split")
	)
		kinds.push("introduction");
	const turnQueuedAt = sql`coalesce(requeued_at, created_at)`;
	const mailQueuedAt = sql`created_at`;
	// Turns still run before the separate judgment storage migration.
	const {
		rows: [storage],
	} = await judgmentStorage.execute(tx);
	const mailQueue = storage?.installed
		? sql`
		union all
		select 'mail', kind, id, created_at, state, claim_id, claim_until,
			(${eligible(mailQueuedAt)}) as eligible from doc_judgment_job
		where owner_user_id = ${owner} and state in ('queued', 'working')
	`
		: sql``;
	while (true) {
		const {
			rows: [candidate],
		} = await sql<{
			queue: "turn" | "mail";
			id: string;
			state: "queued" | "working";
			claim_id: string | null;
			claim_until: string | null;
		}>`
			with pending as (
				select 'turn' as queue, null as kind, id, created_at, state, claim_id, claim_until,
					(${eligible(turnQueuedAt)}) as eligible from doc_turn
				where owner_user_id = ${owner} and state in ('queued', 'working')
				${mailQueue}
			)
			select queue, id, state, claim_id, claim_until::text from pending
			where eligible and (queue = 'turn' or kind = any(${kinds}::text[]))
			  and not exists (select 1 from pending where claim_until > statement_timestamp())
			order by queue <> 'turn', created_at, id
			limit 1
		`.execute(tx);
		if (!candidate) return null;
		if (candidate.queue === "turn" && runner === "backup_mail") return null;

		const table = candidate.queue === "turn" ? "doc_turn" : "doc_judgment_job";
		// The guarded write needs a fresh snapshot after any wait for the row lock.
		const locked = await tx
			.selectFrom(table)
			.select("id")
			.where("id", "=", candidate.id)
			.where("owner_user_id", "=", owner)
			.forNoKeyUpdate()
			.executeTakeFirst();
		if (!locked) continue;

		const stillEligible = (queuedAt: RawBuilder<unknown>) => sql<boolean>`
			id = ${candidate.id} and owner_user_id = ${owner}
			and state in ('queued', 'working') and state = ${candidate.state}
			and claim_id is not distinct from ${candidate.claim_id}::uuid
			and claim_until is not distinct from ${candidate.claim_until}::timestamptz
			and (claim_until is null or claim_until <= clock_timestamp())
			and (${eligible(queuedAt)})
		`;
		if (candidate.queue === "turn") {
			const turn = await claimDocTurn(tx, stillEligible(turnQueuedAt));
			if (turn) return turn;
			continue;
		}

		const {
			rows: [job],
		} = await sql<
			Omit<JudgmentInput, "subject" | "body"> &
				({ subject: string; body: string } | { subject: null; body: null }) & {
					claim_source_hash: Buffer;
				}
		>`
			select ${judgmentInput}, ${sourceHash} as claim_source_hash
			from doc_judgment_job j left join email e using (activity_id)
			where j.id = ${candidate.id} and j.owner_user_id = ${owner}
		`.execute(tx);
		if (!job) continue;
		const context =
			job.kind === "introduction"
				? await introductionMail(tx, job.activity_id)
				: undefined;
		const valid =
			(job.kind !== "introduction" || context !== undefined) &&
			job.subject !== null &&
			(job.kind === "email_filing") === Boolean(job.destinations.length);
		const claim_id = crypto.randomUUID();
		const claimed = await tx
			.updateTable("doc_judgment_job")
			.where(stillEligible(mailQueuedAt))
			.set(
				valid
					? {
							state: "working",
							claim_id,
							claim_until: leaseEnd,
							claim_source_hash: job.claim_source_hash,
						}
					: { state: "failed", ...clearJudgmentClaim },
			)
			.returning(claimUntilText)
			.executeTakeFirst();
		if (!valid || !claimed) continue;
		const { kind, destinations, activity_id, subject, body } = job;
		const work = { activity_id, subject, body, claim_id, ...claimed };
		if (kind === "introduction") {
			if (context) return { ...work, kind, context };
			continue;
		}
		return kind === "email_filing"
			? { ...work, kind, destinations }
			: { ...work, kind };
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
const quote = z
	.string()
	.min(1)
	.refine((value) => value.isWellFormed() && !value.includes("\0"));
const summaryResult = z.strictObject({
	summary: text.refine((value) => [...value].length <= 300),
	action_title: text.refine((value) => [...value].length <= 90).nullable(),
	quote,
});
const filingResult = z.strictObject({
	facts: z.array(
		z.strictObject({ destination: filingDestination, text, quote }),
	),
});

const splitResult = z.strictObject({ authored: z.array(text) });

// The sender's paragraphs must appear in the body in order; the rest of the body is the earlier text.
function splitBody(body: string, paragraphs: string[]) {
	const rest: string[] = [];
	let at = 0;
	for (const paragraph of paragraphs) {
		const start = body.indexOf(paragraph, at);
		if (start < 0) return undefined;
		rest.push(body.slice(at, start));
		at = start + paragraph.length;
	}
	rest.push(body.slice(at));
	return {
		authored: paragraphs.join("\n\n"),
		history: rest
			.map((part) => part.trim())
			.filter(Boolean)
			.join("\n\n"),
	};
}

async function validateJudgment(
	tx: Transaction<DB>,
	outcome: unknown,
	work: JudgmentInput,
) {
	const quotesEmail = (quote: string) =>
		work.body.includes(quote) || work.subject.includes(quote);
	if (work.kind === "introduction") {
		const context = await introductionMail(tx, work.activity_id);
		return context && validateIntroductions(outcome, context, quotesEmail);
	}
	if (work.kind === "email_split") {
		const result = splitResult.safeParse(outcome).data;
		return result && splitBody(work.body, result.authored);
	}
	if (work.kind === "email_summary") {
		const result = summaryResult.safeParse(outcome).data;
		return result && quotesEmail(result.quote) ? result : undefined;
	}
	const result = filingResult.safeParse(outcome).data;
	if (
		new Set(
			result?.facts
				.filter(({ destination }) => destination.kind === "deal")
				.map(({ destination }) => destination.id),
		).size > 1
	)
		return undefined;
	return result?.facts.every(
		({ destination, quote }) =>
			work.destinations.some(
				({ kind, id }) => kind === destination.kind && id === destination.id,
			) && quotesEmail(quote),
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
	return outcome ? saveDocJudgment(tx, owner, claim_id, outcome) : 400;
}

export async function saveDocJudgment(
	tx: Transaction<DB>,
	owner: string,
	claim_id: string,
	outcome: z.infer<typeof judgmentOutcome> | { kind: "queued" },
) {
	const {
		rows: [storage],
	} = await judgmentStorage.execute(tx);
	if (!storage?.installed) return 404;
	const {
		rows: [job],
	} = await sql<
		JudgmentInput & {
			id: string;
			source_hash: string;
			message_id: string | null;
		}
	>`
		select j.id, e.message_id, 'sha256:' || encode(j.claim_source_hash, 'hex') as source_hash,
			${judgmentInput}
		from doc_judgment_job j join email e using (activity_id)
		where j.owner_user_id = ${owner} and j.claim_id = ${claim_id} and ${unexpired}
		  and (j.claim_source_hash = ${sourceHash} or ${outcome.kind} <> 'answered')
	`.execute(tx);
	if (!job) return 404;
	const result =
		outcome.kind === "answered"
			? await validateJudgment(tx, outcome.result, job)
			: null;
	if (result === undefined) {
		if (job.kind === "email_filing") await saveFilingJudgment(tx, job, []);
		return 422;
	}

	const summary = result && "summary" in result ? result : null;
	const split = result && "authored" in result ? result : null;
	if (summary)
		await sql`select pg_advisory_xact_lock(hashtextextended(${`email summary ${job.activity_id}`}, 0))`.execute(
			tx,
		);

	const { kind } = outcome;
	const blocked = kind === "signed_out" || kind === "plan_limited";
	const state = blocked ? "queued" : kind;
	const saved = await tx
		.updateTable("doc_judgment_job")
		.set({
			state,
			...clearJudgmentClaim,
			result,
		})
		.where("id", "=", job.id)
		.where("claim_id", "=", claim_id)
		.where(unexpired)
		.where(sql<boolean>`(${kind} <> 'answered' or exists (
			select 1 from email e
			where e.activity_id = doc_judgment_job.activity_id and ${sourceHash} = claim_source_hash
		))`)
		.executeTakeFirst();
	if (!saved.numUpdatedRows) return 404;
	if (job.kind === "email_filing" && state !== "queued")
		await saveFilingJudgment(
			tx,
			job,
			result && "facts" in result ? result.facts : [],
		);
	if (result && "introductions" in result)
		await saveIntroductions(tx, job.id, result);
	if (summary || split)
		await sql`select set_config('engine.job', 'mail_capture', true)`.execute(
			tx,
		);
	if (split)
		await tx
			.updateTable("email")
			.set(split)
			.where("activity_id", "=", job.activity_id)
			.where("authored", "is", null)
			.execute();
	if (summary) {
		await sql`
			select record_email_summary(${job.activity_id}, ${job.source_hash}, 'doc-link.email-summary.v1',
				'available', ${summary.summary}, jsonb_build_object(
					'action_title', ${summary.action_title}::text, 'quote', ${summary.quote}::text,
					'job_id', ${job.id}::uuid, 'job', 'mail_capture'
				), clock_timestamp())
			where not exists (select from email_current_summary where activity_id = ${job.activity_id})
		`.execute(tx);
	}
	if (blocked) await recordDocPoll(tx, owner, kind);
	return 204;
}

type DocResult = { claim_id: string } & (
	| { kind: "answered"; answer: unknown; answered_by?: "backup" }
	| { kind: "failed" | "signed_out" | "plan_limited" | "queued" }
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
		.set({
			state: blocked ? "queued" : kind,
			...clearClaim,
			answer,
			...(kind === "answered" &&
				result.answered_by && { answered_by: result.answered_by }),
		})
		.where("id", "=", turn.id)
		.where("owner_user_id", "=", owner)
		.where(unexpired)
		.executeTakeFirst();
	if (!saved.numUpdatedRows) return 404;
	if (blocked) await recordDocPoll(tx, owner, kind);
	return 204;
}
