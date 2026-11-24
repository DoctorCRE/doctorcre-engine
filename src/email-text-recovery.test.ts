import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { readHomeEmailThread } from "./home-email-thread.ts";
import type { DB } from "./next-database.d.ts";
import { copyTest } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const script = (name: string) =>
	fileURLToPath(new URL(`../schema/${name}`, import.meta.url));
const { db, setup, cleanup, connectionString } = copyTest();
const sha = (text: string) =>
	createHash("sha256").update(text, "utf8").digest("hex");

const ONE = id(1);
const TWO = id(2);
const JOE = "partner-one@example.test";
const DELL = "partner-two@example.test";
const ALIAS = "partner-two-alias@example.test";
const DOCTOR = "doctor@example.test";
const key = (name: string) => `hxstore-key:${name}`;

// Emails in the new schema: whether each has its split and Message-ID, and its mailboxes.
type Email = {
	n: number;
	split: boolean;
	messageId: boolean;
	mailboxes: string[];
};
// biome-ignore format: one email per line
const emails: Email[] = [
	{ n: 10, split: false, messageId: false, mailboxes: [ONE] }, // one hxstore key
	{ n: 11, split: false, messageId: true, mailboxes: [ONE] }, // filed to two records, one key
	{ n: 12, split: true, messageId: false, mailboxes: [ONE, TWO] }, // a key in each mailbox
	{ n: 13, split: false, messageId: false, mailboxes: [ONE] }, // two keys in one mailbox
	{ n: 14, split: false, messageId: false, mailboxes: [ONE] }, // intake fingerprint
	{ n: 15, split: false, messageId: false, mailboxes: [ONE] }, // no email_identity
	{ n: 16, split: false, messageId: false, mailboxes: [ONE] }, // owned by the other mailbox
	{ n: 17, split: false, messageId: false, mailboxes: [TWO] }, // no outside_id
	{ n: 18, split: true, messageId: true, mailboxes: [ONE] }, // already split, with a Message-ID
	{ n: 19, split: false, messageId: false, mailboxes: [] }, // no mailbox
];
const subject = (n: number) => `Example subject ${n}`;
const body = (n: number) => `Example body ${n} café`;
const happenedAt = (n: number) =>
	`2024-01-${String(2 + Math.floor(n / 24)).padStart(2, "0")} ${String(n % 24).padStart(2, "0")}:00:00.5+00`;

// Today's rows, each linked by outside_id to the email it became.
type Old = {
	n: number;
	email: number;
	owner?: string;
	account?: string;
	item?: string;
};
// 111 and 112 are one email filed to two records; 122 is the same item under another account.
// biome-ignore format: one old row per line
const old: Old[] = [
	{ n: 110, email: 10, owner: "partner_one", account: JOE, item: key("ten") },
	{ n: 111, email: 11, owner: "partner_one", account: JOE, item: key("eleven") },
	{ n: 112, email: 11, owner: "partner_one", account: JOE, item: key("eleven") },
	{ n: 113, email: 12, owner: "partner_one", account: JOE, item: key("twelve-one") },
	{ n: 114, email: 12, owner: "partner_two", account: DELL, item: key("twelve-two") },
	{ n: 122, email: 12, owner: "partner_two", account: ALIAS, item: key("twelve-two") },
	{ n: 115, email: 13, owner: "partner_one", account: JOE, item: key("thirteen-a") },
	{ n: 116, email: 13, owner: "partner_one", account: JOE, item: key("thirteen-b") },
	{ n: 117, email: 14, owner: "partner_one", account: JOE, item: "intake:fingerprint-14" },
	{ n: 118, email: 15 },
	{ n: 119, email: 16, owner: "partner_two", account: DELL, item: key("sixteen") },
	{ n: 120, email: 18, owner: "partner_one", account: JOE, item: key("eighteen") },
	{ n: 121, email: 19, owner: "partner_one", account: JOE, item: key("nineteen") },
];
const identity = (o: Old) => {
	if (!o.owner) return "null";
	const json = JSON.stringify({
		mailbox_owner: o.owner,
		mailbox_account: o.account,
		item_id: o.item,
		subject: `Example old ${o.n}`,
	});
	return `'${json}'`;
};

