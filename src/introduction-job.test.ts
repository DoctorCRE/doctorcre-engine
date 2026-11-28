import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { docLinkOwnerTransaction } from "./doc-link.ts";
import { claimDocWork, finishDocJudgment } from "./doc-queue.ts";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, save, writerUrl } = doorTest();
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
const claim = (
	runner: Parameters<typeof claimDocWork>[2],
	introductions = false,
) => ownerWork((tx) => claimDocWork(tx, joe, runner, introductions));
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
			body: "I'm introducing Pat Example to your team for Example West Suite.",
			result: { ...finding, deal_id: deal },
			saved: true,
		},
		{
			body: "Sam Example, meet the team.",
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

		const work = await claim("mac_with_split", true);
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
	const ordinary = await capture("Pat Example is free at noon.");
	assert.equal((await jobsFor(ordinary)).rowCount, 0);
});
