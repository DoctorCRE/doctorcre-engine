import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, test } from "node:test";
import { Hono } from "hono";
import pg from "pg";
import { docRoutes, recentDocTurns } from "./doc.ts";
import { dispatchDocBackup } from "./doc-backup.ts";
import { docLinkOwnerTransaction, issueDocLink } from "./doc-link.ts";
import { claimDocLink, completeDocLink } from "./doc-link-routes.ts";
import { docMcp } from "./doc-mcp.ts";
import { findDocRecords } from "./doc-reads.ts";
import { homeInbox } from "./home-inbox.ts";
import { nextTransaction } from "./next-connection.ts";
import { jobStamp, type NextSaveEnv } from "./next-door.ts";
import { replyJobs } from "./reply-drafts.ts";
import { copyTest, readSchema } from "./test-copy.ts";

const { db, setup, cleanup, connectionString } = copyTest();
const owner = randomUUID();
const other = randomUUID();
const nonPartner = randomUUID();
const question = {
	idempotency_key: randomUUID(),
	question: "What should I review?",
};
const refusal = {
	kind: "refusal" as const,
	text: "Doc cannot help with that.",
	sources: [],
	proposal: null,
};

before(async () => {
	await setup();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into party (id, kind, name) values
			('${owner}', 'person', 'Example One'), ('${other}', 'person', 'Example Two'),
			('${nonPartner}', 'person', 'Example Three');
		insert into app_user (id, slug) values
			('${owner}', 'joe'), ('${other}', 'dell'), ('${nonPartner}', 'former_partner');
		insert into role (slug, label) values ('lead', 'Lead'), ('client', 'Client');
		insert into stage (role, slug, label) values ('lead', 'qualified', 'Qualified');
		insert into how_found (slug, label) values ('referral', 'Referral');
		commit;`);
});
afterEach(() =>
	db.query(`begin; set local engine.job = 'old_system';
		delete from reply_draft where confirmed_doc_turn_id is not null or proposed_by_job = 'mail_capture';
		delete from doc_turn; delete from doc_conversation; truncate doc_link;
		commit;`),
);
after(cleanup);

type Chat = { id: string; title: string };
type Turn = {
	id: string;
	idempotency_key: string;
	state: string;
	position: number;
	answer: unknown;
	answered_by: "mac" | "backup" | null;
	context: unknown;
	draft_review: unknown;
	waiting_reason: string | null;
	confirmation: unknown;
};
type Body<Path> = { error?: string } & (Path extends "/turns"
	? { conversation_id: string; turn: Turn }
	: Path extends `/conversations/${string}`
		? { conversation: Chat; turns: Turn[] }
		: Path extends `/turns/${string}/confirmation`
			? {
					result: unknown;
					replayed?: true;
					next_step_id?: string;
					href?: string;
				}
			: { conversations: Chat[]; next_before: string | null });

function client(user = "joe", writer = connectionString) {
	const api = docRoutes();
	const app = new Hono<typeof api extends Hono<infer Env> ? Env : never>();
	app.use("*", async (c, next) => {
		c.set("partner", { slug: user, display: "Example Partner" });
		await next();
	});
	app.route("/", api);
	app.route("/", homeInbox);
	return async <Path extends string>(
		path: Path,
		status: number | number[],
		body?: object,
	) => {
		const response = await app.request(
			path,
			body && { method: "POST", body: JSON.stringify(body) },
			{
				DATABASE_WRITER: { connectionString: writer },
				DATABASE: { connectionString },
				HOME_INBOX_READ_SCHEMA: "next",
			},
		);
		const result = await response.json<Body<Path>>();
		if (typeof status === "number")
			assert.equal(response.status, status, JSON.stringify(result));
		else assert.ok(status.includes(response.status), JSON.stringify(result));
		return result;
	};
}

const expire = (id: string) =>
	db.query("update doc_turn set claim_until = '-infinity' where id = $1", [id]);

const mac = new Hono<{
	Bindings: {
		DATABASE_WRITER: { connectionString: string };
		DATABASE?: { connectionString: string };
	};
}>()
	.post("/claim", claimDocLink)
	.post("/result", completeDocLink)
	.post("/mcp", docMcp);

const issue = async (user: string) =>
	(
		await docLinkOwnerTransaction(connectionString, user, (tx) =>
			issueDocLink(tx, user),
		)
	).credential;
const poll = async (credential: string, readiness: string | null = "ready") =>
	mac.request(
		"/claim",
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${credential}`,
				...(readiness === null ? {} : { "Doc-Link-Readiness": readiness }),
			},
		},
		{ DATABASE_WRITER: { connectionString } },
	);

type Claim = {
	kind: "turn";
	claim_id: string;
	conversation_id: string;
	turn: { id: string; question: string; context: unknown };
	history: { question: string; answer: typeof refusal }[];
};

async function claim(credential: string) {
	const response = await poll(credential);
	assert.equal(response.status, 200);
	return response.json<Claim>();
}

const backupEnv = {
	DOC_BACKUP: "true",
	DOC_BACKUP_API_KEY: "fixture-key",
	DOC_BACKUP_MODEL: "claude-sonnet-5-5",
	DATABASE: { connectionString },
	DATABASE_WRITER: { connectionString },
};
const tick = (env = backupEnv) => dispatchDocBackup(env);
const modelReply = (content: object[], stop_reason = "end_turn") =>
	Response.json({
		type: "message",
		role: "assistant",
		stop_reason,
		content,
		usage: { output_tokens: 10 },
	});
const reply = (answer: object = refusal) =>
	modelReply([{ type: "text", text: JSON.stringify(answer) }]);
const askDoc = (user = "joe") =>
	client(user)("/turns", 202, { ...question, idempotency_key: randomUUID() });
const chatTurn = async (chat: string, user = "joe") =>
	(await client(user)(`/conversations/${chat}`, 200)).turns[0];

test("backup answers an unready partner's turn using Doc's read tools", async (t) => {
	const { conversation_id } = await askDoc();
	const lead = await exampleLead("Example Backup Lead");
	const answer = {
		kind: "answer",
		text: "Here is your example lead.",
		sources: [`lead:${lead.ref.id}`],
	};
	let calls = 0;
	t.mock.method(globalThis, "fetch", async () =>
		++calls === 1
			? modelReply(
					[
						{
							type: "tool_use",
							id: "find_lead",
							name: "find",
							input: { kind: "lead", query: "Example Backup Lead" },
						},
					],
					"tool_use",
				)
			: reply(answer),
	);
	await tick();
	const saved = await chatTurn(conversation_id);
	assert.equal(calls, 2);
	assert.equal(saved?.answered_by, "backup");
});

test("backup waits for the ready Mac and skips its live claim even after two minutes", async (t) => {
	const credential = await issue(owner);
	assert.equal((await poll(credential)).status, 204);
	const { conversation_id, turn } = await askDoc();
	const fetch = t.mock.method(globalThis, "fetch", async () => reply());
	await tick();
	assert.equal(fetch.mock.callCount(), 0);
	assert.equal((await chatTurn(conversation_id))?.state, "queued");
	await db.query(
		"update doc_turn set created_at = clock_timestamp() - interval '2 minutes' where id = $1",
		[turn.id],
	);
	assert.equal((await claim(credential)).turn.id, turn.id);
	await tick();
	assert.equal(fetch.mock.callCount(), 0);
	assert.equal((await chatTurn(conversation_id))?.state, "working");
	await expire(turn.id);
	await tick();
	assert.equal(fetch.mock.callCount(), 1);
	assert.equal((await chatTurn(conversation_id))?.answered_by, "backup");
});

