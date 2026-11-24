import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
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

const runPsql = (
	file: string,
	conn: string,
	vars: string[],
	input?: string,
	env?: Record<string, string>,
) => {
	const args = ["-X", ...vars.flatMap((v) => ["-v", v])];
	if (input !== undefined) args.push("-f", "-");
	const r = spawnSync("psql", [...args, "-f", script(file), conn], {
		encoding: "utf8",
		input,
		env: env ? { ...process.env, ...env } : undefined,
	});
	if (r.error) throw r.error;
	return r;
};
const runScript = (out?: string) => {
	const v = out ? [`out=${out}`] : [];
	return runPsql("email-text-recovery-candidates.sql", connectionString, v);
};
const assertNoSecrets = (stdout: string, extra: string[]) => {
	for (const s of [DOCTOR, "Example", "@", ONE, TWO, ...extra])
		assert.ok(!stdout.includes(s), s);
};
const saved = async (client = db) => {
	const { rows } = await client.query(`select
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
	const rec = copyTest();
	type Row = { n: number; split?: boolean } & Record<string, unknown>;
	const q = (v: unknown) =>
		v == null ? "null" : `'${String(v).replaceAll("'", "''")}'`;
	const mid = (k: number | string) => `<${k}@example.test>`;
	const authored = (n: number) => `Recovered authored ${n}`;
	const history = (n: number) => `Recovered history ${n}`;
	const lines = (s: string) => s.trimEnd().split("\n");
	const OUTCOMES =
		"not_found not_in_mailbox source_changed pair_filled pair_kept message_id_filled message_id_kept message_id_differs message_id_conflict message_id_not_given";
	const counts = (n: number[], tail: string) => [
		"outcome,rows",
		...OUTCOMES.split(" ").map((k, i) => `${k},${n[i]}`),
		tail,
	];
	const FIELDS =
		"id user sender happenedAt subject bodySha authored history messageId";
	const applyEmails: Row[] = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29].map(
		(n) => ({
			n,
			split: n === 21 || n === 29,
			messageId: n === 22 || n === 23 ? mid(n) : undefined,
			mailbox: n === 27 ? TWO : ONE,
		}),
	);
	const applyInputs: Row[] = [
		{ n: 20, messageId: mid(20) },
		{ n: 21 },
		{ n: 22, messageId: mid(22) },
		{ n: 23, messageId: mid("23-other") },
		{ n: 24, messageId: mid(22), history: "" },
		{ n: 25, messageId: mid("shared") },
		{ n: 26, messageId: mid("shared") },
		{ n: 27, messageId: mid(27) },
		{ n: 28, messageId: mid(28), bodySha: sha("Example edited") },
		{ n: 29, messageId: mid(29) },
		{ n: 99, messageId: mid(99) },
	];
	const loadSql = (rows: Row[]) => {
		const cols = FIELDS.split(" ");
		const vals = rows.map((r) => {
			const d: Record<string, unknown> = {
				id: id(r.n),
				user: ONE,
				sender: DOCTOR,
				happenedAt: happenedAt(r.n),
				subject: subject(r.n),
				bodySha: sha(body(r.n)),
				authored: authored(r.n),
				history: history(r.n),
				messageId: null,
				...r,
			};
			return `(${cols.map((k) => q(d[k])).join(",")})`;
		});
		return `\\set QUIET on\n\\set ON_ERROR_STOP on\ncreate temp table email_text_recovery (activity_id uuid, user_id uuid, sender text, happened_at text, subject text, body_sha256 text, authored text, history text, message_id text);\ninsert into email_text_recovery values ${vals.join(",\n")};\n`;
	};
	const run = (input: string, apply?: string, env?: Record<string, string>) => {
		const v = apply === undefined ? [] : [`apply=${apply}`];
		return runPsql(
			"recover-email-text.sql",
			rec.connectionString,
			v,
			input,
			env,
		);
	};
	const guarded = async () => {
		const ts =
			"activity email_mailbox email_recipient outside_id job email_summary doc_judgment_job proposal reply_draft";
		const cols = ts
			.split(" ")
			.map(
				(t) =>
					`(select coalesce(jsonb_agg(r order by to_jsonb(r)::text),'[]') from ${t} r) as ${t}`,
			);
		const rest =
			"(select jsonb_agg(to_jsonb(e)-array['authored','history','message_id','changed_by_user_id','changed_by_job','changed_for_user_id','changed_at'] order by activity_id) from email e) as email_rest";
		return (await rec.db.query(`select ${cols.join(",")},${rest}`)).rows[0];
	};

	before(async () => {
		await rec.setup();
		const map = (fn: (e: Row) => string) => applyEmails.map(fn).join(",");
		const act = map((e) => `('${id(e.n)}','email','${happenedAt(e.n)}')`);
		const em = map(
			(e) =>
				`('${id(e.n)}',${q(e.messageId ?? null)},'${DOCTOR}','${subject(e.n)}','${body(e.n)}',${e.split ? "'Stored authored','Stored history'" : "null,null"},${e.messageId === undefined})`,
		);
		const mb = map((e) => `('${id(e.n)}','${e.mailbox ?? ONE}')`);
		await rec.db.query(`begin; select set_config('engine.job', 'intake', true);
		 insert into party (id, kind, name) values ('${ONE}','person','Example User'),('${TWO}','person','Example Other');
		 insert into app_user (id, slug) values ('${ONE}','partner_one'),('${TWO}','partner_two');
		 insert into activity (id, kind, happened_at) values ${act};
		 insert into email (activity_id, message_id, sender, subject, body, authored, history, imported) values ${em};
		 insert into activity_about (activity_id, party_id) select activity_id, '${ONE}' from email;
		 insert into email_mailbox (activity_id, user_id) values ${mb}; commit;`);
	});
	after(rec.cleanup);

	test("refuses missing, duplicated, incomplete, NUL, padded or bad-apply input with nothing written", async () => {
		const original = await saved(rec.db);
		const row99 = loadSql([{ n: 99 }]);
		const p99 = (p: Record<string, string | null>) =>
			loadSql([{ n: 99, ...p }]);
		const missing = /without its key, expected source or split/;
		const nul = row99.replace(q(authored(99)), "'a' || chr(0) || 'b'");
		type Case = [string, string, RegExp, string?];
		const nulls = FIELDS.split(" ")
			.slice(0, 8)
			.map((k): Case => [`null ${k}`, p99({ [k]: null }), missing]);
		const refused: Case[] = [
			["missing table", "\\set QUIET on\n", /email_text_recovery first/],
			["duplicate activity", loadSql([{ n: 99 }, { n: 99 }]), /appears twice/],
			["blank message_id", p99({ messageId: "  " }), /blank or padded/],
			[
				"padded message_id",
				p99({ messageId: ` ${mid(99)}` }),
				/blank or padded/,
			],
			["unknown apply", row99, /Set -v apply=on/, "yes"],
			["empty apply", row99, /Set -v apply=on/, ""],
			["NUL in text", nul, /null character not permitted/],
			...nulls,
		];
		for (const [name, load, expected, apply] of refused) {
			const r = run(load, apply);
			assert.notEqual(r.status, 0, name);
			assert.equal(r.stdout, "", name);
			assert.match(r.stderr, expected, name);
		}
		assert.deepEqual(await saved(rec.db), original);
	});

	test("dry run rolls back in any time zone, apply fills only missing fields stamped old_system, and rerun is idempotent", async () => {
		const original = await saved(rec.db);
		const untouched = await guarded();
		const first = [1, 1, 1, 6, 2, 3, 1, 1, 2, 1];
		const second = [1, 1, 1, 0, 8, 0, 4, 1, 2, 1];
		const load = loadSql(applyInputs);
		for (const [apply, env] of [
			[undefined],
			["off"],
			[undefined, { PGTZ: "America/Chicago" }],
		] as [string?, Record<string, string>?][]) {
			const dry = run(load, apply, env);
			assert.equal(dry.status, 0, dry.stderr);
			assert.deepEqual(lines(dry.stdout), counts(first, "dry_run"));
		}
		assert.deepEqual(await saved(rec.db), original);

		const result = run(load, "on");
		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stderr, "");
		assert.deepEqual(lines(result.stdout), counts(first, "applied"));
		const ids = applyInputs.map((r) => id(r.n));
		assertNoSecrets(result.stdout, ["Recovered", "Stored", ...ids]);

		const { rows } = await rec.db.query({
			text: `select activity_id, message_id, authored, history, changed_by_job, changed_by_user_id, changed_for_user_id,
			 (select count(*)::int from change c where c.table_name='email' and c.action='update' and c.record=jsonb_build_object('activity_id',e.activity_id))
			 from email e order by activity_id`,
			rowMode: "array",
		});
		const exp = (
			n: number,
			m: string | null,
			a: string | null = authored(n),
			h: string | null = history(n),
			job = "old_system",
		) => [id(n), m, a, h, job, null, null, Number(job === "old_system")];
		assert.deepEqual(rows, [
			exp(20, mid(20)),
			exp(21, null, "Stored authored", "Stored history", "intake"),
			exp(22, mid(22)),
			exp(23, mid(23)),
			exp(24, null, authored(24), ""),
			exp(25, mid("shared")),
			exp(26, null),
			exp(27, null, null, null, "intake"),
			exp(28, null, null, null, "intake"),
			exp(29, mid(29), "Stored authored", "Stored history"),
		]);
		const applied = await saved(rec.db);
		assert.equal(applied.change.length - (original.change?.length ?? 0), 7);
		assert.deepEqual(await guarded(), untouched);

		const rerun = run(load, "on");
		assert.equal(rerun.status, 0, rerun.stderr);
		assert.deepEqual(lines(rerun.stdout), counts(second, "applied"));
		assert.deepEqual(await saved(rec.db), applied);
		assert.deepEqual(await guarded(), untouched);
	});
});
