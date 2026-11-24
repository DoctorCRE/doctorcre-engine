import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { readHomeEmailThread } from "./home-email-thread.ts";
import type { DB } from "./next-database.d.ts";
import { copyTest } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const script = fileURLToPath(
	new URL("../schema/recover-email-text.sql", import.meta.url),
);
const { db, setup, cleanup, connectionString } = copyTest();

const ONE = id(1);
const TWO = id(2);
const DOCTOR = "doctor@example.test";
const sha = (text: string) =>
	createHash("sha256").update(text, "utf8").digest("hex");
const quote = (value: string | null) =>
	value === null ? "null" : `'${value.replaceAll("'", "''")}'`;

// Emails in the new schema, and what the recovery read from Outlook for each.
type Email = {
	n: number;
	messageId?: string;
	split?: boolean;
	mailbox?: string;
	conversation?: string;
	happenedAt?: string;
	subject?: string;
	body?: string;
};
const subject = (n: number) => `Example subject ${n}`;
const body = (n: number) => `Example body ${n} café`;
const happenedAt = (n: number) => `2024-01-02 ${n}:00:00.5+00`;
const mid = (name: string) => `<${name}@example.test>`;

// biome-ignore format: one email per line
const emails: Email[] = [
	{ n: 10 }, // no split, no Message-ID: both are filled
	{ n: 11, split: true }, // already split, no Message-ID given
	{ n: 12, messageId: mid("twelve") }, // the given id is the stored one
	{ n: 13, messageId: mid("thirteen") }, // another id is stored
	{ n: 14 }, // the given id belongs to email 12
	{ n: 15 }, // 15 and 16 are given one new id
	{ n: 16 },
	{ n: 17, mailbox: TWO }, // read from a mailbox that does not hold it
	{ n: 18 }, // the body changed since the list
];

type Input = {
	n: number;
	user?: string;
	subject?: string;
	happenedAt?: string;
	bodySha?: string;
	sender?: string;
	authored?: string | null;
	history?: string | null;
	messageId?: string | null;
};
const authored = (n: number) => `Recovered authored ${n}`;
const history = (n: number) => `Recovered history ${n}`;
// biome-ignore format: one input row per line
const inputs: Input[] = [
	{ n: 10, messageId: mid("ten") },
	{ n: 11 },
	{ n: 12, messageId: mid("twelve") },
	{ n: 13, messageId: mid("thirteen-other") },
	{ n: 14, messageId: mid("twelve"), history: "" },
	{ n: 15, messageId: mid("shared") },
	{ n: 16, messageId: mid("shared") },
	{ n: 17, messageId: mid("seventeen") },
	{ n: 18, messageId: mid("eighteen"), bodySha: sha("Example body edited") },
	{ n: 99, messageId: mid("ninety-nine") }, // no such email
];

const loadSql = (rows: Input[]) => {
	const values = rows.map((r) => {
		const value = (key: keyof Input, fallback: string | null) =>
			quote(key in r ? (r[key] as string | null) : fallback);
		const fields = [
			quote(id(r.n)),
			value("user", ONE),
			value("sender", DOCTOR),
			value("happenedAt", happenedAt(r.n)),
			value("subject", subject(r.n)),
			value("bodySha", sha(body(r.n))),
			value("authored", authored(r.n)),
			value("history", history(r.n)),
			value("messageId", null),
		];
		return `(${fields.join(", ")})`;
	});
	return `\\set QUIET on
create temp table email_text_recovery (activity_id uuid, user_id uuid, sender text, happened_at text,
	subject text, body_sha256 text, authored text, history text, message_id text);
${values.length ? `insert into email_text_recovery values ${values.join(",\n")};` : ""}
`;
};

