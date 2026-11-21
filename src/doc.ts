import { type Context, Hono } from "hono";
import { type Selectable, sql, type Transaction } from "kysely";
import { Refusal, refuse, unregisteredFields } from "./answer.ts";
import type { JsonObject } from "./database.d.ts";
import { docLinkState } from "./doc-link.ts";
import { failureKind } from "./failure.ts";
import { nextTransaction } from "./next-connection.ts";
import type { DB } from "./next-database.d.ts";
import { ACTING_USER, stampNextSave } from "./next-save.ts";
import type { PartnerSessionEnv } from "./partner-session.ts";
import {
	idempotencyKey,
	SaveRefusal,
	sortedHash,
	type WriterEnv,
} from "./save.ts";
import { isArguments } from "./save-door.ts";
import { isUuid } from "./uuid.ts";

type DocEnv = WriterEnv & PartnerSessionEnv;
type DocTransaction = Transaction<DB>;

function reject(
	status: Refusal["status"],
	error: Refusal["error"],
	fields?: string[],
): never {
	throw new SaveRefusal(new Refusal(status, error, fields && { fields }));
}

type Ask = {
	key: string;
	args: {
		question: string;
		conversation_id?: string;
		context?: { kind: string; id: string };
	};
};

async function parseAsk(c: Context<DocEnv>): Promise<Ask> {
	const body: unknown = await c.req.json().catch(() => null);
	if (!isArguments(body)) return reject(400, "invalid_json");
	const extra = unregisteredFields(Object.keys(body), [
		"idempotency_key",
		"question",
		"conversation_id",
		"context",
	]);
	if (extra) throw new SaveRefusal(extra);
	const key = idempotencyKey(body).toLowerCase();
	if (body.question === undefined)
		return reject(400, "missing_required", ["question"]);
	const question =
		typeof body.question === "string" ? body.question.trim() : "";
	if (
		!question ||
		[...question].length > 4000 ||
		question.includes("\0") ||
		!question.isWellFormed()
	)
		return reject(400, "invalid_field_value", ["question"]);
	const { conversation_id, context } = body;
	if (conversation_id !== undefined && !isUuid(conversation_id))
		return reject(400, "invalid_field_value", ["conversation_id"]);
	const args = {
		question,
		...(conversation_id !== undefined && {
			conversation_id: conversation_id.toLowerCase(),
		}),
	};
	if (context === undefined) return { key, args };
	if (
		!isArguments(context) ||
		Object.keys(context).length !== 2 ||
		!isUuid(context.id) ||
		typeof context.kind !== "string" ||
		!["deal", "lead", "client", "email"].includes(context.kind)
	)
		return reject(400, "invalid_field_value", ["context"]);
	return {
		key,
		args: {
			...args,
			context: { kind: context.kind, id: context.id.toLowerCase() },
		},
	};
}

type Conversation = { id: string; created_at: string; title: string };
type Turn = Pick<
	Selectable<DB["doc_turn"]>,
	| "id"
	| "created_at"
	| "position"
	| "question"
	| "context"
	| "answer"
	| "idempotency_key"
> & {
	state: "queued" | "working" | "failed" | "answered";
	confirmation: JsonObject | null;
	waiting_reason: string | null;
};

const conversations = sql`
	select c.id, to_jsonb(c.created_at) #>> '{}' as created_at, left(t.question, 80) as title
	from doc_conversation c join doc_turn t
	  on t.conversation_id = c.id and t.owner_user_id = c.owner_user_id and t.position = 1
	where c.owner_user_id = ${ACTING_USER}`;

const queued = sql`(t.state = 'queued' or t.claim_until <= statement_timestamp())`;

const turnFields = sql`t.id, to_jsonb(t.created_at) #>> '{}' as created_at, t.position, t.question, t.context, t.answer, t.idempotency_key,
	case when ${queued} then 'queued' else t.state end as state,
	case when ${queued} then (
		select case status
			when 'not_set_up' then 'Doc isn''t set up on your Mac yet.'
			when 'mac_off' then 'Doc answers when your Mac is on.'
			when 'signed_out' then 'Sign in to Claude Code on your Mac.'
			when 'plan_limited' then 'Doc is paused until your Claude plan resets.'
			when 'ready' then 'Doc is waiting for a free slot on your Mac.'
		end from ${docLinkState(sql<string>`t.owner_user_id`)} link
	) end as waiting_reason,
	(select answer -> 'result' from save_receipt where idempotency_key = t.confirmation_key) as confirmation`;

async function listChats(tx: DocTransaction, before?: string) {
	if (
		before !== undefined &&
		(!isUuid(before) ||
			!(
				await sql<Conversation>`${conversations} and c.id = ${before}`.execute(
					tx,
				)
			).rows.length)
	)
		reject(404, "not_found");
	const cursor = before
		? sql`and (c.created_at, c.id) < (select created_at, id
		from doc_conversation where id = ${before} and owner_user_id = ${ACTING_USER})`
		: sql``;
	const { rows } = await sql<Conversation>`${conversations} ${cursor}
		order by c.created_at desc, c.id desc limit 31`.execute(tx);
	return {
		conversations: rows.slice(0, 30),
		next_before: rows[30] ? rows[29]?.id : null,
	};
}