test("a Mac taking over an expired backup claim keeps its own answer", async (t) => {
	const { conversation_id, turn } = await askDoc();
	const credential = await issue(owner);
	const macAnswer = { ...refusal, text: "The Mac answered." };
	const fetch = t.mock.method(globalThis, "fetch", async () => {
		assert.equal((await poll(credential)).status, 204);
		await expire(turn.id);
		const { claim_id } = await claim(credential);
		const response = await complete(credential, {
			kind: "answered",
			claim_id,
			answer: macAnswer,
		});
		assert.equal(response.status, 204);
		return reply();
	});
	await tick();
	assert.equal(fetch.mock.callCount(), 1);
	const saved = await chatTurn(conversation_id);
	assert.deepEqual(saved?.answer, macAnswer);
	assert.equal(saved.answered_by, "mac");
});

test("backup credit exhaustion leaves both partners' turns queued and sends one request each tick until recovery", async (t) => {
	const partners = await Promise.all(
		["joe", "dell"].map(async (user) => ({ user, ...(await askDoc(user)) })),
	);
	let depleted = true;
	const fetch = t.mock.method(globalThis, "fetch", async () =>
		depleted
			? Response.json(
					{
						error: {
							type: "invalid_request_error",
							message:
								"Your credit balance is too low to access the Anthropic API.",
						},
					},
					{ status: 400 },
				)
			: reply(),
	);
	for (const expected of [1, 2]) {
		await tick();
		assert.equal(fetch.mock.callCount(), expected);
		for (const { user, conversation_id, turn } of partners)
			assert.deepEqual(await chatTurn(conversation_id, user), turn);
	}
	depleted = false;
	await tick();
	for (const { user, conversation_id } of partners)
		assert.equal(
			(await chatTurn(conversation_id, user))?.answered_by,
			"backup",
		);
});

test("a failed backup answer leaves the other partner's turn free to finish", async (t) => {
	const [first, second] = owner < other ? ["joe", "dell"] : ["dell", "joe"];
	const failed = await askDoc(first);
	const eligible = await askDoc(second);
	let calls = 0;
	t.mock.method(globalThis, "fetch", async () =>
		++calls === 1 ? modelReply([], "max_tokens") : reply(),
	);
	await tick();
	assert.equal(
		(await chatTurn(eligible.conversation_id, second))?.answered_by,
		"backup",
	);
	assert.equal(
		(await chatTurn(failed.conversation_id, first))?.state,
		"failed",
	);
	await tick();
	assert.equal(calls, 2);
});

test("retrying an old failed turn gives the ready Mac two minutes again", async (t) => {
	const send = client();
	const ask = { ...question, idempotency_key: randomUUID() };
	const { turn, conversation_id } = await send("/turns", 202, ask);
	const credential = await issue(owner);
	const { claim_id } = await claim(credential);
	assert.equal(
		(await complete(credential, { claim_id, kind: "failed" })).status,
		204,
	);
	await db.query(
		"update doc_turn set created_at = clock_timestamp() - interval '5 minutes' where id = $1",
		[turn.id],
	);
	assert.equal((await send("/turns", 202, ask)).turn.id, turn.id);
	const fetch = t.mock.method(globalThis, "fetch", async () => reply());
	await tick();
	assert.equal(fetch.mock.callCount(), 0);
	assert.equal((await chatTurn(conversation_id))?.state, "queued");
});

test("backup switched off leaves turns available to the Mac before the migration", async (t) => {
	const migration = await readSchema("add-doc-answered-by.sql");
	await db.query(`drop trigger stamp_doc_turn_requeue on doc_turn;
		drop function stamp_doc_turn_requeue();
		alter table doc_turn drop column answered_by, drop column requeued_at`);
	t.after(() => db.query(migration));
	const { conversation_id, turn } = await askDoc();
	const fetch = t.mock.method(globalThis, "fetch", async () => reply());
	await tick({ ...backupEnv, DOC_BACKUP: "false" });
	assert.equal(fetch.mock.callCount(), 0);
	assert.deepEqual(await chatTurn(conversation_id), turn);
	const credential = await issue(owner);
	const { claim_id } = await claim(credential);
	assert.equal(
		(
			await complete(credential, {
				kind: "answered",
				claim_id,
				answer: refusal,
			})
		).status,
		204,
	);
	assert.equal((await chatTurn(conversation_id))?.answered_by, "mac");
});

test("keeps a question and its key while a Mac has never connected", async () => {
	const send = client();
	const ask = { ...question, idempotency_key: randomUUID() };
	const created = await send("/turns", 202, ask);
	assert.equal(created.turn.state, "queued");
	assert.equal(
		created.turn.waiting_reason,
		"Doc isn't set up on your Mac yet.",
	);
	assert.deepEqual(await send("/turns", 202, ask), created);
	const chat = `/conversations/${created.conversation_id}` as const;
	assert.equal(created.turn.draft_review, null);
	assert.deepEqual((await send(chat, 200)).turns, [created.turn]);
	assert.equal(
		(
			await send("/turns", 409, {
				...ask,
				conversation_id: created.conversation_id,
			})
		).error,
		"key_reuse",
	);
	assert.equal(
		(
			await send("/turns", 409, {
				...ask,
				idempotency_key: randomUUID(),
				conversation_id: created.conversation_id,
			})
		).error,
		"turn_in_progress",
	);
	assert.equal((await client("dell")(chat, 404)).error, "not_found");
});

test("simultaneous first asks with the same key share a queued turn", async () => {
	const send = client();
	const ask = { ...question, idempotency_key: randomUUID() };
	const [first, second] = await Promise.all([
		send("/turns", 202, ask),
		send("/turns", 202, ask),
	]);
	assert.deepEqual(first, second);
	assert.equal(first.turn.state, "queued");
});

test("ready polling claims the oldest turn and an expired claim is queued again", async () => {
	const send = client();
	const credential = await issue(owner);
	const ask = { ...question, idempotency_key: randomUUID() };
	const { conversation_id, turn } = await send("/turns", 202, ask);
	const chat = `/conversations/${conversation_id}` as const;
	const next = await send("/turns", 202, {
		...ask,
		idempotency_key: randomUUID(),
	});
	const polls = await Promise.all([poll(credential), poll(credential)]);
	assert.deepEqual(polls.map(({ status }) => status).sort(), [200, 204]);
	const picked = polls.find(({ status }) => status === 200);
	assert.ok(picked);
	const first = await picked.json<Claim>();
	assert.equal(first.kind, "turn");
	assert.equal(first.turn.id, turn.id);
	assert.equal(first.turn.question, ask.question);
	assert.equal(first.conversation_id, conversation_id);
	assert.deepEqual(first.history, []);
	assert.equal((await poll(credential)).status, 204);
	assert.equal(
		(await send(`/conversations/${next.conversation_id}`, 200)).turns[0]
			?.waiting_reason,
		"Doc is waiting for a free slot on your Mac.",
	);
	assert.equal((await send(chat, 200)).turns[0]?.state, "working");
	await expire(turn.id);
	assert.equal((await send(chat, 200)).turns[0]?.state, "queued");
	assert.equal((await send("/turns", 202, ask)).turn.state, "queued");
	const second = await claim(credential);
	assert.equal(second.turn.id, turn.id);
	assert.notEqual(second.claim_id, first.claim_id);
});