const storedPair = "'Stored authored', 'Stored history'";
const seedEmails = (list: Email[]) => {
	const activities = list.map((e) => {
		return `('${id(e.n)}', 'email', '${e.happenedAt ?? happenedAt(e.n)}')`;
	});
	const rows = list.map((e) => {
		const pair = e.split ? storedPair : "null, null";
		return `('${id(e.n)}', ${quote(e.messageId ?? null)}, ${quote(e.conversation ?? null)}, '${DOCTOR}',
			${quote(e.subject ?? subject(e.n))}, ${quote(e.body ?? body(e.n))}, ${pair}, ${e.messageId === undefined})`;
	});
	const ids = list.map((e) => `'${id(e.n)}'`).join(", ");
	const mailboxes = list.map((e) => `('${id(e.n)}', '${e.mailbox ?? ONE}')`);
	return `begin; select set_config('engine.job', 'intake', true);
	 insert into activity (id, kind, happened_at) values ${activities.join(", ")};
	 insert into email (activity_id, message_id, conversation_id, sender, subject, body, authored, history, imported)
	  values ${rows.join(", ")};
	 insert into activity_about (activity_id, deal_id) select activity_id, '${id(30)}' from email where activity_id in (${ids});
	 insert into email_mailbox (activity_id, user_id) values ${mailboxes.join(", ")};
	 insert into email_recipient (activity_id, position, address, kind) select activity_id, 0, 'partner@example.test', 'to'
	  from email where activity_id in (${ids});
	 commit;`;
};

let folder = "";
let runs = 0;
before(async () => {
	await setup();
	folder = await mkdtemp(join(tmpdir(), "recover-email-text-"));
	await db.query(`begin; select set_config('engine.job', 'intake', true);
	 insert into party (id, kind, name) values ('${ONE}', 'person', 'Example User'), ('${TWO}', 'person', 'Example Other');
	 insert into app_user (id, slug) values ('${ONE}', 'partner_one'), ('${TWO}', 'partner_two');
	 insert into deal (id, name, owner_user_id) values ('${id(30)}', 'Example Deal', '${ONE}');
	 commit;`);
	await db.query(seedEmails(emails));
});
after(async () => {
	await rm(folder, { recursive: true, force: true });
	await cleanup();
});

const runScript = async (
	load: string,
	{ apply, env }: { apply?: string; env?: Record<string, string> } = {},
) => {
	const file = join(folder, `load-${runs++}.sql`);
	await writeFile(file, load);
	const variables = apply === undefined ? [] : ["-v", `apply=${apply}`];
	const result = spawnSync(
		"psql",
		["-X", ...variables, "-f", file, "-f", script, connectionString],
		{ encoding: "utf8", env: { ...process.env, ...env } },
	);
	if (result.error) throw result.error;
	return result;
};

const saved = async () => {
	const { rows } = await db.query(`select
	 (select jsonb_agg(e order by activity_id) from email e) as email,
	 (select jsonb_agg(c order by id) from change c) as change`);
	return rows[0];
};
const guardedTables = [
	"activity",
	"email_mailbox",
	"email_recipient",
	"outside_id",
	"job",
	"email_summary",
	"doc_judgment_job",
	"proposal",
	"reply_draft",
];
const guarded = async () => {
	const columns = guardedTables.map(
		(table) =>
			`(select coalesce(jsonb_agg(t order by to_jsonb(t)::text), '[]') from ${table} t) as ${table}`,
	);
	const { rows } = await db.query(`select ${columns.join(", ")},
	 (select jsonb_agg(to_jsonb(e) - array['authored', 'history', 'message_id', 'changed_by_user_id',
	  'changed_by_job', 'changed_for_user_id', 'changed_at'] order by activity_id) from email e) as email_rest`);
	return rows[0];
};

const counts = (values: Record<string, number>) => {
	const names = [
		"not_found",
		"not_in_mailbox",
		"source_changed",
		"pair_filled",
		"pair_kept",
		"message_id_filled",
		"message_id_kept",
		"message_id_differs",
		"message_id_conflict",
		"message_id_not_given",
	];
	return [
		"outcome,rows",
		...names.map((name) => `${name},${values[name] ?? 0}`),
	];
};
const lines = (stdout: string) => stdout.trimEnd().split("\n");
const firstRun = {
	not_found: 1,
	not_in_mailbox: 1,
	source_changed: 1,
	pair_filled: 6,
	pair_kept: 1,
	message_id_filled: 2,
	message_id_kept: 1,
	message_id_differs: 1,
	message_id_conflict: 2,
	message_id_not_given: 1,
};

