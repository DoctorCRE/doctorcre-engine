import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Hono } from "hono";
import { docRoutes } from "./doc.ts";
import type { DocModelBindings } from "./doc-model.ts";
import { copyTest } from "./test-copy.ts";

const { db, setup, cleanup, connectionString } = copyTest();
const owner = randomUUID();
const other = randomUUID();
const nonPartner = randomUUID();
const rehearsalDeal = randomUUID();
const rehearsalLead = randomUUID();
const duplicateLead = randomUUID();
const copiedLead = randomUUID();
const rehearsalClient = randomUUID();
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
		insert into phase values ('pending', 'Pending');
		insert into how_found values ('referral', 'Referral');
		insert into role values ('lead', 'Lead'), ('client', 'Client');
		insert into stage (role, slug, label) values ('lead', 'qualified', 'Qualified');
		insert into party (id, kind, name, city, how_found) values
			('${rehearsalLead}', 'person', 'Example Juniper', 'Sample North', 'referral'),
			('${duplicateLead}', 'person', 'Example Juniper', 'Sample South', 'referral'),
			('${rehearsalClient}', 'company', 'Example Elm Clinic', null, 'referral');
		insert into party_role (party_id, role, stage, owner_user_id) values
			('${rehearsalLead}', 'lead', 'qualified', '${owner}'),
			('${duplicateLead}', 'lead', 'qualified', '${other}'),
			('${rehearsalClient}', 'client', null, null);
		insert into client (party_id, owner_user_id) values ('${rehearsalClient}', '${other}');
		insert into outside_id (source, value, party_id) values ('old_system_lead', '${copiedLead}', '${rehearsalLead}');
		insert into deal (id, name, owner_user_id) values ('${rehearsalDeal}', 'Example Cedar Lease', '${owner}');
		insert into deal_phase_change (deal_id, happened_at, phase)
			values ('${rehearsalDeal}', '2026-01-01', 'pending');
		insert into next_step (deal_id, what, owner_party_id, due_on)
			values ('${rehearsalDeal}', 'Review the floor plan', '${owner}', '2026-12-14');
		with a as (insert into activity (kind, happened_at, summary)
			values ('note', '2026-01-02', 'The west entrance needs a ramp.') returning id)
		insert into activity_about (activity_id, deal_id) select id, '${rehearsalDeal}' from a;
		with a as (insert into activity (kind, happened_at, summary)
			values ('email', '2026-01-03', 'Private synthetic mail summary.') returning id),
		mail as (insert into email (activity_id, message_id, sender, subject, body)
			select id, 'doc-test@example.test', 'sender@example.test', 'Synthetic mail', 'Private synthetic mail body.'
			from a returning activity_id)
		insert into activity_about (activity_id, deal_id) select activity_id, '${rehearsalDeal}' from mail;
		commit;`);
});
after(cleanup);

type Chat = { id: string; title: string };
type Turn = {
	id: string;
	idempotency_key: string;
	state: string;
	position: number;
	answer: unknown;
	context: unknown;
};
type Body<Path> = { error?: string } & (Path extends "/turns"
	? { conversation_id: string; turn: Turn }
	: Path extends `/conversations/${string}`
		? { conversation: Chat; turns: Turn[] }
		: { conversations: Chat[]; next_before: string | null });

function client(
	model: Parameters<typeof docRoutes>[0],
	user = "joe",
	bindings?: DocModelBindings,
) {
	const api = docRoutes(model);
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
			{
				DATABASE: { connectionString },
				DATABASE_WRITER: { connectionString },
				...bindings,
			},
		);
		const result = await response.json<Body<Path>>();
		if (typeof status === "number")
			assert.equal(response.status, status, JSON.stringify(result));
		else assert.ok(status.includes(response.status), JSON.stringify(result));
		return result;
	};
}

const answer = async () => refusal;
const expire = (id: string) =>
	db.query("update doc_turn set claim_until = '-infinity' where id = $1", [id]);

test("a worker cannot finish an expired claim before anyone retries", async () => {
	const send = client(async ({ turn }) => {
		await expire(turn.id);
		return refusal;
	});
	const ask = { ...question, idempotency_key: randomUUID() };
	assert.equal((await send("/turns", 409, ask)).error, "turn_superseded");
});

test("simultaneous first asks with the same key share a reservation", async () => {
	const finish = Promise.withResolvers<typeof refusal>();
	let modelCalls = 0;
	const send = client(async () => {
		modelCalls++;
		return finish.promise;
	});
	const ask = { ...question, idempotency_key: randomUUID() };
	// Hold the first insert so both requests reach the database before either reserves.
	await db.query("begin; lock table doc_conversation in share mode");
	const requests = [
		send("/turns", [200, 202], ask),
		send("/turns", [200, 202], ask),
	] as const;
	const settled = Promise.allSettled(requests);
	try {
		try {
			const deadline = AbortSignal.timeout(10_000);
			for (;;) {
				deadline.throwIfAborted();
				const { rows } = await db.query<{
					waiting: number;
				}>(`select count(distinct pid)::int as waiting
					from pg_locks where not granted and locktype in ('advisory', 'relation')
					and database = (select oid from pg_database where datname = current_database())`);
				if (rows[0]?.waiting === 2) break;
			}
		} finally {
			await db.query("rollback");
		}
		assert.equal((await Promise.race(requests)).turn.state, "working");
	} finally {
		finish.resolve(refusal);
		await settled;
	}
	const [first, second] = await Promise.all(requests);
	assert.equal(modelCalls, 1);
	assert.equal(first.conversation_id, second.conversation_id);
	assert.equal(first.turn.id, second.turn.id);
	assert.deepEqual([first.turn.state, second.turn.state].sort(), [
		"answered",
		"working",
	]);
});

test("keeps one turn across an expired claim, retry, and reload", async () => {
	const started = Promise.withResolvers<void>();
	const finish = Promise.withResolvers<Awaited<ReturnType<typeof answer>>>();
	const send = client(async () => {
		started.resolve();
		return finish.promise;
	});
	const pending = send("/turns", 409, question);
	const retry = client(answer);
	await Promise.race([started.promise, pending]);
	try {
		const { conversation_id, turn } = await retry("/turns", 202, question);
		const chat: `/conversations/${string}` = `/conversations/${conversation_id}`;
		assert.equal(turn.state, "working");
		assert.equal(
			(await retry("/turns", 409, { ...question, conversation_id })).error,
			"key_reuse",
		);
		const next = {
			idempotency_key: randomUUID(),
			question: "Show the details",
			conversation_id,
		};
		assert.equal((await retry("/turns", 409, next)).error, "turn_in_progress");
		const otherPartner = client(answer, "dell");
		assert.equal((await otherPartner(chat, 404)).error, "not_found");
		assert.equal((await otherPartner("/turns", 404, next)).error, "not_found");
		assert.deepEqual(await otherPartner("/conversations", 200), {
			conversations: [],
			next_before: null,
		});
		await expire(turn.id);
		assert.equal((await retry(chat, 200)).turns[0]?.state, "failed");
		const saved = await retry("/turns", 200, {
			...question,
			question: `  ${question.question}  `,
		});
		assert.equal(saved.turn.id, turn.id);
		assert.deepEqual(saved.turn.answer, refusal);
		assert.deepEqual(await retry("/turns", 200, question), saved);
		const followUp = await retry("/turns", 200, next);
		assert.equal(followUp.turn.position, 2);
		assert.deepEqual((await retry(chat, 200)).turns, [
			saved.turn,
			followUp.turn,
		]);
	} finally {
		finish.resolve({ ...refusal, sources: [], text: "Stale answer" });
	}
	assert.equal((await pending).error, "turn_superseded");
});

test("the model deadline saves a failure and only the latest turn can be reclaimed", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const startedModel = Promise.withResolvers<AbortSignal>();
	const send = client(async (_input, signal) => {
		startedModel.resolve(signal);
		return new Promise(() => {});
	});
	const request = { ...question, idempotency_key: randomUUID() };
	const asking = send("/turns", 503, request);
	const signal = await Promise.race([
		startedModel.promise,
		asking.then(() => null),
	]);
	assert.ok(signal);
	t.mock.timers.tick(44_999);
	assert.equal(signal.aborted, false);
	t.mock.timers.tick(1);
	assert.equal(signal.aborted, true);
	t.mock.timers.reset();
	const first = await asking;
	assert.equal(first.error, "doc_unavailable");
	assert.equal(first.turn.state, "failed");
	const retry = client(answer);
	const saved = await retry("/turns", 200, request);
	assert.equal(saved.turn.id, first.turn.id);

	const started = Promise.withResolvers<void>();
	const finish = Promise.withResolvers<null>();
	const stalled = client(async () => {
		started.resolve();
		return finish.promise;
	});
	const next = {
		...request,
		idempotency_key: randomUUID(),
		conversation_id: first.conversation_id,
	};
	const pending = stalled("/turns", 409, next);
	await Promise.race([started.promise, pending]);
	try {
		const working = await retry("/turns", 202, next);
		await expire(working.turn.id);
		const latest = await retry("/turns", 200, {
			...next,
			idempotency_key: randomUUID(),
		});
		assert.equal(latest.turn.position, 3);
		assert.equal((await retry("/turns", 409, next)).error, "turn_superseded");
		const { turns } = await retry(
			`/conversations/${first.conversation_id}`,
			200,
		);
		assert.deepEqual(
			turns.map((turn: { state: string }) => turn.state),
			["answered", "failed", "answered"],
		);
	} finally {
		finish.resolve(null);
	}
	assert.equal((await pending).error, "turn_superseded");
});

test("bounds questions and pages stable ties by conversation ID", async () => {
	const send = client(answer);
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
	const saved = await send("/turns", 200, { ...ask, question: prefix });
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
			(id, conversation_id, owner_user_id, position, idempotency_key, question, request_hash, state, claim_id, claim_until)
			values ($1, $2, $3, $4, $5, $6, 'example', $7, $8::uuid, case when $8 is not null then 'infinity'::timestamptz end)`,
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