test("reclaims the oldest turn when its claim expires during a poll", async () => {
	const send = client();
	const credential = await issue(owner);
	const oldest = await send("/turns", 202, {
		...question,
		idempotency_key: randomUUID(),
	});
	const original = await claim(credential);
	await send("/turns", 202, { ...question, idempotency_key: randomUUID() });
	await db.query(
		"update doc_turn set created_at = '2000-01-01', claim_until = 'infinity' where id = $1",
		[oldest.turn.id],
	);

	await db.query(`
		create function next.hold_doc_turn_update() returns trigger language plpgsql as $$
		begin
			perform pg_advisory_xact_lock(992);
			return null;
		end;
		$$;
		grant execute on function next.hold_doc_turn_update() to engine;
		create trigger hold_doc_turn_update before update on doc_turn
		for each statement execute function next.hold_doc_turn_update();
	`);
	await db.query("begin; select pg_advisory_xact_lock(992)");
	let finished = false;
	const pending = poll(credential).finally(() => {
		finished = true;
	});
	try {
		const deadline = AbortSignal.timeout(5_000);
		while (!finished && !deadline.aborted) {
			const blocked = await db.query(`select 1 from pg_locks
				where locktype = 'advisory' and not granted
				and pg_backend_pid() = any(pg_blocking_pids(pid))`);
			if (blocked.rowCount) break;
		}
		assert.ok(
			!deadline.aborted,
			"Mac poll neither reached the lock nor returned",
		);
		// Pause expiry cleanup after it takes its snapshot, if the poll runs it.
		await db.query(
			"update doc_turn set claim_until = clock_timestamp() where id = $1",
			[oldest.turn.id],
		);
	} catch (error) {
		await db.query("rollback");
		await pending;
		throw error;
	}
	await db.query("commit");
	const response = await pending;
	await db.query(`drop trigger hold_doc_turn_update on doc_turn;
		drop function next.hold_doc_turn_update()`);
	assert.ok([200, 204].includes(response.status));
	const retried =
		response.status === 204
			? await claim(credential)
			: await response.json<Claim>();
	assert.equal(
		retried.turn.id,
		oldest.turn.id,
		"the oldest turn keeps its place",
	);
	assert.notEqual(retried.claim_id, original.claim_id);
});

test("presence-only polls keep the last readiness report visible", async () => {
	const send = client();
	const credential = await issue(owner);
	const { conversation_id } = await send("/turns", 202, {
		...question,
		idempotency_key: randomUUID(),
	});
	const chat = `/conversations/${conversation_id}` as const;
	const waitingReason = async () =>
		(await send(chat, 200)).turns[0]?.waiting_reason;
	for (const [readiness, reason] of [
		["signed_out", "Sign in to Claude Code on your Mac."],
		["plan_limited", "Doc is paused until your Claude plan resets."],
	]) {
		assert.equal((await poll(credential, readiness)).status, 204);
		await db.query(
			"update doc_link set last_seen_at = '-infinity' where owner_user_id = $1",
			[owner],
		);
		assert.equal(await waitingReason(), "Doc answers when your Mac is on.");
		assert.equal((await poll(credential, null)).status, 204);
		assert.equal(await waitingReason(), reason);
	}
});

test("reports why a question waits and claims it when ready", async () => {
	const send = client("dell");
	const credential = await issue(other);
	const { conversation_id, turn } = await send("/turns", 202, {
		...question,
		idempotency_key: randomUUID(),
	});
	const chat = `/conversations/${conversation_id}` as const;
	const current = async () => (await send(chat, 200)).turns[0];
	assert.equal(
		(await current())?.waiting_reason,
		"Doc answers when your Mac is on.",
	);
	assert.equal((await poll(credential, "signed_out")).status, 204);
	assert.equal(
		(await current())?.waiting_reason,
		"Sign in to Claude Code on your Mac.",
	);
	assert.equal((await poll(credential, "plan_limited")).status, 204);
	assert.equal(
		(await current())?.waiting_reason,
		"Doc is paused until your Claude plan resets.",
	);
	await db.query(
		"update doc_link set last_seen_at = '-infinity' where owner_user_id = $1",
		[other],
	);
	assert.equal(
		(await current())?.waiting_reason,
		"Doc answers when your Mac is on.",
	);
	const picked = await claim(credential);
	assert.equal(picked.turn.id, turn.id);
	assert.equal((await current())?.waiting_reason, null);
});

const complete = (credential: string, body: object) =>
	mac.request(
		"/result",
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${credential}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		},
		{ DATABASE_WRITER: { connectionString } },
	);

test("a foreign, expired or replaced claim cannot finish a turn", async () => {
	const send = client();
	const credential = await issue(owner);
	const foreign = await issue(other);
	const { turn, conversation_id } = await send("/turns", 202, {
		...question,
		idempotency_key: randomUUID(),
	});
	assert.equal((await poll(foreign)).status, 204);
	const first = await claim(credential);
	const response = {
		kind: "answered",
		claim_id: first.claim_id,
		answer: refusal,
	};
	assert.equal((await complete(foreign, response)).status, 404);
	await expire(turn.id);
	assert.equal((await complete(credential, response)).status, 404);
	const second = await claim(credential);
	assert.equal((await complete(credential, response)).status, 404);
	const completion = { ...response, claim_id: second.claim_id };
	assert.equal(
		(
			await complete(credential, {
				...completion,
				answer: {
					kind: "answer",
					text: "Unverified",
					sources: ["deal:missing"],
				},
			})
		).status,
		422,
	);
	assert.equal((await complete(credential, completion)).status, 204);
	assert.equal((await complete(credential, completion)).status, 404);
	const chat = `/conversations/${conversation_id}` as const;
	const { turns } = await send(chat, 200);
	assert.equal(turns[0]?.state, "answered");
	assert.deepEqual(turns[0]?.answer, refusal);
	assert.equal(turns[0]?.waiting_reason, null);
	const next = await send("/turns", 202, {
		...question,
		idempotency_key: randomUUID(),
		conversation_id,
	});
	assert.equal(next.turn.position, 2);
	const followUp = await claim(credential);
	assert.equal(followUp.turn.id, next.turn.id);
	assert.deepEqual(followUp.history, [
		{ question: question.question, answer: refusal },
	]);
});

test("a blocker releases the active claim and an explicit failure stays retryable", async () => {
	const send = client();
	const credential = await issue(owner);
	const ask = { ...question, idempotency_key: randomUUID() };
	const { turn, conversation_id } = await send("/turns", 202, ask);
	const chat = `/conversations/${conversation_id}` as const;
	const current = async () => (await send(chat, 200)).turns[0];
	const first = await claim(credential);
	assert.equal(
		(
			await complete(credential, {
				kind: "plan_limited",
				claim_id: first.claim_id,
			})
		).status,
		204,
	);
	assert.equal(
		(await current())?.waiting_reason,
		"Doc is paused until your Claude plan resets.",
	);
	assert.equal((await poll(credential, "plan_limited")).status, 204);

	const second = await claim(credential);
	assert.equal(
		(await complete(credential, { kind: "failed", claim_id: second.claim_id }))
			.status,
		204,
	);
	assert.equal((await current())?.state, "failed");
	const retry = await send("/turns", 202, ask);
	assert.equal(retry.turn.id, turn.id);
	assert.equal(
		retry.turn.waiting_reason,
		"Doc is waiting for a free slot on your Mac.",
	);

	const third = await claim(credential);
	assert.equal(
		(await complete(credential, { kind: "failed", claim_id: third.claim_id }))
			.status,
		204,
	);
	await send("/turns", 202, {
		...ask,
		idempotency_key: randomUUID(),
		conversation_id,
	});
	assert.equal((await send("/turns", 409, ask)).error, "turn_superseded");
});

