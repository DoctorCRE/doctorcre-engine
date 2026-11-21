import { type Selectable, sql, type Transaction } from "kysely";
import { recentDocTurns } from "./doc.ts";
import { recordDocPoll } from "./doc-link.ts";
import { type DocClaimState, validateDocAnswer } from "./doc-tools.ts";
import type { DB } from "./next-database.d.ts";

const clearClaim = { claim_id: null, claim_until: null, claim_state: null };
const initialClaim = { reads: 0, sources: {} } satisfies DocClaimState;
const unexpired = sql<boolean>`claim_until > clock_timestamp()`;

type ClaimableTurn = Pick<
	Selectable<DB["doc_turn"]>,
	"id" | "conversation_id" | "position" | "question" | "context"
>;

export async function claimDocTurn(tx: Transaction<DB>, owner: string) {
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
			claim_until: sql`clock_timestamp() + interval '60 seconds'`,
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