const completion = (message: object, tool = false) => ({
	choices: [{ message, finish_reason: tool ? "tool_calls" : "stop" }],
});

const call = (name: string, args: object) =>
	completion(
		{
			tool_calls: [
				{
					id: randomUUID(),
					type: "function",
					function: { name, arguments: JSON.stringify(args) },
				},
			],
		},
		true,
	);

const reply = (
	kind: string,
	text: string,
	sources: unknown[],
	extra?: object,
) => completion({ content: JSON.stringify({ kind, text, sources, ...extra }) });

function withModel(run: NonNullable<DocModelBindings["AI"]>["run"]) {
	return client(undefined, "joe", { DOC_MODEL: "fake", AI: { run } });
}

test("Doc answers the first question and a follow-up from fresh reads of the same deal", async () => {
	const key = `deal:${rehearsalDeal}`;
	const firstQuestion = "What phase is the Example Cedar Lease deal in?";
	const firstAnswer = "Example Cedar Lease is pending.";
	const followUp = "What is the next step on that deal and why?";
	const send = withModel(async (_model, { messages }) => {
		const ask = messages.findLast((message) => message.role === "user");
		const results = messages
			.slice(messages.lastIndexOf(ask ?? { role: "user", content: "" }) + 1)
			.filter((message) => message.role === "tool");
		if (!results.length) {
			if (ask?.content === followUp)
				assert.ok(
					messages.some(
						(message) =>
							message.role === "assistant" &&
							typeof message.content === "string" &&
							message.content.includes(firstAnswer),
					),
				);
			return call("find", {
				kind: "deal",
				query:
					ask?.content === followUp ? rehearsalDeal : "Example Cedar Lease",
			});
		}
		if (results.length === 1) {
			assert.match(String(results[0]?.content), new RegExp(key));
			return call("read", { source: key });
		}
		const facts = String(results[1]?.content);
		assert.match(facts, /"phase":"pending"/);
		assert.match(facts, /Review the floor plan/);
		assert.match(facts, /The west entrance needs a ramp/);
		assert.doesNotMatch(facts, /Private synthetic mail/);
		return reply(
			"answer",
			ask?.content === followUp
				? "Review the floor plan. The west entrance needs a ramp."
				: firstAnswer,
			ask?.content === followUp
				? [
						{
							ref: { kind: "deal", id: rehearsalDeal },
							href: "https://example.test",
						},
					]
				: [key],
		);
	});
	const cite = {
		ref: { kind: "deal", id: rehearsalDeal },
		label: "Example Cedar Lease",
		href: `/deals?deal=${rehearsalDeal}`,
	};
	const first = await send("/turns", 200, {
		idempotency_key: randomUUID(),
		question: firstQuestion,
	});
	assert.deepEqual(first.turn.answer, {
		kind: "answer",
		text: firstAnswer,
		sources: [cite],
		proposal: null,
	});
	const second = await send("/turns", 200, {
		conversation_id: first.conversation_id,
		idempotency_key: randomUUID(),
		question: followUp,
	});
	assert.deepEqual(second.turn.answer, {
		kind: "answer",
		text: "Review the floor plan. The west entrance needs a ramp.",
		sources: [cite],
		proposal: null,
	});
});

