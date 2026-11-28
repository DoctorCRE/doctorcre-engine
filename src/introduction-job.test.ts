import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { main as backfillMain } from "../scripts/queue-introductions.ts";
import {
	introductionMail,
	validateIntroductions,
} from "./activity/introduction-judgment.ts";
import { docLinkOwnerTransaction } from "./doc-link.ts";
import { claimDocWork, finishDocJudgment } from "./doc-queue.ts";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, save, writerUrl, connectionString } = doorTest();
const [joe, vendor, pat, sam, deal] = [
	randomUUID(),
	randomUUID(),
	randomUUID(),
	randomUUID(),
	randomUUID(),
];

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into role (slug, label) values ('vendor', 'Vendor');
		insert into party (id, kind, name) values
			('${joe}', 'person', 'Joe Example'), ('${vendor}', 'company', 'Example Surveying'),
			('${pat}', 'person', 'Pat Example'), ('${sam}', 'person', 'Sam Example');
		insert into app_user (id, slug) values ('${joe}', 'joe');
		insert into party_role (party_id, role) values ('${vendor}', 'vendor');
		insert into party_email (party_id, address, label) values
			('${joe}', 'joe@example.test', 'work'), ('${vendor}', 'vendor@example.test', 'work');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example West Suite', '${joe}');
		insert into introduction (vendor_id, introduced_party_id, made_by, introduced_on, note)
			values ('${vendor}', '${sam}', 'vendor', '2026-11-01', 'Recorded by a partner.');
		commit;`);
});
after(cleanup);

const capture = async (body: string, sender = "joe@example.test") => {
	const [status, result] = await save(
		{ job: "mail_capture", for_user: "joe" },
		"activities",
		{
			idempotency_key: randomUUID(),
			kind: "email",
			about: [{ party_id: pat }],
			happened_at: "2026-11-02T02:00:00Z",
			email: {
				message_id: randomUUID(),
				sender,
				recipients: [],
				subject: "Example subject",
				body,
				authored: body,
				history: "",
			},
		},
	);
	assert.equal(status, 201, JSON.stringify(result));
	assert.ok(typeof result.activity_id === "string");
	return result.activity_id;
};

const ownerWork = <T>(run: Parameters<typeof docLinkOwnerTransaction<T>>[2]) =>
	docLinkOwnerTransaction(writerUrl, joe, run);
const claim = (runner: Parameters<typeof claimDocWork>[2]) =>
	ownerWork((tx) => claimDocWork(tx, joe, runner));
const jobsFor = (activity: string) =>
	db.query(
		"select owner_user_id, result from doc_judgment_job where activity_id = $1 and kind = 'introduction'",
		[activity],
	);

test("capture and Mac judgment save exact unconfirmed introductions without changing vendor counts", async () => {
	const read = () =>
		save({ user: "joe" }, `vendors/${vendor}/relationships`, {}, "GET");
	const [status, before] = await read();
	assert.equal(status, 200);
	const recorded = (await db.query("select * from introduction")).rows;
	const finding = {
		vendor_id: vendor,
		introduced_party_id: pat,
		deal_id: null,
		introduced_by_user_id: null,
		made_by: "vendor",
	};
	const cases = [
		{
			body: "I'm introducing Pat Example to Example Surveying.",
			result: { ...finding, made_by: "team", introduced_by_user_id: joe },
			saved: true,
		},
		{
			body: "At Example Surveying, I'm introducing Pat Example for Example West Suite.",
			result: { ...finding, deal_id: deal },
			saved: true,
		},
		{
			body: "Sam Example, meet the team from Example Surveying.",
			result: { ...finding, introduced_party_id: sam },
			saved: false,
		},
		{
			body: "Pat Example, Example Surveying will arrive at noon.",
			result: null,
			saved: false,
		},
	];
	for (const { body, result, saved } of cases) {
		const sender =
			result?.made_by === "vendor" ? "vendor@example.test" : "joe@example.test";
		const activity = await capture(body, sender);
		assert.deepEqual((await jobsFor(activity)).rows, [
			{ owner_user_id: joe, result: null },
		]);

		const summary = await claim("mac_with_judgment");
		assert.ok(summary?.kind === "email_summary");
		await ownerWork((tx) =>
			finishDocJudgment(tx, joe, summary.claim_id, { kind: "failed" }),
		);
		assert.equal(await claim("mac_with_split"), null);
		assert.equal(await claim("backup_mail"), null);

		const work = await claim("mac_with_split_and_introduction");
		assert.ok(work?.kind === "introduction");
		assert.equal(work.activity_id, activity);
		const answer = (quote: string) =>
			ownerWork((tx) =>
				finishDocJudgment(tx, joe, work.claim_id, {
					kind: "answered",
					result: { introductions: result ? [{ ...result, quote }] : [] },
				}),
			);
		if (result) assert.equal(await answer(body.toUpperCase()), 422);
		assert.equal(await answer(body), 204);
		const {
			rows: [completed],
		} = await jobsFor(activity);
		assert.deepEqual(completed?.result, {
			introductions: result ? [{ ...result, quote: body }] : [],
			introduced_on: "2026-11-01",
		});
		const { rows } = await db.query(
			`select vendor_id, made_by, introduced_by_user_id, introduced_party_id,
			deal_id, introduced_on::text, source, confirmed
			from introduction i join doc_judgment_job j on j.id = i.source_job_id where j.activity_id = $1`,
			[activity],
		);
		const expected = {
			...result,
			introduced_on: "2026-11-01",
			source: "found in email",
			confirmed: false,
		};
		assert.deepEqual(rows, saved ? [expected] : []);
	}
	assert.deepEqual(
		(await db.query("select * from introduction where confirmed")).rows,
		recorded,
	);
	assert.deepEqual(await read(), [200, before]);
	assert.equal(
		(
			await db.query(
				"select deals_it_introduced from vendor_track_record where party_id = $1",
				[vendor],
			)
		).rows[0]?.deals_it_introduced,
		"0",
	);

	const [recordedStatus] = await save({ user: "joe" }, "introductions", {
		idempotency_key: randomUUID(),
		vendor_id: vendor,
		made_by: "vendor",
		introduced_party_id: pat,
		introduced_on: "2026-11-01",
	});
	assert.equal(recordedStatus, 201);
	assert.equal(
		(
			await db.query(
				"select from introduction where introduced_party_id = $1 and made_by = 'vendor'",
				[pat],
			)
		).rowCount,
		1,
	);
	assert.deepEqual((await read())[1].counts, {
		sent_us: 2,
		we_sent_them: 0,
		chosen: 0,
		knows: 0,
	});
	for (const body of [
		"Pat Example is free at noon.",
		"Meet Pat Exemplary from Example Surveying.",
	]) {
		assert.equal((await jobsFor(await capture(body))).rowCount, 0);
	}
	const duplicateVendor = randomUUID();
	const duplicatePerson = randomUUID();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${duplicateVendor}', 'company', 'Surveying Alias'), ('${duplicatePerson}', 'person', 'Pat Alias');
		insert into party_role (party_id, role) values ('${duplicateVendor}', 'vendor');
		insert into introduction (vendor_id, introduced_party_id, made_by, introduced_by_user_id, introduced_on, confirmed, source_job_id)
		select '${duplicateVendor}', introduced_party_id, made_by, introduced_by_user_id, introduced_on, false, source_job_id
		from introduction where not confirmed;
		insert into introduction (vendor_id, introduced_party_id, made_by, introduced_by_user_id, introduced_on, confirmed, source_job_id)
		select vendor_id, '${duplicatePerson}', made_by, introduced_by_user_id, introduced_on, false, source_job_id
		from introduction where not confirmed and vendor_id = '${vendor}';
		select merge_party('${duplicateVendor}', '${vendor}');
		select merge_party('${duplicatePerson}', '${pat}');
		commit;`);
	const pending = await db.query(
		"select id, source_job_id from introduction where not confirmed and vendor_id = $1 and introduced_party_id = $2",
		[vendor, pat],
	);
	assert.equal(pending.rowCount, 1);
	const sourced = pending.rows[0];
	assert.ok(sourced);
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		update introduction set confirmed = true where id = '${sourced.id}'; commit;`);
	await assert.rejects(
		db.query("delete from doc_judgment_job where id = $1", [
			sourced.source_job_id,
		]),
		{ constraint: "introduction_source_job_id_fkey" },
	);
	assert.equal(
		(
			await db.query("select from introduction where id = $1 and confirmed", [
				sourced.id,
			])
		).rowCount,
		1,
	);

	const ambiguousDeal = randomUUID();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into deal (id, name, owner_user_id) values ('${ambiguousDeal}', 'EXAMPLE West-Suite', '${joe}');
		commit;`);
	const body = "Pat Example, meet Example Surveying for Example West Suite.";
	const activity = await capture(body);
	const context = await ownerWork((tx) => introductionMail(tx, activity));
	assert.ok(context);
	assert.equal(
		context.candidates.some((c) => c.kind === "deal"),
		false,
	);
	assert.equal(
		validateIntroductions(
			{ introductions: [{ ...finding, deal_id: deal, quote: body }] },
			context,
			() => true,
		),
		undefined,
	);

	const anotherPerson = randomUUID();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${anotherPerson}', 'person', 'PAT-Example');
		commit;`);
	const someKnown = await capture(
		"Pat Example and Sam Example, meet Example Surveying.",
	);
	const people = await ownerWork((tx) => introductionMail(tx, someKnown));
	assert.deepEqual(
		people?.candidates.filter((c) => c.kind === "person").map((c) => c.id),
		[sam],
	);

	const anotherVendor = randomUUID();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${anotherVendor}', 'company', 'EXAMPLE-Surveying');
		insert into party_role (party_id, role) values ('${anotherVendor}', 'vendor');
		commit;`);
	const ambiguous = await capture(
		"Pat Example and Sam Example, meet Example Surveying.",
	);
	assert.equal((await jobsFor(ambiguous)).rowCount, 0);
});