const activityValues = emails.map((e) => {
	return `('${id(e.n)}', 'email', '${happenedAt(e.n)}')`;
});
const emailValues = emails.map((e) => {
	const messageId = e.messageId ? `'<${e.n}@example.test>'` : "null";
	const pair = e.split ? "'Example authored', ''" : "null, null";
	return `('${id(e.n)}', ${messageId}, '${DOCTOR}', '${subject(e.n)}', '${body(e.n)}', ${pair}, true)`;
});
const mailboxValues = emails.flatMap((e) => {
	return e.mailboxes.map((user) => `('${id(e.n)}', '${user}')`);
});
const oldValues = old.map((o) => {
	return `('${id(o.n)}', 'email_in', '2024-01-02', '${id(3)}', 'Example old ${o.n}', ${identity(o)})`;
});
const linkValues = old.map((o) => {
	return `('old_system', '${id(o.n)}', '${id(o.email)}')`;
});
const seed = `begin; select set_config('engine.job', 'old_system', true);
 insert into public.actor (id, slug, kind, display_name) values ('${id(3)}', 'partner_one-local', 'automation', 'Example mail job');
 insert into public.activity_kind (slug, label, is_contact) values ('email_in', 'email_in', true);
 insert into party (id, kind, name) values ('${ONE}', 'person', 'Example User'), ('${TWO}', 'person', 'Example Other');
 insert into app_user (id, slug) values ('${ONE}', 'partner_one'), ('${TWO}', 'partner_two');
 insert into activity (id, kind, happened_at) values ${activityValues.join(", ")};
 insert into email (activity_id, message_id, sender, subject, body, authored, history, imported)
  values ${emailValues.join(", ")};
 insert into deal (id, name, owner_user_id) values ('${id(30)}', 'Example Deal', '${ONE}');
 insert into activity_about (activity_id, deal_id) select activity_id, '${id(30)}' from email;
 insert into email_mailbox (activity_id, user_id) values ${mailboxValues.join(", ")};
 insert into public.activity (id, kind, occurred_at, actor_id, summary, email_identity)
  values ${oldValues.join(", ")};
 insert into outside_id (source, value, email_activity_id) values ${linkValues.join(", ")};
 commit;`;

let folder = "";
before(async () => {
	await setup();
	folder = await mkdtemp(join(tmpdir(), "email-text-recovery-"));
	await db.query(seed);
});
after(async () => {
	await rm(folder, { recursive: true, force: true });
	await cleanup();
});

// biome-ignore format: shared runner for candidates (out path) and apply (options)
const runScript = (arg?: string | { file: string; vars?: string[]; input?: string; env?: Record<string, string> | undefined }) => {
	const { file, vars = [], input, env } = typeof arg === "object"
		? arg
		: { file: "email-text-recovery-candidates.sql", vars: arg ? [`out=${arg}`] : [] };
	const args = ["-X", ...vars.flatMap((v) => ["-v", v])];
	if (input !== undefined) args.push("-f", "-");
	args.push("-f", script(file), connectionString);
	const r = spawnSync("psql", args, { encoding: "utf8", input, env: { ...process.env, ...env } });
	if (r.error) throw r.error;
	return r;
};
const assertNoSecrets = (stdout: string, extra: string[]) => {
	for (const s of [DOCTOR, "Example", "@", ONE, TWO, ...extra])
		assert.ok(!stdout.includes(s), s);
};
const saved = async () => {
	const { rows } = await db.query(`select
	 (select jsonb_agg(e order by activity_id) from email e) as email,
	 (select jsonb_agg(c order by id) from change c) as change`);
	return rows[0];
};

const header =
	"activity_id,user_id,slug,sender,happened_at,subject,body_sha256,message_id,needs,mailbox_account,item_locator,reason";