test("refuses a missing, duplicated, incomplete or padded input, or an unknown apply, with nothing written", async () => {
	const original = await saved();
	const without = (n: number, key: keyof Input) =>
		inputs.map((r) => (r.n === n ? { ...r, [key]: null } : r));
	const keyColumns: (keyof Input)[] = [
		"user",
		"sender",
		"happenedAt",
		"subject",
		"bodySha",
		"authored",
		"history",
	];
	const refused: [string, string, string][] = [
		["missing table", "\\set QUIET on\n", "on"],
		["duplicate activity", loadSql([...inputs, { n: 10 }]), "on"],
		["blank message id", loadSql([{ n: 10, messageId: "  " }]), "on"],
		[
			"padded message id",
			loadSql([{ n: 10, messageId: ` ${mid("ten")}` }]),
			"on",
		],
		["unknown apply", loadSql(inputs), "yes"],
		["empty apply", loadSql(inputs), ""],
		...keyColumns.map((key): [string, string, string] => [
			`null ${key}`,
			loadSql(without(10, key)),
			"on",
		]),
	];
	const nullActivity = loadSql(inputs).replace(`'${id(10)}'`, "null");
	refused.push(["null activity_id", nullActivity, "on"]);
	for (const [name, load, apply] of refused) {
		const result = await runScript(load, { apply });
		assert.notEqual(result.status, 0, name);
		assert.equal(result.stdout, "", name);
		assert.notEqual(result.stderr, "", name);
		if (name === "missing table")
			assert.match(result.stderr, /pg_temp\.email_text_recovery/);
	}
	assert.deepEqual(await saved(), original);
});

test("waits for capture's lock on a given Message-ID and changes nothing when the wait times out", async () => {
	const original = await saved();
	await db.query("begin");
	try {
		await db.query(
			"select pg_advisory_xact_lock(hashtextextended('email ' || $1, 0))",
			[mid("ten")],
		);
		const result = await runScript(loadSql(inputs), {
			apply: "on",
			env: { PGOPTIONS: "-c lock_timeout=200ms" },
		});
		assert.notEqual(result.status, 0);
		assert.equal(result.stdout, "");
		assert.match(result.stderr, /lock timeout/);
	} finally {
		await db.query("rollback");
	}
	assert.deepEqual(await saved(), original);
});

test("a dry run counts every outcome and rolls back, in any session time zone", async () => {
	const original = await saved();
	for (const run of [
		{},
		{ apply: "off" },
		{ env: { PGTZ: "America/Chicago" } },
	]) {
		const result = await runScript(loadSql(inputs), run);
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(lines(result.stdout), [...counts(firstRun), "dry_run"]);
	}
	assert.deepEqual(await saved(), original);
});