test("bounds questions and pages stable ties by conversation ID", async () => {
	const send = client();
	const prefix = "📋".repeat(4000);
	const ask = {
		...question,
		idempotency_key: randomUUID(),
		context: { kind: "deal", id: randomUUID() },
	};
	assert.equal(
		(await send("/turns", 400, { ...ask, question: `${prefix}a` })).error,
		"invalid_field_value",
	);
	assert.equal(
		(await send("/turns", 400, { ...ask, question: "   " })).error,
		"invalid_field_value",
	);
	const saved = await send("/turns", 202, { ...ask, question: prefix });
	assert.deepEqual(saved.turn.context, ask.context);
	const { rows } = await db.query<{ id: string }>(
		`with chats as (
		insert into doc_conversation (id, owner_user_id, created_at)
		select gen_random_uuid(), $1, '2099-01-01' from generate_series(1, 31) returning id
	), turns as (
		insert into doc_turn (conversation_id, owner_user_id, position, idempotency_key, request_hash, question, state)
		select id, $1, 1, gen_random_uuid(), 'example', 'Sample', 'failed' from chats
	) select id from chats order by id desc`,
		[owner],
	);
	const page = await send("/conversations", 200);
	assert.deepEqual(
		page.conversations.map((chat: { id: string }) => chat.id),
		rows.slice(0, 30).map(({ id }) => id),
	);
	assert.equal(page.next_before, rows[29]?.id);
	const older = await send(`/conversations?before=${page.next_before}`, 200);
	assert.equal(older.conversations[0]?.id, rows[30]?.id);
	assert.equal(older.next_before, null);
	const { conversation } = await send(
		`/conversations/${saved.conversation_id}`,
		200,
	);
	assert.equal(conversation.title, "📋".repeat(80));
});

test("the database enforces private ownership and valid turn rows", async () => {
	const conversation = randomUUID();
	const working = randomUUID();
	const key = randomUUID();
	await db.query(
		"insert into doc_conversation (id, owner_user_id) values ($1, $2)",
		[conversation, owner],
	);
	const invalid = [
		[{ state: "working", claim: randomUUID() }, "23505"],
		[{ position: 1 }, "23505"],
		[{ idempotency_key: key }, "23505"],
		[{ partner: other }, "23503"],
		[{ state: "answered" }, "23514"],
		[{ position: 0 }, "23514"],
		[{ question: "a".repeat(4001) }, "23514"],
	] as const;
	const insert = ({
		id = randomUUID(),
		partner = owner,
		position = 2,
		idempotency_key = randomUUID(),
		question = "Sample",
		state = "failed",
		claim = null,
	}: {
		id?: string;
		partner?: string;
		position?: number;
		idempotency_key?: string;
		question?: string;
		state?: string;
		claim?: string | null;
	}) =>
		db.query(
			`insert into doc_turn
			(id, conversation_id, owner_user_id, position, idempotency_key, question, request_hash, state, claim_id, claim_until, claim_state)
			values ($1, $2, $3, $4, $5, $6, 'example', $7, $8::uuid, case when $8 is not null then 'infinity'::timestamptz end, case when $8 is not null then '{"reads":0,"sources":{}}'::jsonb end)`,
			[
				id,
				conversation,
				partner,
				position,
				idempotency_key,
				question,
				state,
				claim,
			],
		);
	await insert({
		id: working,
		position: 1,
		idempotency_key: key,
		state: "working",
		claim: randomUUID(),
	});
	for (const [fields, code] of invalid)
		await assert.rejects(insert(fields), { code });
	await assert.rejects(
		db.query(
			"update doc_turn set confirmation_key = gen_random_uuid() where id = $1",
			[working],
		),
		{ code: "23514" },
	);
	for (const table of ["doc_conversation", "doc_turn"]) {
		await db.query("begin; set local role engine_reader");
		try {
			await assert.rejects(db.query(`select * from ${table}`), {
				code: "42501",
			});
		} finally {
			await db.query("rollback");
		}
		await db.query("begin; set local role engine");
		try {
			const visible = () =>
				db.query(`select id from ${table} where owner_user_id = $1`, [owner]);
			await db.query("select set_config('engine.user_id', $1, true)", [other]);
			assert.deepEqual((await visible()).rows, []);
			await db.query("select set_config('engine.user_id', $1, true)", [owner]);
			assert.ok((await visible()).rows.length);
			await db.query("set local engine.job = 'agent'");
			assert.deepEqual((await db.query(`select * from ${table}`)).rows, []);
		} finally {
			await db.query("rollback");
		}
	}
});

test("the engine role cannot insert another partner's Doc rows", async () => {
	const { rows } = await db.query<{ id: string }>(
		"insert into doc_conversation (owner_user_id) values ($1) returning id",
		[owner],
	);
	const conversation = rows[0]?.id;
	assert.ok(conversation);
	for (const [statement, values] of [
		["insert into doc_conversation (owner_user_id) values ($1)", [owner]],
		[
			`insert into doc_turn (conversation_id, owner_user_id, position, idempotency_key, request_hash, question, state)
		values ($1, $2, 1, gen_random_uuid(), 'example', 'Sample', 'failed')`,
			[conversation, owner],
		],
	] satisfies [string, string[]][]) {
		await db.query("begin; set local role engine");
		try {
			await db.query("select set_config('engine.user_id', $1, true)", [other]);
			await assert.rejects(db.query(statement, values), { code: "42501" });
		} finally {
			await db.query("rollback");
		}
	}
});

test("the database refuses a Doc conversation owned by a non-partner", async () => {
	await assert.rejects(
		db.query("insert into doc_conversation (owner_user_id) values ($1)", [
			nonPartner,
		]),
		{ code: "23503" },
	);
});

test("an answered proposal needs a matching save receipt at commit", async () => {
	await db.query("begin");
	try {
		await db.query(
			`with conversation as (
				insert into doc_conversation (owner_user_id) values ($1) returning id
			)
			insert into doc_turn (conversation_id, owner_user_id, position, idempotency_key,
				request_hash, question, state, answer, confirmation_key)
			select id, $1, 1, gen_random_uuid(), 'example', 'Sample', 'answered', $2, gen_random_uuid()
			from conversation`,
			[
				owner,
				{
					kind: "answer",
					text: "A proposed note",
					sources: [],
					proposal: { kind: "note", text: "Sample" },
				},
			],
		);
		await assert.rejects(db.query("commit"), { code: "23503" });
	} finally {
		await db.query("rollback");
	}
});

test("only the latest 12 private answered turns provide follow-up context", async () => {
	const conversation = randomUUID();
	await db.query(
		"insert into doc_conversation (id, owner_user_id) values ($1, $2)",
		[conversation, owner],
	);
	await db.query(
		`insert into doc_turn (conversation_id, owner_user_id, position, idempotency_key, request_hash,
			question, state, answer)
		select $1, $2, position, gen_random_uuid(), 'example', 'Question ' || position,
			case when position = 15 then 'failed' else 'answered' end,
			case when position <> 15 then '{"kind":"refusal","text":"Sample","sources":[],"proposal":null}'::jsonb end
		from generate_series(1, 16) position`,
		[conversation, owner],
	);
	const history = (user: string) =>
		docLinkOwnerTransaction(connectionString, user, (tx) =>
			recentDocTurns(tx, conversation, 16),
		);
	assert.deepEqual(await history(other), []);
	const own = await history(owner);
	assert.deepEqual(
		own.map(({ question }) => question),
		Array.from({ length: 12 }, (_, i) => `Question ${i + 3}`),
	);
});