async function lockChat(tx: DocTransaction, id: string) {
	const { rows } = await sql`select id from doc_conversation
		where id = ${id} and owner_user_id = ${ACTING_USER} for update`.execute(tx);
	if (!rows.length) reject(404, "not_found");
}

const turnInChat = (id: string) => sql`from doc_turn t
	where t.conversation_id = ${id} and t.owner_user_id = ${ACTING_USER}`;

type PriorTurn = { question: string; answer: JsonObject };

export async function recentDocTurns(
	tx: DocTransaction,
	conversation: string,
	position: number,
) {
	const { rows } =
		await sql<PriorTurn>`select question, answer ${turnInChat(conversation)}
		and position < ${position} and state = 'answered' order by position desc limit 12`.execute(
			tx,
		);
	return rows.reverse();
}

async function reserve(tx: DocTransaction, { key, args }: Ask) {
	const request_hash = sortedHash(args);
	await sql`select pg_advisory_xact_lock(hashtextextended(
		'doc:' || ${ACTING_USER}::text || ':' || ${key}, 0))`.execute(tx);
	const prior = await tx
		.selectFrom("doc_turn")
		.select(["id", "conversation_id", "request_hash"])
		.where("owner_user_id", "=", ACTING_USER)
		.where("idempotency_key", "=", key)
		.executeTakeFirst();
	if (prior && prior.request_hash !== request_hash) reject(409, "key_reuse");

	const existing = prior?.conversation_id ?? args.conversation_id;
	if (existing) await lockChat(tx, existing);
	const conversation_id =
		existing ??
		(
			await tx
				.insertInto("doc_conversation")
				.values({ owner_user_id: ACTING_USER })
				.returning("id")
				.executeTakeFirstOrThrow()
		).id;
	const {
		rows: [latest],
	} = await sql<Turn>`select ${turnFields} ${turnInChat(conversation_id)}
		order by t.position desc limit 1`.execute(tx);
	if (prior) {
		const {
			rows: [turn],
		} = await sql<Turn>`select ${turnFields} ${turnInChat(conversation_id)}
			and t.id = ${prior.id}`.execute(tx);
		if (!turn) return reject(404, "not_found");
		if (turn.state !== "failed") return { conversation_id, turn };
		if (latest?.id !== turn.id) reject(409, "turn_superseded");
		const queued = await sql<Turn>`update doc_turn as t set state = 'queued'
			where id = ${turn.id} and owner_user_id = ${ACTING_USER}
			returning ${turnFields}`.execute(tx);
		if (!queued.rows[0]) throw new Error("Doc retry returned no turn");
		return { conversation_id, turn: queued.rows[0] };
	}

	if (latest?.state === "working" || latest?.state === "queued")
		reject(409, "turn_in_progress");
	const {
		rows: [turn],
	} = await sql<Turn>`insert into doc_turn as t
		(conversation_id, owner_user_id, position, idempotency_key, request_hash, question, context, state)
		values (${conversation_id}, ${ACTING_USER}, ${(latest?.position ?? 0) + 1}, ${key},
			${request_hash}, ${args.question}, ${args.context ?? null}, 'queued')
		returning ${turnFields}`.execute(tx);
	if (!turn) throw new Error("Doc reservation returned no turn");
	return { conversation_id, turn };
}

function transact<T>(
	c: Context<DocEnv>,
	action: (tx: DocTransaction) => Promise<T>,
) {
	const writer = c.env.DATABASE_WRITER;
	if (!writer) return reject(503, "database_unavailable");
	return nextTransaction(writer.connectionString, "save", async (tx) => {
		await stampNextSave(tx, { user: c.get("partner").slug });
		return action(tx);
	});
}

export function docRoutes() {
	return new Hono<DocEnv>()
		.onError((error, c) => {
			if (error instanceof SaveRefusal) return refuse(c, error.refusal);
			console.warn("Doc database operation failed:", failureKind(error));
			return refuse(c, new Refusal(503, "database_unavailable"));
		})
		.get("/conversations", async (c) =>
			c.json(await transact(c, (tx) => listChats(tx, c.req.query("before")))),
		)
		.get("/conversations/:id", async (c) => {
			const id = c.req.param("id");
			if (!isUuid(id)) return reject(404, "not_found");
			return c.json(
				await transact(c, async (tx) => {
					const {
						rows: [conversation],
					} =
						await sql<Conversation>`${conversations} and c.id = ${id}`.execute(
							tx,
						);
					if (!conversation) return reject(404, "not_found");
					const { rows: turns } =
						await sql<Turn>`select ${turnFields} ${turnInChat(id)}
					order by t.position`.execute(tx);
					return { conversation, turns };
				}),
			);
		})
		.post("/turns", async (c) => {
			const request = await parseAsk(c);
			const result = await transact(c, (tx) => reserve(tx, request));
			return c.json(result, result.turn.state === "answered" ? 200 : 202);
		});
}
