import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { docLinkOwnerTransaction } from "./doc-link.ts";
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
				(select pg_get_functiondef(p.oid) || coalesce(array_to_string(p.proconfig, ','), '')
					|| has_function_privilege('engine', p.oid, 'execute')
					|| has_function_privilege('engine_reader', p.oid, 'execute')
					from pg_proc p where p.oid = to_regprocedure('queue_email_split(uuid)')) as enqueue`)
		).rows[0];
	const fresh = await catalog();
	await db.query(`alter table doc_judgment_job drop constraint doc_judgment_job_kind_check,
		add constraint doc_judgment_job_kind_check check (kind in ('email_summary', 'email_filing'));
		drop function queue_email_split(uuid)`);
	const migration = await readSchema("add-email-split-job.sql");
	await db.query(migration);
	await db.query(migration);
	assert.deepEqual(await catalog(), fresh);
	assert.match(fresh?.kinds, /email_split/);
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