const row = (
	n: number,
	user: string,
	needs: string,
	reason: string,
	account = "",
	locator = "",
) => {
	const email = emails.find((e) => e.n === n);
	return [
		id(n),
		user,
		user === ONE ? "partner_one" : "partner_two",
		DOCTOR,
		happenedAt(n),
		subject(n),
		sha(body(n)),
		email?.messageId ? `<${n}@example.test>` : "",
		needs,
		account,
		locator,
		reason,
	].join(",");
};

test("lists each mailbox of an email that lacks its split or Message-ID, with the one locator that mailbox filed", async () => {
	const original = await saved();
	const out = join(folder, "candidates.csv");
	const result = runScript(out);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stderr, "");
	const csv = (await readFile(out, "utf8")).trimEnd().split("\n");
	assert.deepEqual(csv, [
		header,
		row(10, ONE, "both", "locator", JOE, key("ten")),
		row(11, ONE, "pair", "locator", JOE, key("eleven")),
		row(12, ONE, "message_id", "locator", JOE, key("twelve-one")),
		row(12, TWO, "message_id", "locator", "", key("twelve-two")),
		row(13, ONE, "both", "several_locators"),
		row(14, ONE, "both", "no_locator"),
		row(15, ONE, "both", "no_identity"),
		row(16, ONE, "both", "mailbox_mismatch"),
		row(17, TWO, "both", "no_old_activity"),
	]);
	assert.deepEqual(result.stdout.trimEnd().split("\n"), [
		"reason,candidates",
		"locator,4",
		"several_locators,1",
		"no_locator,1",
		"mailbox_mismatch,1",
		"no_identity,1",
		"no_old_activity,1",
	]);
	assertNoSecrets(result.stdout, [
		JOE,
		DELL,
		ALIAS,
		"hxstore-key",
		"intake:",
		...emails.map((e) => id(e.n)),
		...old.map((o) => id(o.n)),
	]);
	assert.deepEqual(await saved(), original);
});

test("lists every email as without old activity while today's activity table is missing", async () => {
	const out = join(folder, "without-old.csv");
	await db.query("alter table public.activity rename to activity_away");
	try {
		const result = runScript(out);
		assert.equal(result.status, 0, result.stderr);
		const csv = await readFile(out, "utf8");
		const rows = csv.trimEnd().split("\n").slice(1);
		const tails = rows.map((line) => line.split(",").slice(-3).join(","));
		assert.equal(tails.length, 9);
		assert.ok(tails.every((tail) => tail === ",,no_old_activity"));
		assert.match(result.stdout, /^no_old_activity,9$/m);
	} finally {
		await db.query("alter table public.activity_away rename to activity");
	}
});

test("refuses to run without the private file to write", () => {
	const result = runScript();
	assert.notEqual(result.status, 0);
	assert.equal(result.stdout, "");
	assert.match(result.stderr, /-v out=/);
});