test("the claim-state migration preserves old turns and enforces one queued or working turn", async (t) => {
	const old = copyTest();
	await old.setup();
	t.after(old.cleanup);
	await old.db.query(`alter table reply_draft drop constraint reply_draft_confirmed_doc_turn_owner_fkey;
		drop table doc_turn, doc_conversation`);
	await old.db.query(await readSchema("add-doc-conversations.sql"));
	const partner = randomUUID();
	const chat = randomUUID();
	const claim = randomUUID();
	await old.db.query(`begin; set local engine.job = 'old_system';
		insert into party (id, kind, name) values ('${partner}', 'person', 'Example Partner');
		insert into app_user (id, slug) values ('${partner}', 'joe');
		insert into doc_conversation (id, owner_user_id) values ('${chat}', '${partner}');
		insert into doc_turn (conversation_id, owner_user_id, position, idempotency_key, request_hash,
			question, state, claim_id, claim_until)
		values ('${chat}', '${partner}', 1, gen_random_uuid(), 'example', 'Existing question', 'working', '${claim}', 'infinity');
		commit;`);
	await old.db.query(await readSchema("add-doc-turn-claim.sql"));
	assert.deepEqual(
		(await old.db.query("select claim_id, claim_state, question from doc_turn"))
			.rows,
		[
			{
				claim_id: claim,
				claim_state: { reads: 0, sources: {} },
				question: "Existing question",
			},
		],
	);
	const queue = (position: number) =>
		old.db.query(
			`insert into doc_turn (conversation_id, owner_user_id, position, idempotency_key, request_hash, question, state)
			values ($1, $2, $3, gen_random_uuid(), 'example', 'Queued question', 'queued')`,
			[chat, partner, position],
		);
	await assert.rejects(queue(2), { code: "23505" });
	await assert.rejects(old.db.query("update doc_turn set claim_state = null"), {
		code: "23514",
	});
	await old.db.query(
		"update doc_turn set state = 'failed', claim_id = null, claim_until = null, claim_state = null",
	);
	await queue(2);
	await assert.rejects(queue(3), { code: "23505" });
	await assert.rejects(
		old.db.query(
			"update doc_turn set claim_state = '{}' where state = 'queued'",
		),
		{ code: "23514" },
	);
});

async function sharedDeal() {
	const id = randomUUID();
	await db.query(
		`with stamp as (select set_config('engine.job', 'old_system', true))
		insert into deal (id, name, owner_user_id) select $1::uuid, $1::uuid::text, $2 from stamp`,
		[id, other],
	);
	return { ref: { kind: "deal", id }, href: `/deals?deal=${id}` };
}

async function exampleLead(
	name: string,
	kind: "person" | "company" = "company",
) {
	const id = randomUUID();
	await db.query(
		`with stamp as (select set_config('engine.job', 'old_system', true)), lead as (
			insert into party (id, kind, name, how_found)
			select $1, $2, $3, 'referral' from stamp returning id
		)
		insert into party_role (party_id, role, stage) select id, 'lead', 'qualified' from lead`,
		[id, kind, name],
	);
	return { ref: { kind: "lead", id }, href: `/leads?lead=${id}` };
}

async function exampleClient(name: string) {
	const id = randomUUID();
	await db.query(
		`with stamp as (select set_config('engine.job', 'old_system', true)), company as (
			insert into party (id, kind, name, how_found)
			select $1, 'company', $2, 'referral' from stamp returning id
		), client_role as (
			insert into party_role (party_id, role) select id, 'client' from company returning party_id
		)
		insert into client (party_id, owner_user_id) select party_id, $3 from client_role`,
		[id, name, owner],
	);
	return id;
}

async function answeredProposal(proposal: object, partner = owner) {
	const id = randomUUID();
	const conversation_id = randomUUID();
	const answer = {
		kind: "answer",
		text: "Proposed save",
		sources: [],
		proposal,
	};
	await db.query(
		`with conversation as (
			insert into doc_conversation (id, owner_user_id) values ($1, $2) returning id
		)
		insert into doc_turn (id, conversation_id, owner_user_id, position, idempotency_key,
			request_hash, question, state, answer)
		select $3, id, $2, 1, gen_random_uuid(), 'example', 'Sample', 'answered', $4
		from conversation`,
		[conversation_id, partner, id, answer],
	);
	return { id, conversation_id, path: `/turns/${id}/confirmation` as const };
}

const nextStepProposal = {
	kind: "next_step",
	what: "Call next week",
	due_on: null,
};

test("Doc confirms exactly one edited note as the recorded partner", async () => {
	const target = await sharedDeal();
	const { path, conversation_id } = await answeredProposal({
		kind: "note",
		target,
		text: "Original note",
	});
	const notes = async () =>
		(
			await db.query(
				`select a.id, a.summary, a.changed_by_user_id, a.changed_by_job
			from activity a join activity_about link on link.activity_id = a.id
			where a.kind = 'note' and link.deal_id = $1`,
				[target.ref.id],
			)
		).rows;
	assert.deepEqual(await notes(), []);
	const send = client();
	const idempotency_key = randomUUID();
	const edits = { text: "Confirmed note" };
	assert.equal(
		(await send(path, 400, { idempotency_key, edits: { what: "Call" } })).error,
		"invalid_field_value",
	);
	const { result } = await send(path, 200, { idempotency_key, edits });
	const stored = await notes();
	assert.deepEqual(stored, [
		{
			id: stored[0]?.id,
			summary: edits.text,
			changed_by_user_id: owner,
			changed_by_job: null,
		},
	]);
	assert.deepEqual(result, {
		kind: "note",
		id: stored[0]?.id,
		href: target.href,
	});
	const chat = await send(`/conversations/${conversation_id}`, 200);
	assert.deepEqual(chat.turns[0]?.confirmation, result);
});

test("Doc confirms a next step on a client with the confirming partner as owner", async () => {
	const id = await exampleClient("Example Client");
	const href = `/clients?record=${id}`;
	const { path } = await answeredProposal(
		{
			...nextStepProposal,
			target: { ref: { kind: "client", id }, href },
		},
		other,
	);
	const due_on = "2027-01-12";
	const { result } = await client("dell")(path, 200, {
		idempotency_key: randomUUID(),
		edits: { due_on },
	});
	const { rows } = await db.query(
		`select id, what, due_on::text, owner_party_id, changed_by_user_id, changed_by_job
		from next_step where party_id = $1 and status = 'open'`,
		[id],
	);
	assert.deepEqual(rows, [
		{
			id: rows[0]?.id,
			what: nextStepProposal.what,
			due_on,
			owner_party_id: other,
			changed_by_user_id: other,
			changed_by_job: null,
		},
	]);
	assert.deepEqual(result, { kind: "next_step", id: rows[0]?.id, href });
});

test("concurrent Doc confirmations return the existing open step for that partner", async () => {
	const target = await sharedDeal();
	const proposal = { ...nextStepProposal, target };
	const first = await answeredProposal(proposal);
	const second = await answeredProposal(proposal);
	const third = await answeredProposal(proposal, other);
	const args = () => ({ idempotency_key: randomUUID(), edits: {} });
	const send = client();
	const outcomes = await Promise.all([
		send(first.path, [200, 409], args()),
		send(second.path, [200, 409], args()),
	]);
	const winner = outcomes.find((outcome) => outcome.result);
	const conflict = outcomes.find((outcome) => outcome.error);
	const {
		rows: [step],
	} = await db.query(
		"select id from next_step where deal_id = $1 and owner_party_id = $2 and status = 'open'",
		[target.ref.id, owner],
	);
	assert.ok(step);
	assert.deepEqual(winner?.result, {
		kind: "next_step",
		id: step.id,
		href: target.href,
	});
	assert.equal(conflict?.error, "open_step_exists");
	assert.equal(conflict.next_step_id, step.id);
	assert.equal(conflict.href, target.href);
	await client("dell")(third.path, 200, args());
	const { rows } = await db.query(
		"select owner_party_id from next_step where deal_id = $1 and status = 'open'",
		[target.ref.id],
	);
	assert.deepEqual(
		rows.map((row) => row.owner_party_id).sort(),
		[owner, other].sort(),
	);
});

