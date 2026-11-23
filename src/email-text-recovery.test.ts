import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { copyTest } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const script = fileURLToPath(
	new URL("../schema/email-text-recovery-candidates.sql", import.meta.url),
);
const { db, setup, cleanup, connectionString } = copyTest();

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
const happenedAt = (n: number) => `2024-01-02 ${n}:00:00.5+00`;

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

const runScript = (out?: string) => {
	const variables = out ? ["-v", `out=${out}`] : [];
	const result = spawnSync(
		"psql",
		["-X", ...variables, "-f", script, connectionString],
		{ encoding: "utf8" },
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
		createHash("sha256").update(body(n), "utf8").digest("hex"),
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
	const secrets = [
		DOCTOR,
		JOE,
		DELL,
		ALIAS,
		"hxstore-key",
		"intake:",
		"Example",
		"@",
		ONE,
		TWO,
		...emails.map((e) => id(e.n)),
		...old.map((o) => id(o.n)),
	];
	for (const secret of secrets) assert.ok(!result.stdout.includes(secret));
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