describe("recover-email-text", () => {
	type Row = { n: number; split?: boolean } & Record<string, unknown>;
	const q = (v: unknown) =>
		v == null ? "null" : `'${String(v).replaceAll("'", "''")}'`;
	const mid = (k: number | string) => `<${k}@example.test>`;
	const authored = (n: number) => `Recovered authored ${n}`;
	const history = (n: number) => `Recovered history ${n}`;
	const lines = (s: string) => s.trimEnd().split("\n");
	// biome-ignore format: fixed CSV outcome order
	const outcomes = ["not_found", "not_in_mailbox", "source_changed", "pair_filled", "pair_kept", "message_id_filled", "message_id_kept", "message_id_differs", "message_id_conflict", "message_id_not_given"];
	// biome-ignore format: compact CSV formatter
	const counts = (v: Record<string, number>, tail: string) => ["outcome,rows", ...outcomes.map((k) => `${k},${v[k] ?? 0}`), tail];
	// biome-ignore format: one email per line
	const applyEmails: Row[] = [
		{ n: 20 }, { n: 21, split: true }, { n: 22, messageId: mid(22) },
		{ n: 23, messageId: mid(23) }, { n: 24 }, { n: 25 }, { n: 26 },
		{ n: 27, mailbox: TWO }, { n: 28 }, { n: 29, split: true },
	];
	// biome-ignore format: one input row per line
	const applyInputs: Row[] = [
		{ n: 20, messageId: mid(20) }, { n: 21 }, { n: 22, messageId: mid(22) },
		{ n: 23, messageId: mid("23-other") }, { n: 24, messageId: mid(22), history: "" },
		{ n: 25, messageId: mid("shared") }, { n: 26, messageId: mid("shared") },
		{ n: 27, messageId: mid(27) }, { n: 28, messageId: mid(28), bodySha: sha("Example edited") },
		{ n: 29, messageId: mid(29) }, { n: 99, messageId: mid(99) },
	];
	const loadSql = (rows: Row[]) => {
		const vals = rows.map((r) => {
			const p = (k: string, fb: string | null) => q(k in r ? r[k] : fb);
			return `(${[q(id(r.n)), p("user", ONE), p("sender", DOCTOR), p("happenedAt", happenedAt(r.n)), p("subject", subject(r.n)), p("bodySha", sha(body(r.n))), p("authored", authored(r.n)), p("history", history(r.n)), p("messageId", null)].join(", ")})`;
		});
		return `\\set QUIET on\n\\set ON_ERROR_STOP on\ncreate temp table email_text_recovery (activity_id uuid, user_id uuid, sender text, happened_at text, subject text, body_sha256 text, authored text, history text, message_id text);\n${vals.length ? `insert into email_text_recovery values ${vals.join(",\n")};` : ""}\n`;
	};
	const seedEmails = (list: Row[], allowDup = false) => {
		const ids = list.map((e) => `'${id(e.n)}'`).join(", ");
		return `begin; select set_config('engine.job', 'intake', true);
		 ${allowDup ? "alter table email disable trigger email_without_message_id_once;" : ""}
		 insert into activity (id, kind, happened_at) values ${list.map((e) => `('${id(e.n)}', 'email', '${e.happenedAt ?? happenedAt(e.n)}')`).join(", ")};
		 insert into email (activity_id, message_id, conversation_id, sender, subject, body, authored, history, imported) values ${list.map((e) => `('${id(e.n)}', ${q(e.messageId ?? null)}, ${q(e.conversation ?? null)}, '${DOCTOR}', ${q(e.subject ?? subject(e.n))}, ${q(e.body ?? body(e.n))}, ${e.split ? "'Stored authored', 'Stored history'" : "null, null"}, ${e.messageId === undefined})`).join(", ")};
		 insert into activity_about (activity_id, deal_id) select activity_id, '${id(30)}' from email where activity_id in (${ids});
		 insert into email_mailbox (activity_id, user_id) values ${list.map((e) => `('${id(e.n)}', '${e.mailbox ?? ONE}')`).join(", ")};
		 insert into email_recipient (activity_id, position, address, kind) select activity_id, 0, 'partner@example.test', 'to' from email where activity_id in (${ids});
		 commit; ${allowDup ? "alter table email enable trigger email_without_message_id_once;" : ""}`;
	};
	// biome-ignore format: compact recovery runner
	const runRecovery = (input: string, apply?: string, env?: Record<string, string>) =>
		runScript({ file: "recover-email-text.sql", vars: apply === undefined ? [] : [`apply=${apply}`], input, env });
	// biome-ignore format: compact failure check
	const expectFail = (r: ReturnType<typeof runRecovery>, expected: RegExp, name: string) => {
		assert.notEqual(r.status, 0, name);
		assert.equal(r.stdout, "", name);
		assert.match(r.stderr, expected, name);
	};
	const guarded = async () => {
		// biome-ignore format: tables recovery must not alter
		const tables = ["activity", "email_mailbox", "email_recipient", "outside_id", "job", "email_summary", "doc_judgment_job", "proposal", "reply_draft"];
		// biome-ignore format: snapshot guarded tables and immutable email columns
		return (await db.query(`select ${tables.map((t) => `(select coalesce(jsonb_agg(r order by to_jsonb(r)::text), '[]') from ${t} r) as ${t}`).join(", ")}, (select jsonb_agg(to_jsonb(e) - array['authored', 'history', 'message_id', 'changed_by_user_id', 'changed_by_job', 'changed_for_user_id', 'changed_at'] order by activity_id) from email e) as email_rest`)).rows[0];
	};

	before(() => db.query(seedEmails(applyEmails)));

	test("refuses missing, duplicated, incomplete, NUL, padded or bad-apply input with nothing written", async () => {
		const original = await saved();
		const patch99 = (p: Record<string, string | null>) =>
			loadSql(applyInputs.map((r) => (r.n === 99 ? { ...r, ...p } : r)));
		const base = loadSql(applyInputs);
		// biome-ignore format: one refusal case per line
		const refused: [string, string, RegExp, string?][] = [
			["missing table", "\\set QUIET on\n", /Load the private input into pg_temp\.email_text_recovery first/],
			["duplicate activity", loadSql([...applyInputs, { n: 99 }]), /appears twice/],
			["blank message_id", patch99({ messageId: "  " }), /blank or padded message_id/],
			["padded message_id", patch99({ messageId: ` ${mid(99)}` }), /blank or padded message_id/],
			["unknown apply", base, /Set -v apply=on/, "yes"],
			["empty apply", base, /Set -v apply=on/, ""],
			["NUL in text", base.replace(q(authored(99)), "'a' || chr(0) || 'b'"), /null character not permitted/],
			["null activity_id", base.replace(`'${id(99)}'`, "null"), /without its key, expected source or split/],
			...["user", "sender", "happenedAt", "subject", "bodySha", "authored", "history"].map((k): [string, string, RegExp] => [`null ${k}`, patch99({ [k]: null }), /without its key, expected source or split/]),
		];
		for (const [name, load, expected, apply = "on"] of refused)
			expectFail(runRecovery(load, apply), expected, name);
		assert.deepEqual(await saved(), original);
	});

	test("waits for capture's, filing's and target row locks and changes nothing on lock timeout", async () => {
		const original = await saved();
		const lock =
			"select pg_advisory_xact_lock(hashtextextended('email ' || $1, 0))";
		// biome-ignore format: one blocker per line
		const blockers: [string, string, string][] = [
			["input message_id", lock, mid(20)],
			["stored message_id", lock, mid(23)],
			["filing activity_id", lock, id(21)],
			["target row", "select from email where activity_id = $1 for update", id(21)],
		];
		const load = loadSql(applyInputs);
		for (const [name, sql, param] of blockers) {
			await db.query("begin");
			try {
				await db.query(sql, [param]);
				// biome-ignore format: compact lock timeout run
				expectFail(runRecovery(load, "on", { PGOPTIONS: "-c lock_timeout=200ms" }), /lock timeout/, name);
			} finally {
				await db.query("rollback");
			}
		}
		assert.deepEqual(await saved(), original);
	});

	test("dry run rolls back in any time zone, apply fills only missing fields stamped old_system, and rerun is idempotent", async () => {
		const original = await saved();
		const untouched = await guarded();
		// biome-ignore format: compact outcome counts
		const firstRun = { not_found: 1, not_in_mailbox: 1, source_changed: 1, pair_filled: 6, pair_kept: 2, message_id_filled: 3, message_id_kept: 1, message_id_differs: 1, message_id_conflict: 2, message_id_not_given: 1 };
		const load = loadSql(applyInputs);
		// biome-ignore format: dry-run variants
		for (const [apply, env] of [[undefined], ["off"], [undefined, { PGTZ: "America/Chicago" }]] as [string?, Record<string, string>?][]) {
			const dry = runRecovery(load, apply, env);
			assert.equal(dry.status, 0, dry.stderr);
			assert.deepEqual(lines(dry.stdout), counts(firstRun, "dry_run"));
		}
		assert.deepEqual(await saved(), original);

		const result = runRecovery(load, "on");
		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stderr, "");
		assert.deepEqual(lines(result.stdout), counts(firstRun, "applied"));
		// biome-ignore format: compact secret list
		assertNoSecrets(result.stdout, ["Recovered", "Stored", ...applyInputs.map((r) => id(r.n))]);

		const { rows } = await db.query({
			text: `select activity_id, message_id, authored, history, changed_by_job, changed_by_user_id, changed_for_user_id,
			 (select count(*)::int from change c where c.table_name = 'email' and c.action = 'update'
			  and c.record = jsonb_build_object('activity_id', e.activity_id))
			 from email e where activity_id = any ($1::uuid[]) order by activity_id`,
			values: [applyEmails.map((e) => id(e.n))],
			rowMode: "array",
		});
		// biome-ignore format: compact row shape
		const expect = (n: number, m: string | null, changed: boolean, a: string | null, h: string | null) =>
			[id(n), m, a, h, changed ? "old_system" : "intake", null, null, changed ? 1 : 0];
		// biome-ignore format: one expected row per line
		assert.deepEqual(rows, [
			expect(20, mid(20), true, authored(20), history(20)),
			expect(21, null, false, "Stored authored", "Stored history"),
			expect(22, mid(22), true, authored(22), history(22)),
			expect(23, mid(23), true, authored(23), history(23)),
			expect(24, null, true, authored(24), ""),
			expect(25, mid("shared"), true, authored(25), history(25)),
			expect(26, null, true, authored(26), history(26)),
			expect(27, null, false, null, null),
			expect(28, null, false, null, null),
			expect(29, mid(29), true, "Stored authored", "Stored history"),
		]);
		const applied = await saved();
		assert.equal(applied.change.length - (original.change?.length ?? 0), 7);
		assert.deepEqual(await guarded(), untouched);

		const rerun = runRecovery(load, "on");
		assert.equal(rerun.status, 0, rerun.stderr);
		// biome-ignore format: compact outcome counts
		assert.deepEqual(lines(rerun.stdout), counts({ not_found: 1, not_in_mailbox: 1, source_changed: 1, pair_kept: 8, message_id_kept: 4, message_id_differs: 1, message_id_conflict: 2, message_id_not_given: 1 }, "applied"));
		assert.deepEqual(await saved(), applied);
		assert.deepEqual(await guarded(), untouched);
	});

	test("Home shows a recovered message's authored text, and its two copies stay one entry whichever is opened", async () => {
		const M = mid("thread");
		// biome-ignore format: shared fallback tuple
		const shared = { conversation: "k", happenedAt: happenedAt(40), subject: subject(40), body: body(40) };
		// biome-ignore format: two copies without Message-ID plus one standalone email
		await db.query(seedEmails([{ n: 40, ...shared }, { n: 41, ...shared }, { n: 42, conversation: "c" }], true));
		// biome-ignore format: recover both copies with M, plus empty history on 42
		const result = runRecovery(loadSql([{ n: 40, messageId: M }, { n: 41, messageId: M, happenedAt: shared.happenedAt, subject: shared.subject, bodySha: sha(shared.body) }, { n: 42, messageId: mid(42), history: "" }]), "on");
		assert.equal(result.status, 0, result.stderr);
		// biome-ignore format: compact outcome counts
		assert.deepEqual(lines(result.stdout), counts({ pair_filled: 3, message_id_filled: 2, message_id_conflict: 1 }, "applied"));

		// biome-ignore format: connect Kysely to readHomeEmailThread
		const pool = new pg.Pool({ connectionString, options: "-c search_path=next -c TimeZone=UTC" });
		const closed: Promise<unknown>[] = [];
		pool.on("connect", (c) => closed.push(once(c, "end")));
		const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
		try {
			// biome-ignore format: verify both copies collapse to 40, and 42 folds empty history to null
			const checks: [number, [string, string, string | null]][] = [[40, [id(40), authored(40), history(40)]], [41, [id(40), authored(40), history(40)]], [42, [id(42), authored(42), null]]];
			for (const [src, want] of checks) {
				// biome-ignore format: read one thread
				const { thread } = await k.transaction().execute((trx) => readHomeEmailThread(trx, ONE, id(src)));
				// biome-ignore format: check displayed entry
				assert.deepEqual(thread.map((e) => [e.activity_id, e.body, e.folded]), [want]);
			}
		} finally {
			await k.destroy();
			await Promise.all(closed);
		}
	});
});
