import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { Hono } from "hono";
import pg from "pg";
import { docLinkOwnerTransaction, issueDocLink } from "./doc-link.ts";
import { claimDocLink } from "./doc-link-routes.ts";
import { claimDocWork, finishDocJudgment } from "./doc-queue.ts";
import { copyTest, readSchema } from "./test-copy.ts";

const { db, setup, cleanup, connectionString } = copyTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [JOE, DELL, SAM] = [id(1), id(2), id(3)];
const LEAD_SOURCE = "notices@source.example.test";

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${JOE}', 'person', 'Joe Example'), ('${DELL}', 'person', 'Dell Example'), ('${SAM}', 'person', 'Sam Example');
		insert into app_user (id, slug) values ('${JOE}', 'joe'), ('${DELL}', 'dell');
		insert into lead_source_sender (address, name) values ('${LEAD_SOURCE}', 'Example source');
		commit;`);
});
after(cleanup);

async function asJob(
	job: string,
	user: string,
	statements: [string, unknown[]][],
) {
	await db.query("begin");
	try {
		await db.query(
			"select set_config('engine.job', $1, true), set_config('engine.user_id', $2, true)",
			[job, user],
		);
		for (const [statement, values] of statements)
			await db.query(statement, values);
		await db.query("commit");
	} catch (error) {
		await db.query("rollback");
		throw error;
	}
}
async function email(
	n: number,
	body: string,
	mailboxes: string[],
	{ split = false, sender = "sam@example.test" } = {},
) {
	const activity = id(n);
	await asJob("old_system", "", [
		[
			"insert into activity (id, kind, happened_at) values ($1, 'email', '2026-11-02T15:00:00Z')",
			[activity],
		],
		[
			"insert into activity_about (activity_id, party_id) values ($1, $2)",
			[activity, SAM],
		],
		[
			`insert into email (activity_id, message_id, sender, subject, body, authored, history)
			values ($1, $2, $3, 'Example subject', $4::text,
				case when $5 then $4::text end, case when $5 then '' end)`,
			[activity, `split-${n}`, sender, body, split],
		],
		[
			"insert into email_mailbox (activity_id, user_id) select $1, unnest($2::uuid[])",
			[activity, mailboxes],
		],
	]);
	return activity;
}
const queue = (activity: string, owner: string) =>
	asJob("mail_capture", owner, [["select queue_email_split($1)", [activity]]]);
const claim = (runner: Parameters<typeof claimDocWork>[2]) =>
	docLinkOwnerTransaction(connectionString, JOE, (tx) =>
		claimDocWork(tx, JOE, runner),
	);
const answer = (claim_id: string, authored: unknown, extra = {}) =>
	docLinkOwnerTransaction(connectionString, JOE, (tx) =>
		finishDocJudgment(tx, JOE, claim_id, {
			kind: "answered",
			result: { authored, ...extra },
		}),
	);
const pair = async (activity: string) =>
	(
		await db.query(
			"select authored, history, changed_by_job, changed_for_user_id from email where activity_id = $1",
			[activity],
		)
	).rows[0];

test("the migration gives an existing queue the split kind and its enqueue", async () => {
	const catalog = async () =>
		(
			await db.query(`select
				(select pg_get_constraintdef(oid) from pg_constraint
					where conrelid = 'doc_judgment_job'::regclass and conname = 'doc_judgment_job_kind_check') as kinds,
				(select indexdef from pg_indexes where indexname = 'doc_judgment_job_one_split') as one_split,
				(select pg_get_functiondef(p.oid) || coalesce(array_to_string(p.proconfig, ','), '')
					|| has_function_privilege('engine', p.oid, 'execute')
					|| has_function_privilege('engine_reader', p.oid, 'execute')
					from pg_proc p where p.oid = to_regprocedure('queue_email_split(uuid)')) as enqueue`)
		).rows[0];
	const fresh = await catalog();
	await db.query(`alter table doc_judgment_job drop constraint doc_judgment_job_kind_check,
		add constraint doc_judgment_job_kind_check check (kind in ('email_summary', 'email_filing'));
		drop function queue_email_split(uuid);
		drop index doc_judgment_job_one_split`);
	const migration = await readSchema("add-email-split-job.sql");
	await db.query(migration);
	await db.query(migration);
	const migrated = await catalog();
	assert.equal(migrated?.one_split, fresh?.one_split);
	assert.equal(migrated?.enqueue, fresh?.enqueue);
	assert.match(migrated?.kinds, /email_split/);
	assert.match(fresh?.kinds, /email_split/);
	assert.match(fresh?.one_split, /UNIQUE INDEX doc_judgment_job_one_split/);
	assert.match(
		fresh?.one_split,
		/\(activity_id\) WHERE \(kind = 'email_split'::text\)/,
	);
	assert.match(fresh?.enqueue, /on conflict do nothing/);
	assert.doesNotMatch(
		fresh?.enqueue,
		/on conflict \(owner_user_id, idempotency_key\)/,
	);
	assert.match(fresh?.enqueue, /SECURITY DEFINER[\s\S]*truefalse$/);
});

test("a split keeps the sender's paragraphs and folds the rest of the body", async () => {
	const body =
		"Hi Sam, the tour is Thursday at 10. Thanks, Alex Example Example Co | 555-0100 On Mon, Sam wrote: > Can we tour?";
	const activity = await email(10, body, [JOE, DELL]);
	await queue(activity, JOE);
	await queue(activity, DELL);
	assert.equal(
		(
			await db.query(
				"select from doc_judgment_job where activity_id = $1 and kind = 'email_split'",
				[activity],
			)
		).rowCount,
		1,
	);
	assert.equal(await claim("mac_with_judgment"), null);
	assert.equal(await claim("backup_mail"), null);

	const work = await claim("mac_with_split");
	assert.ok(work && work.kind === "email_split");
	assert.deepEqual(
		{ activity_id: work.activity_id, body: work.body },
		{ activity_id: activity, body },
	);
	const message = [
		"Hi Sam, the tour is Thursday at 10.",
		"Thanks, Alex Example",
	];
	for (const refused of [
		[...message].reverse(),
		[message[0], "Made up."],
		[message[0], message[0]],
		[message[0], " "],
		"Hi Sam",
	])
		assert.equal(await answer(work.claim_id, refused), 422);
	assert.equal(await answer(work.claim_id, message, { history: "" }), 422);
	assert.equal((await pair(activity)).authored, null);

	assert.equal(await answer(work.claim_id, message), 204);
	assert.deepEqual(await pair(activity), {
		authored: "Hi Sam, the tour is Thursday at 10.\n\nThanks, Alex Example",
		history: "Example Co | 555-0100 On Mon, Sam wrote: > Can we tour?",
		changed_by_job: "mail_capture",
		changed_for_user_id: JOE,
	});
	assert.equal(await answer(work.claim_id, message), 404);
});

test("a split never replaces a pair stored after its claim", async () => {
	const activity = await email(11, "Thursday works.", [JOE]);
	await queue(activity, JOE);
	const work = await claim("mac_with_split");
	assert.ok(work);
	await asJob("mail_capture", "", [
		[
			"update email set authored = body, history = '' where activity_id = $1",
			[activity],
		],
	]);
	assert.equal(await answer(work.claim_id, []), 204);
	assert.deepEqual(await pair(activity), {
		authored: "Thursday works.",
		history: "",
		changed_by_job: "mail_capture",
		changed_for_user_id: null,
	});
});

test("the backfill queues one split for each unsplit email and prints counts only", async () => {
	await email(20, "Unsplit in one mailbox.", [JOE]);
	const shared = await email(21, "Unsplit in both mailboxes.", [DELL, JOE]);
	await email(22, "Already split.", [JOE], { split: true });
	await email(23, "A lead notice.", [JOE], { sender: LEAD_SOURCE });
	await email(24, "In no mailbox.", []);
	await queue(await email(25, "Queued at capture.", [DELL]), DELL);
	const run = (apply: string) => {
		const result = spawnSync(
			"psql",
			[
				"-X",
				"-v",
				`apply=${apply}`,
				"-f",
				fileURLToPath(
					new URL("../schema/queue-email-splits.sql", import.meta.url),
				),
				connectionString,
			],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr);
		return result.stdout;
	};
	const jobs = async () =>
		(
			await db.query(
				"select activity_id, owner_user_id from doc_judgment_job where kind = 'email_split' order by activity_id",
			)
		).rows;
	const earlier = await jobs();

	const counts = "unsplit,queued,already_queued,not_queued\n";
	assert.equal(run("off"), `${counts}5,2,1,2\ndry_run\n`);
	assert.deepEqual(await jobs(), earlier);
	assert.equal(run("on"), `${counts}5,2,1,2\napplied\n`);
	assert.deepEqual(
		(await jobs()).filter((job) => [id(20), shared].includes(job.activity_id)),
		[
			{ activity_id: id(20), owner_user_id: JOE },
			{ activity_id: shared, owner_user_id: JOE },
		],
	);
	assert.equal(run("on"), `${counts}5,0,3,2\napplied\n`);
});

test("Doc-Link-Work claims a split only together with judgment", async () => {
	const activity = await email(30, "Please split this note.", [JOE]);
	await queue(activity, JOE);
	const { credential } = await docLinkOwnerTransaction(
		connectionString,
		JOE,
		(tx) => issueDocLink(tx, JOE),
	);
	const mac = new Hono<{
		Bindings: { DATABASE_WRITER: { connectionString: string } };
	}>().post("/claim", claimDocLink);
	const poll = (work: string) =>
		mac.request(
			"/claim",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${credential}`,
					"Doc-Link-Readiness": "ready",
					"Doc-Link-Work": work,
				},
			},
			{ DATABASE_WRITER: { connectionString } },
		);

	assert.equal((await poll("email_split")).status, 204);
	assert.equal((await poll("judgment")).status, 204);
	const claimed = await poll("judgment, email_split");
	assert.equal(claimed.status, 200);
	const body: unknown = await claimed.json();
	assert.equal(
		body !== null && typeof body === "object" && "kind" in body
			? body.kind
			: undefined,
		"email_split",
	);
});