test("apply fills only the missing pair and Message-ID, stamped by the old system, and a rerun changes nothing", async () => {
	const original = await saved();
	const untouched = await guarded();
	const result = await runScript(loadSql(inputs), { apply: "on" });
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stderr, "");
	assert.deepEqual(lines(result.stdout), [...counts(firstRun), "applied"]);
	const secrets = [
		DOCTOR,
		"Example",
		"Recovered",
		"Stored",
		"@",
		ONE,
		TWO,
		...inputs.map((r) => id(r.n)),
	];
	for (const secret of secrets) assert.ok(!result.stdout.includes(secret));

	const { rows } = await db.query(
		`select activity_id, message_id, authored, history, changed_by_job, changed_by_user_id, changed_for_user_id,
		 (select count(*)::int from change c where c.table_name = 'email' and c.action = 'update'
		  and c.record = jsonb_build_object('activity_id', e.activity_id)) as changes
		 from email e where activity_id = any ($1::uuid[]) order by activity_id`,
		[emails.map((e) => id(e.n))],
	);
	const filled = (
		n: number,
		messageId: string | null,
		historyText = history(n),
	) => ({
		activity_id: id(n),
		message_id: messageId,
		authored: authored(n),
		history: historyText,
		changed_by_job: "old_system",
		changed_by_user_id: null,
		changed_for_user_id: null,
		changes: 1,
	});
	const kept = (n: number, messageId: string | null, split = false) => ({
		activity_id: id(n),
		message_id: messageId,
		authored: split ? "Stored authored" : null,
		history: split ? "Stored history" : null,
		changed_by_job: "intake",
		changed_by_user_id: null,
		changed_for_user_id: null,
		changes: 0,
	});
	assert.deepEqual(rows, [
		filled(10, mid("ten")),
		kept(11, null, true),
		filled(12, mid("twelve")),
		filled(13, mid("thirteen")),
		filled(14, null, ""),
		filled(15, mid("shared")),
		filled(16, null),
		kept(17, null),
		kept(18, null),
	]);
	const latest = Math.max(
		0,
		...(original.change ?? []).map((c: { id: number }) => c.id),
	);
	const { rows: added } = await db.query(
		"select count(*)::int as n from change where id > $1",
		[latest],
	);
	assert.equal(added[0].n, 6);
	assert.deepEqual(await guarded(), untouched);

	const applied = await saved();
	const rerun = await runScript(loadSql(inputs), { apply: "on" });
	assert.equal(rerun.status, 0, rerun.stderr);
	assert.deepEqual(lines(rerun.stdout), [
		...counts({
			not_found: 1,
			not_in_mailbox: 1,
			source_changed: 1,
			pair_kept: 7,
			message_id_kept: 3,
			message_id_differs: 1,
			message_id_conflict: 2,
			message_id_not_given: 1,
		}),
		"applied",
	]);
	assert.deepEqual(await saved(), applied);
	assert.deepEqual(await guarded(), untouched);
});

test("Home shows a recovered message's authored text, and its two copies stay one entry whichever is opened", async () => {
	const M = mid("thread");
	const when = "2024-01-03 09:00:00+00";
	const later = "2024-01-04 09:00:00+00";
	const shared = {
		conversation: "conversation-k",
		happenedAt: when,
		subject: "Example thread subject",
		body: "Example thread body",
	};
	await db.query(
		seedEmails([
			{ n: 40, messageId: M, ...shared },
			{ n: 41, ...shared },
			{ n: 42, conversation: "conversation-c", happenedAt: later },
		]),
	);

	const pool = new pg.Pool({
		connectionString,
		options: "-c search_path=next -c TimeZone=UTC",
	});
	const closed: Promise<unknown>[] = [];
	pool.on("connect", (client) => closed.push(once(client, "end")));
	const kysely = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
	const thread = (source: number) =>
		kysely
			.transaction()
			.execute((trx) => readHomeEmailThread(trx, ONE, id(source)))
			.then((read) => read.thread);
	try {
		for (const source of [40, 41]) {
			const entries = await thread(source);
			assert.equal(entries.length, 1);
			assert.equal(entries[0]?.activity_id, id(40));
		}

		const recovery: Input[] = [
			{
				n: 41,
				messageId: M,
				happenedAt: when,
				subject: shared.subject,
				bodySha: sha(shared.body),
			},
			{ n: 42, messageId: mid("forty-two"), happenedAt: later, history: "" },
		];
		const result = await runScript(loadSql(recovery), { apply: "on" });
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(lines(result.stdout), [
			...counts({
				pair_filled: 2,
				message_id_filled: 1,
				message_id_conflict: 1,
			}),
			"applied",
		]);

		for (const source of [40, 41]) {
			const entries = await thread(source);
			assert.equal(entries.length, 1);
			assert.equal(entries[0]?.activity_id, id(41));
			assert.equal(entries[0]?.body, authored(41));
			assert.equal(entries[0]?.folded, history(41));
		}
		const own = await thread(42);
		assert.equal(own.length, 1);
		assert.equal(own[0]?.activity_id, id(42));
		assert.equal(own[0]?.body, authored(42));
		assert.equal(own[0]?.folded, null);
	} finally {
		await kysely.destroy();
		await Promise.all(closed);
	}
});
