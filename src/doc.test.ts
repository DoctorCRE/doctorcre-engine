import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, test } from "node:test";
import { Hono } from "hono";
import { docRoutes, recentDocTurns } from "./doc.ts";
import { docLinkOwnerTransaction, issueDocLink } from "./doc-link.ts";
import { claimDocLink, completeDocLink } from "./doc-link-routes.ts";
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
		commit;`);
});
afterEach(() =>
	db.query(
		"delete from doc_turn; delete from doc_conversation; truncate doc_link",
	),
);
after(cleanup);

type Chat = { id: string; title: string };
type Turn = {
	id: string;
	idempotency_key: string;
	state: string;
	position: number;
	answer: unknown;
	context: unknown;
	waiting_reason: string | null;
};
type Body<Path> = { error?: string } & (Path extends "/turns"
	? { conversation_id: string; turn: Turn }
	: Path extends `/conversations/${string}`
		? { conversation: Chat; turns: Turn[] }
		: { conversations: Chat[]; next_before: string | null });

function client(user = "joe") {
	const api = docRoutes();
	const app = new Hono<typeof api extends Hono<infer Env> ? Env : never>();
	app.use("*", async (c, next) => {
		c.set("partner", { slug: user, display: "Example Partner" });
		await next();
	});
	app.route("/", api);
	return async <Path extends string>(
		path: Path,
		status: number | number[],
		body?: object,
	) => {
		const response = await app.request(
			path,
			body && { method: "POST", body: JSON.stringify(body) },
			{ DATABASE_WRITER: { connectionString } },
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
	Bindings: { DATABASE_WRITER: { connectionString: string } };
}>()
	.post("/claim", claimDocLink)
	.post("/result", completeDocLink);

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
	turn: { id: string; question: string };
	history: { question: string; answer: typeof refusal }[];
};

async function claim(credential: string) {
	const response = await poll(credential);
	assert.equal(response.status, 200);
	return response.json<Claim>();
}

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