test("Doc replays a lost confirmation and refuses different edits with the same key", async () => {
	const target = await sharedDeal();
	const { path } = await answeredProposal({ ...nextStepProposal, target });
	const send = client();
	const args = { idempotency_key: randomUUID(), edits: { what: "First text" } };
	const saved = await send(path, 200, args);
	assert.deepEqual(await send(path, 200, args), { ...saved, replayed: true });
	assert.equal(
		(await send(path, 409, { ...args, edits: { what: "Other text" } })).error,
		"key_reuse",
	);
	assert.equal(
		(await send(path, 409, { ...args, idempotency_key: randomUUID() })).error,
		"already_confirmed",
	);
});

test("Doc refuses a foreign turn and a proposal for a record that is gone", async () => {
	const target = await sharedDeal();
	const { path } = await answeredProposal({
		kind: "note",
		target,
		text: "Example",
	});
	const args = { idempotency_key: randomUUID(), edits: {} };
	assert.equal((await client("dell")(path, 404, args)).error, "not_found");
	await db.query(
		`with stamp as (select set_config('engine.job', 'old_system', true))
		delete from deal using stamp where deal.id = $1`,
		[target.ref.id],
	);
	assert.equal((await client()(path, 409, args)).error, "target_changed");
});

async function waitForBlockedTransaction(
	observer: pg.Client,
	blocker?: number,
	lockType = "transactionid",
) {
	const deadline = AbortSignal.timeout(5_000);
	while (!deadline.aborted) {
		const {
			rows: [waiter],
		} = await observer.query<{ pid: number }>(
			`select pid from pg_locks where locktype = $2 and not granted
			and coalesce($1, pg_backend_pid()) = any(pg_blocking_pids(pid))`,
			[blocker, lockType],
		);
		if (waiter) return waiter.pid;
	}
	assert.fail("Expected a transaction to wait on the held lock");
}

async function mergeDuringConfirmation({
	target,
	survivor,
	victim,
}: {
	target: Awaited<ReturnType<typeof exampleLead>>;
	survivor: string;
	victim?: "doc" | "merge";
}) {
	const { path, conversation_id } = await answeredProposal(
		{
			...nextStepProposal,
			target,
		},
		victim === "merge" ? other : owner,
	);
	const { id } = target.ref;
	const writer = new URL(connectionString);
	writer.searchParams.set(
		"options",
		`-c statement_timeout=15s -c deadlock_timeout=${victim === "doc" ? "1ms" : "1min"}`,
	);
	const merge = () => db.query("select merge_party($1, $2)", [id, survivor]);
	const gate =
		victim === "doc" ? new pg.Client({ connectionString }) : undefined;
	const idempotency_key = randomUUID();
	const send = client(victim === "merge" ? "dell" : "joe", writer.href);
	const args = {
		idempotency_key,
		edits: {},
	};
	let settled: Promise<unknown> | undefined;
	await gate?.connect();
	await db.query("begin");
	try {
		await db.query(`set local engine.job = 'old_system'; set local statement_timeout = '15s';
			set local deadlock_timeout = '${victim === "merge" ? "1ms" : "1min"}'`);
		await db.query("select id from party where id = $1 for update", [
			victim ? survivor : id,
		]);
		if (gate) {
			await gate.query("begin");
			await gate.query(
				"select from next.party_role where party_id = $1 and role = 'lead' for update",
				[id],
			);
		}
		const confirmed = send(path, victim === "merge" ? 200 : [409, 503], args);
		settled = Promise.allSettled([confirmed]);
		if (gate) {
			const docPid = await waitForBlockedTransaction(gate);
			await Promise.all([
				merge(),
				waitForBlockedTransaction(gate, docPid).then(() =>
					gate.query("commit"),
				),
			]);
		} else {
			await waitForBlockedTransaction(db);
			if (!victim) {
				// Keep the retry from masking a reversed lock order.
				await db.query(
					"select from party_role where party_id = $1 and role = 'lead' for update nowait",
					[id],
				);
			}
			if (victim === "merge") await assert.rejects(merge(), { code: "40P01" });
			else await merge();
		}
		await db.query(victim === "merge" ? "rollback" : "commit");
		return { confirmation: await confirmed, conversation_id, path, args };
	} catch (error) {
		await gate?.query("rollback");
		await db.query("rollback");
		await settled;
		throw error;
	} finally {
		await gate?.end();
	}
}

async function assertMergePreemptedConfirmation(
	{
		confirmation,
		conversation_id,
		args,
	}: Awaited<ReturnType<typeof mergeDuringConfirmation>>,
	parties: [string, string],
) {
	assert.equal(confirmation.error, "target_changed");
	const { turns } = await client()(`/conversations/${conversation_id}`, 200);
	assert.equal(turns[0]?.confirmation, null);
	assert.equal(
		(
			await db.query("select from save_receipt where idempotency_key = $1", [
				args.idempotency_key,
			])
		).rowCount,
		0,
	);
	assert.equal(
		(
			await db.query("select from next_step where party_id in ($1, $2)", [
				...parties,
			])
		).rowCount,
		0,
	);
}

test("a lead merge can finish while Doc confirmation is waiting on the party", async () => {
	const target = await exampleLead("Example Duplicate");
	const survivor = (await exampleLead("Example Survivor")).ref.id;
	const outcome = await mergeDuringConfirmation({ target, survivor });
	await assertMergePreemptedConfirmation(outcome, [target.ref.id, survivor]);
});

test("Doc retries when it closes the deadlock cycle and only its detector can fire", async () => {
	const target = await exampleLead("Example Doc Victim", "person");
	const outcome = await mergeDuringConfirmation({
		target,
		survivor: owner,
		victim: "doc",
	});
	await assertMergePreemptedConfirmation(outcome, [target.ref.id, owner]);
});

test("the merge must be rerun when it closes the deadlock cycle and only its detector can fire", async () => {
	const target = await exampleLead("Example Merge Victim", "person");
	const id = target.ref.id;
	const { confirmation, path, args } = await mergeDuringConfirmation({
		target,
		survivor: other,
		victim: "merge",
	});
	const steps = async () =>
		(
			await db.query<{ id: string }>(
				"select id, party_id, owner_party_id, what, status from next_step where party_id in ($1, $2)",
				[id, other],
			)
		).rows;
	const before = await steps();
	const [step] = before;
	assert.ok(step);
	assert.deepEqual(before, [
		{
			id: step.id,
			party_id: id,
			owner_party_id: other,
			what: nextStepProposal.what,
			status: "open",
		},
	]);
	assert.deepEqual(confirmation.result, {
		kind: "next_step",
		id: step.id,
		href: target.href,
	});
	const send = client("dell");
	assert.deepEqual(await send(path, 200, args), {
		...confirmation,
		replayed: true,
	});
	await db.query(
		`with stamp as (select set_config('engine.job', 'old_system', true))
		select merge_party($1, $2) from stamp`,
		[id, other],
	);
	assert.deepEqual(await steps(), [{ ...step, party_id: other }]);
	const survivor = {
		ref: { kind: "lead", id: other },
		href: `/leads?lead=${other}`,
	};
	const next = await answeredProposal(
		{ ...nextStepProposal, target: survivor },
		other,
	);
	const conflict = await send(next.path, 409, {
		...args,
		idempotency_key: randomUUID(),
	});
	assert.equal(conflict.error, "open_step_exists");
	assert.equal(conflict.next_step_id, step.id);
	assert.equal(conflict.href, survivor.href);
});

test("Doc refuses a step when a lead was linked to a client after the proposal", async () => {
	const name = "Example Linked Lead";
	const {
		ref: { id },
	} = await exampleLead(name);
	const clientId = await exampleClient(name);
	const findLead = () =>
		nextTransaction(connectionString, "read", (tx) =>
			findDocRecords(tx, id, "lead"),
		);
	const [target] = await findLead();
	assert.equal(target?.ref.id, id);
	const { path } = await answeredProposal({ ...nextStepProposal, target });
	await db.query(
		`with stamp as (select set_config('engine.user_id', $1, true))
		update party_role set lead_client_id = $2 from stamp where party_id = $3 and role = 'lead'`,
		[owner, clientId, id],
	);
	assert.deepEqual(await findLead(), []);
	assert.equal(
		(await client()(path, 409, { idempotency_key: randomUUID(), edits: {} }))
			.error,
		"target_changed",
	);
	assert.equal(
		(await db.query("select from next_step where party_id = $1", [id]))
			.rowCount,
		0,
	);
});