test("Doc asks which lead when two names match, with exact links to both leads", async () => {
	const send = withModel(async () =>
		call("find", { query: "Example Juniper", kind: "lead" }),
	);
	const { turn } = await send("/turns", 200, {
		idempotency_key: randomUUID(),
		question: "Who owns the Example Juniper lead?",
	});
	assert.deepEqual(turn.answer, {
		kind: "clarification",
		text: "Which of these records did you mean?",
		sources: [
			{
				ref: { kind: "lead", id: rehearsalLead },
				label: "Example Juniper (Sample North)",
				href: `/leads?lead=${copiedLead}`,
			},
			{
				ref: { kind: "lead", id: duplicateLead },
				label: "Example Juniper (Sample South)",
				href: `/leads?lead=${duplicateLead}`,
			},
		].toSorted((a, b) => a.ref.id.localeCompare(b.ref.id)),
		proposal: null,
	});
});

test("Doc reads a client or a copied lead by canonical ID and returns its app link", async () => {
	const cases = [
		{
			kind: "client",
			id: rehearsalClient,
			label: "Example Elm Clinic",
			href: `/clients?record=${rehearsalClient}`,
			owner: "Example Two",
		},
		{
			kind: "lead",
			id: rehearsalLead,
			label: "Example Juniper",
			href: `/leads?lead=${copiedLead}`,
			owner: "Example One",
		},
	];
	for (const { kind, id, label, href, owner } of cases) {
		const key = `${kind}:${id}`;
		const text = `${owner} is the recorded owner.`;
		const send = withModel(async (_model, { messages }) => {
			const results = messages.filter((message) => message.role === "tool");
			if (!results.length) return call("find", { query: id, kind });
			if (results.length === 1) return call("read", { source: key });
			assert.match(
				String(results[1]?.content),
				new RegExp(`"owner":"${owner}"`),
			);
			return reply("answer", text, [key]);
		});
		const { turn } = await send("/turns", 200, {
			idempotency_key: randomUUID(),
			question: "Who owns this record?",
			context: { kind, id },
		});
		assert.deepEqual(turn.answer, {
			kind: "answer",
			text,
			sources: [{ ref: { kind, id }, label, href }],
			proposal: null,
		});
	}
});

test("the model cannot call a save or supply its own source link", async () => {
	const key = `deal:${rehearsalDeal}`;
	const ask = () => ({
		idempotency_key: randomUUID(),
		question: "Save a note on Example Cedar Lease.",
	});
	const save = withModel(async () =>
		call("save_note", { source: key, text: "Do not store this." }),
	);
	assert.equal((await save("/turns", 503, ask())).error, "doc_unavailable");
	const forge = withModel(async () =>
		reply("answer", "A fabricated claim.", [key]),
	);
	assert.equal((await forge("/turns", 503, ask())).error, "doc_unavailable");
	const refuse = withModel(async () =>
		reply("refusal", "I can answer questions about this deal.", [], {
			proposal: { kind: "note", target: { href: "https://example.test" } },
		}),
	);
	const { turn } = await refuse("/turns", 200, ask());
	assert.deepEqual(turn.answer, {
		kind: "refusal",
		text: "I can answer questions about this deal.",
		sources: [],
		proposal: null,
	});
	const { rows } = await db.query(
		"select summary from activity where summary = $1",
		["Do not store this."],
	);
	assert.deepEqual(rows, []);
});