test("a second direct insert of an email_split for one email is refused", async () => {
	const activity = await email(31, "One email.", [JOE, DELL]);
	const insert = (owner: string, key: number) =>
		db.query(
			`insert into doc_judgment_job (owner_user_id, activity_id, idempotency_key, kind)
			values ($1, $2, $3, 'email_split')`,
			[owner, activity, id(key)],
		);
	await insert(JOE, 310);
	await assert.rejects(insert(DELL, 311), {
		code: "23505",
		constraint: "doc_judgment_job_one_split",
	});
});

test("queue_email_split from Joe and then Dell leaves one split", async () => {
	const activity = await email(32, "Shared inbox.", [JOE, DELL]);
	const open = async (user: string) => {
		const client = new pg.Client({
			connectionString,
			options: "-c search_path=next -c TimeZone=UTC",
		});
		await client.connect();
		await client.query("begin");
		await client.query(
			"select set_config('engine.job', 'mail_capture', true), set_config('engine.user_id', $1, true)",
			[user],
		);
		return client;
	};
	const joe = await open(JOE);
	const dell = await open(DELL);
	try {
		await joe.query("select queue_email_split($1)", [activity]);
		// Dell runs before Joe commits, so only the unique index stops a second insert.
		await dell.query("set local lock_timeout = '1ms'");
		let blocked = false;
		try {
			await dell.query("select queue_email_split($1)", [activity]);
		} catch (error) {
			assert.equal(
				error instanceof Error && "code" in error ? error.code : undefined,
				"55P03",
			);
			blocked = true;
		}
		await joe.query("commit");
		if (blocked) {
			await dell.query("rollback");
			await dell.query("begin");
			await dell.query(
				"select set_config('engine.job', 'mail_capture', true), set_config('engine.user_id', $1, true)",
				[DELL],
			);
			await dell.query("select queue_email_split($1)", [activity]);
		}
		await dell.query("commit");
		assert.equal(
			(
				await db.query(
					"select count(*)::int as n from doc_judgment_job where activity_id = $1 and kind = 'email_split'",
					[activity],
				)
			).rows[0].n,
			1,
		);
	} finally {
		await joe.query("rollback").catch(() => undefined);
		await dell.query("rollback").catch(() => undefined);
		await joe.end();
		await dell.end();
	}
});