test("Doc confirms an exact pending revision with the existing edit and receipt rules", async () => {
	const id = randomUUID();
	const activity_id = randomUUID();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into activity (id, kind, happened_at) values ('${activity_id}', 'email', now());
		insert into email (activity_id, message_id, sender, subject, body)
			values ('${activity_id}', '${activity_id}@example.test', 'sender@example.test', 'Plan', 'When can you meet?');
		insert into email_mailbox values ('${activity_id}', '${owner}');
		insert into activity_about (activity_id, party_id) values ('${activity_id}', '${owner}');
		set local engine.job = 'mail_capture';
		insert into reply_draft (id, email_activity_id, owner_user_id, proposed_by_job, evidence, subject, body)
			values ('${id}', '${activity_id}', '${owner}', 'mail_capture', 'Asked for a date', 'Re: Plan', 'Monday');
		commit;`);
	const send = client();
	const foreign = client("dell");
	const credential = await issue(owner);
	const context = { kind: "reply_draft", id, version: 1 };
	const ask = { ...question, context, idempotency_key: randomUUID() };
	await foreign("/turns", 404, ask);

	async function propose(args: object, version: number) {
		const { conversation_id } = await send("/turns", 202, args);
		const work = await claim(credential);
		assert.deepEqual(work.turn.context, {
			...context,
			activity_id,
			mailbox_user_id: owner,
			version,
		});
		const source = `reply_draft:${id}`;
		const read = await mac.request(
			"/mcp",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${credential}`,
					"Doc-Claim-Id": work.claim_id,
					"Content-Type": "application/json",
					Accept: "application/json, text/event-stream",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/call",
					params: { name: "read", arguments: { source } },
				}),
			},
			{ DATABASE: { connectionString }, DATABASE_WRITER: { connectionString } },
		);
		assert.equal(read.status, 200);
		const { result } = await read.json<{
			result: { content: [{ text: string }] };
		}>();
		const facts = JSON.parse(result.content[0].text);
		assert.equal(facts.email.body, "When can you meet?");
		assert.equal(facts.draft.body, version === 1 ? "Monday" : "Wednesday");
		const outcome = await complete(credential, {
			kind: "answered",
			claim_id: work.claim_id,
			answer: {
				kind: "answer",
				text: "Wednesday works.",
				sources: [source],
				proposal: { kind: "reply_revision", source, body: "Wednesday" },
			},
		});
		assert.equal(outcome.status, 204);
		return {
			conversation_id,
			path: `/turns/${work.turn.id}/confirmation` as const,
		};
	}

	const first = await propose(ask, 1);
	const stale = await propose({ ...ask, idempotency_key: randomUUID() }, 1);
	const failedAsk = {
		...question,
		conversation_id: first.conversation_id,
		idempotency_key: randomUUID(),
	};
	const failed = await send("/turns", 202, failedAsk);
	const work = await claim(credential);
	assert.equal(work.turn.id, failed.turn.id);
	assert.equal(
		(await complete(credential, { kind: "failed", claim_id: work.claim_id }))
			.status,
		204,
	);
	const edits = {
		idempotency_key: randomUUID(),
		edits: { subject: "Re: Updated plan" },
	};
	await foreign(first.path, 404, edits);
	const { result } = await send(first.path, 200, edits);
	assert.deepEqual(result, {
		kind: "reply_revision",
		id,
		version: 2,
		href: `/inbox/card/reply_draft%3A${id}`,
	});
	assert.deepEqual(await send(first.path, 200, edits), {
		result,
		replayed: true,
	});
	assert.partialDeepStrictEqual(await send("/turns", 409, failedAsk), {
		error: "version_conflict",
		version: 2,
	});
	assert.equal((await poll(credential)).status, 204);
	assert.equal((await send("/turns", 200, ask)).turn.state, "answered");
	assert.equal(
		(await send(stale.path, 409, { ...edits, idempotency_key: randomUUID() }))
			.error,
		"version_conflict",
	);

	const draft = await db.query(
		`select subject, body, revision, status, evidence, to_address
		from reply_draft where id = $1`,
		[id],
	);
	assert.deepEqual(draft.rows, [
		{
			subject: "Re: Updated plan",
			body: "Wednesday",
			revision: 2,
			status: "pending",
			evidence: "Asked for a date",
			to_address: null,
		},
	]);
	assert.equal(
		(await db.query("select from reply_draft where status = 'approved'"))
			.rowCount,
		0,
	);

	const current = await propose(
		{
			...question,
			conversation_id: first.conversation_id,
			idempotency_key: randomUUID(),
		},
		2,
	);
	await db.query(`begin; set local engine.job = 'mail_capture';
		update reply_draft set status = 'dismissed', dismiss_reason = 'Replaced' where id = '${id}';
		commit;`);
	assert.equal(
		(await send(current.path, 409, { ...edits, idempotency_key: randomUUID() }))
			.error,
		"draft_changed",
	);
	assert.equal(
		(await send("/turns", 409, { ...ask, idempotency_key: randomUUID() }))
			.error,
		"draft_changed",
	);
});

const proposedReply = { subject: "Re: Plan", body: "Wednesday works." };
const newReplyEdits = () => ({ idempotency_key: randomUUID(), edits: {} });
const newReply = (activity_id: string) =>
	answeredProposal({
		kind: "reply_draft",
		target: { ref: { kind: "email", id: activity_id } },
		...proposedReply,
	});

async function replyEmail(conversation: string | null = null, partner = owner) {
	const id = randomUUID();
	await db.query(
		`with stamp as (select set_config('engine.job', 'old_system', true)),
		a as (insert into activity (id, kind, happened_at) select $1::uuid, 'email', now() from stamp returning id),
		mail as (insert into email (activity_id, message_id, sender, subject, body, conversation_id)
			select id, id || '@example.test', 'sender@example.test', 'Plan', 'When can you meet?', $2
			from a returning activity_id),
		mailbox as (insert into email_mailbox select activity_id, $3::uuid from mail)
		insert into activity_about (activity_id, party_id) select activity_id, $3 from mail`,
		[id, conversation, partner],
	);
	return id;
}

const jobDrafts = new Hono<NextSaveEnv>()
	.use("*", jobStamp)
	.route("/", replyJobs);
async function storeJobDraft(activity_id: string) {
	const response = await jobDrafts.request(
		"/reply-drafts",
		{
			method: "POST",
			headers: { "Engine-Job": "mail_capture", "Engine-For-User": "joe" },
			body: JSON.stringify({
				idempotency_key: randomUUID(),
				activity_id,
				subject: "Re: Automatic plan",
				body: "The job's reply.",
				evidence: "When can you meet?",
			}),
		},
		{ DATABASE_WRITER: { connectionString } },
	);
	const body = await response.json<{ draft_id: string }>();
	assert.ok(response.ok, JSON.stringify(body));
	return body.draft_id;
}