test("a verbatim quote must be meaningful and name the records it supports", () => {
	const result = {
		vendor_id: vendor,
		introduced_party_id: pat,
		deal_id: null,
		made_by: "vendor",
		introduced_by_user_id: null,
	};
	const context = {
		sent_on: "2026-11-01",
		sender_ids: [],
		candidates: [
			{
				id: vendor,
				kind: "vendor" as const,
				name: "A B",
				aliases: ["Contact Example"],
			},
			{ id: pat, kind: "person" as const, name: "C D", aliases: [] },
			{
				id: deal,
				kind: "deal" as const,
				name: "Example West Suite",
				aliases: [],
			},
		],
	};
	const body =
		"A B, meet C D. This is a long introduction. I'll introduce C D to Contact Example.";
	const validate = (quote: string, deal_id: string | null = null) =>
		validateIntroductions(
			{ introductions: [{ ...result, quote, deal_id }] },
			context,
			(q) => body.includes(q),
		);
	assert.equal(validate("A B, meet C D."), undefined);
	assert.equal(validate("This is a long introduction."), undefined);
	assert.equal(
		validate("I'll introduce C D to Contact Example.", deal),
		undefined,
	);
	assert.ok(validate("I'll introduce C D to Contact Example."));
});

test("backfill counts and queues eligible stored mail once", async () => {
	assert.equal(typeof backfillMain, "function");
	const { spawnSync } = await import("node:child_process");
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${randomUUID()}', 'person', 'Morgan Fixture'), ('${randomUUID()}', 'company', 'Fixture Plumbing');
		insert into party_role (party_id, role) select id, 'vendor' from party where name = 'Fixture Plumbing'; commit;`);
	const eligible = await capture("Morgan Fixture meets Fixture Plumbing.");
	const ineligible = await capture("Morgan Fixture says hello.");
	const lead = await capture(
		"Morgan Fixture meets Fixture Plumbing.",
		"notice@lead.example.test",
	);
	await db.query(
		`insert into lead_source_sender (address, name) values ('notice@lead.example.test', 'Example source')`,
	);
	await db.query(
		"delete from doc_judgment_job where kind = 'introduction' and activity_id = any($1::uuid[])",
		[[eligible, ineligible, lead]],
	);
	const run = (dry: boolean) => {
		const result = spawnSync(
			process.execPath,
			["scripts/queue-introductions.ts", ...(dry ? ["--dry-run"] : [])],
			{
				env: { ...process.env, DATABASE_URL: connectionString },
				encoding: "utf8",
			},
		);
		assert.equal(result.status, 0, result.stderr);
		assert.match(
			result.stdout,
			/^eligible,queued,already_queued\n\d+,\d+,\d+\n(dry_run|applied)\n$/,
		);
		return result.stdout;
	};
	const jobs = async () =>
		(
			await db.query(
				"select activity_id from doc_judgment_job where kind = 'introduction' and activity_id = any($1::uuid[]) order by activity_id",
				[[eligible, ineligible, lead]],
			)
		).rows;
	const dry = run(true);
	assert.deepEqual(await jobs(), []);
	assert.equal(run(false), dry.replace("dry_run", "applied"));
	assert.deepEqual(await jobs(), [{ activity_id: eligible }]);
	const rerun = run(false).split("\n")[1]?.split(",");
	assert.equal(rerun?.[1], "0");
	assert.deepEqual(await jobs(), [{ activity_id: eligible }]);
});