test("Doc reports the saved draft version as its review changes", async () => {
	const id = await storeJobDraft(await replyEmail());
	const send = client();
	const { conversation_id, turn } = await send("/turns", 202, {
		...question,
		context: { kind: "reply_draft", id, version: 1 },
	});
	const chat = `/conversations/${conversation_id}` as const;
	const readReview = async () => (await send(chat, 200)).turns[0]?.draft_review;
	const pending = await readReview();
	await db.query(
		`with stamp as (select set_config('engine.user_id', $1, true))
		update reply_draft set body = 'A revised reply' from stamp where id = $2`,
		[owner, id],
	);
	const changed = await readReview();
	await db.query(
		`with stamp as (select set_config('engine.user_id', $1, true))
		update reply_draft set status = 'dismissed', dismiss_reason = 'Replaced'
		from stamp where id = $2`,
		[owner, id],
	);
	const dismissed = await readReview();
	assert.deepEqual(
		[turn.draft_review, pending, changed, dismissed],
		[
			{ draft_id: id, version: 1, current: "pending_same" },
			{ draft_id: id, version: 1, current: "pending_same" },
			{ draft_id: id, version: 1, current: "changed" },
			{ draft_id: id, version: 1, current: "gone" },
		],
	);
});

test("Doc treats a foreign draft in saved context as gone", async () => {
	const activity_id = await replyEmail();
	const id = await storeJobDraft(activity_id);
	const send = client("dell");
	const { conversation_id, turn } = await send("/turns", 202, question);
	await db.query(
		`with stamp as (select set_config('engine.job', 'old_system', true))
		insert into email_mailbox (activity_id, user_id) select $1, $2 from stamp`,
		[activity_id, other],
	);
	await db.query("update doc_turn set context = $1 where id = $2", [
		{
			kind: "reply_draft",
			id,
			version: 1,
			activity_id,
			mailbox_user_id: other,
		},
		turn.id,
	]);
	const { turns } = await send(`/conversations/${conversation_id}`, 200);
	assert.deepEqual(turns[0]?.draft_review, {
		draft_id: id,
		version: 1,
		current: "gone",
	});
});

const replyReceipt = (id: string, existing: boolean) => ({
	kind: "reply_draft",
	id,
	href: `/inbox/card/reply_draft%3A${id}`,
	existing,
});

test("Doc saves one pending reply, opens its review, and preserves it on repeat", async () => {
	const mail = await replyEmail();
	const { id, path } = await newReply(mail);
	const args = { ...newReplyEdits(), edits: { body: "Thursday works." } };
	const send = client();
	const { result } = await send(path, 200, args);
	const drafts = () =>
		db.query<{ id: string }>(
			`select id, status, revision, owner_user_id, changed_by_user_id, proposed_by_job,
		confirmed_doc_turn_id, subject, body from reply_draft where email_activity_id = $1`,
			[mail],
		);
	const {
		rows: [draft],
	} = await drafts();
	assert.ok(draft);
	assert.deepEqual(draft, {
		id: draft.id,
		status: "pending",
		revision: 1,
		owner_user_id: owner,
		changed_by_user_id: owner,
		proposed_by_job: null,
		confirmed_doc_turn_id: id,
		subject: proposedReply.subject,
		body: args.edits.body,
	});
	const expected = replyReceipt(draft.id, false);
	assert.deepEqual(result, expected);
	const href = expected.href;
	assert.partialDeepStrictEqual(
		await send(href.replace("/inbox/card/", "/home/cards/"), 200),
		{
			item_id: `reply_draft:${draft.id}`,
		},
	);
	assert.deepEqual(await send(path, 200, args), { result, replayed: true });
	assert.equal(
		(await send(path, 409, { ...args, edits: {} })).error,
		"key_reuse",
	);
	const repeat = await newReply(mail);
	assert.deepEqual(await send(repeat.path, 200, newReplyEdits()), {
		result: replyReceipt(draft.id, true),
	});
	assert.deepEqual((await drafts()).rows, [draft]);
});

async function openNewReply(mail: string) {
	const { path } = await newReply(mail);
	const send = client();
	const { result } = await send(path, 200, newReplyEdits());
	assert.ok(
		result && typeof result === "object" && "href" in result && "id" in result,
	);
	assert.ok(typeof result.href === "string" && typeof result.id === "string");
	assert.partialDeepStrictEqual(
		await send(result.href.replace("/inbox/card/", "/home/cards/"), 200),
		{
			item_id: `reply_draft:${result.id}`,
			reply_draft_status: "pending",
			source_activity: { id: mail },
		},
	);
	assert.partialDeepStrictEqual(result, { existing: false });
}

test("Doc opens a new pending reply when an approved reply leads the conversation", async () => {
	const conversation = randomUUID();
	const approved = await storeJobDraft(await replyEmail(conversation));
	await db.query(`begin; set local engine.user_id = '${owner}';
		update reply_draft set status = 'approved', to_address = 'sender@example.test',
			cc_address = 'copy@example.test' where id = '${approved}'; commit;`);
	const mail = await replyEmail(conversation);
	const send = client();
	const dashboard = () => send("/home/inbox?view=dashboard", 200);
	const before = await dashboard();
	assert.partialDeepStrictEqual(before, {
		waiting: { items: [{ reply_draft_id: approved }] },
	});
	await openNewReply(mail);
	assert.deepEqual(await dashboard(), before);
});

test("Doc opens a new reply when a job draft's source is in the other partner's mailbox", async () => {
	const conversation = randomUUID();
	await storeJobDraft(await replyEmail(conversation, other));
	await openNewReply(await replyEmail(conversation));
});

test("Doc refuses a reply when the source email is gone or outside the partner's mailbox", async () => {
	const foreign = await replyEmail(null, other);
	const gone = await replyEmail();
	const proposal = await newReply(gone);
	await db.query(`begin; set local engine.job = 'old_system';
		delete from email_mailbox where activity_id = '${gone}';
		delete from email where activity_id = '${gone}';
		commit;`);
	for (const { path } of [await newReply(foreign), proposal]) {
		assert.equal(
			(await client()(path, 404, newReplyEdits())).error,
			"not_found",
		);
	}
	const drafts = await db.query(
		"select from reply_draft where email_activity_id = any($1::uuid[])",
		[[foreign, gone]],
	);
	assert.equal(drafts.rowCount, 0);
});

for (const first of ["job", "doc"] as const) {
	test(`Doc and mail capture share the conversation lock with ${first} first`, async () => {
		const conversation = randomUUID();
		const jobMail = await replyEmail(conversation);
		const docMail = await replyEmail(conversation);
		const { path, id } = await newReply(docMail);
		const start = {
			job: () => storeJobDraft(jobMail),
			doc: () => client()(path, 200, newReplyEdits()),
		};
		const pending: Promise<unknown>[] = [];
		const beginSave = (source: keyof typeof start) => {
			const result = start[source]();
			void result.catch(() => {});
			pending.push(result);
		};
		await db.query("begin");
		try {
			await db.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
				`reply draft ${owner} ${conversation}`,
			]);
			beginSave(first);
			const waiting = await waitForBlockedTransaction(
				db,
				undefined,
				"advisory",
			);
			beginSave(first === "job" ? "doc" : "job");
			await waitForBlockedTransaction(db, waiting, "advisory");
		} finally {
			await db.query("rollback");
			await Promise.allSettled(pending);
		}
		const [job, doc] =
			first === "job"
				? [await pending[0], await pending[1]]
				: [await pending[1], await pending[0]];
		assert.equal(typeof job, "string");
		assert.deepEqual(doc, {
			result: replyReceipt(String(job), first === "job"),
		});
		const { rows } = await db.query(
			`select id, status, confirmed_doc_turn_id, email_activity_id, body
			from reply_draft where email_activity_id = any($1::uuid[])`,
			[[jobMail, docMail]],
		);
		assert.deepEqual(rows, [
			{
				id: job,
				status: "pending",
				confirmed_doc_turn_id: first === "doc" ? id : null,
				email_activity_id: first === "doc" ? docMail : jobMail,
				body: first === "doc" ? proposedReply.body : "The job's reply.",
			},
		]);
	});
}
