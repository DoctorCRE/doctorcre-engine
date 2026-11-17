import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { type Caller, doorTest } from "./test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const job = { job: "mail_capture", for_user: "alex" };
const mail = {
	to: "doctor@example.com",
	cc: "blair@example.com",
	subject: "Re: Café ☕",
	body: 'Thanks!\n"See you"',
};
const post = (path: string, args: object, caller: Caller = job) =>
	save(caller, path, { idempotency_key: randomUUID(), ...args });
const submit = (draft: unknown, args: object = {}, user = "alex") =>
	save({ user }, `reply-drafts/${draft}/submission`, {
		idempotency_key: randomUUID(),
		version: 1,
		...mail,
		document_ids: [],
		...args,
	});
const list = (query = "", caller: Caller = job) =>
	save(caller, `reply-drafts${query}`, {}, "GET");
async function draft(n: number) {
	const [status, body] = await post("reply-drafts", {
		activity_id: id(n),
		...mail,
		evidence: "Please reply",
	});
	assert.equal(status, 201);
	return body.draft_id;
}
async function approved(n: number) {
	const d = await draft(n);
	const [status, a] = await submit(d);
	assert.equal(status, 200);
	return { d, a };
}
before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Alex Example'), ('${id(2)}', 'person', 'Blair Example');
 insert into app_user (id, slug) values ('${id(1)}', 'alex'), ('${id(2)}', 'blair');
 insert into activity (id, kind, happened_at) select v, 'email', now() from unnest(array[${Array.from({ length: 12 }, (_, i) => `'${id(i + 10)}'`).join(",")}]::uuid[]) v;
 insert into document (id, name, r2_key) values ('${id(50)}', 'Example plan', 'example/plan.pdf');
 insert into email (activity_id, message_id, sender, subject, body) select id, '<' || id || '@example.test>', 'doctor@example.com', 'Example', 'Please reply' from activity;
 insert into activity_about (activity_id, party_id) select id, '${id(1)}' from activity;
 commit;`);
});
after(cleanup);

test("a draft is stored once per email and owner, submissions freeze the known UTF-8 digest", async () => {
	const args = {
		idempotency_key: randomUUID(),
		activity_id: id(10),
		...mail,
		evidence: "Please reply",
	};
	const first = await save(job, "reply-drafts", args);
	assert.equal(first[0], 201);
	assert.deepEqual(await save(job, "reply-drafts", args), [
		201,
		{ ...first[1], replayed: true },
	]);
	const d = first[1].draft_id;
	assert.deepEqual(
		await post("reply-drafts", {
			...args,
			idempotency_key: randomUUID(),
			body: "Changed",
		}),
		[200, { draft_id: d, version: 1, existing: true }],
	);
	assert.equal(
		(await save(job, "reply-drafts", { ...args, body: "Changed" }))[1].error,
		"key_reuse",
	);
	assert.equal((await submit(d, {}, "blair"))[1].error, "not_mailbox_owner");
	const [status, a] = await submit(d);
	assert.equal(status, 200);
	// Python hashlib.sha256(json.dumps(..., separators=(',', ':'), ensure_ascii=False).encode()).hexdigest().
	assert.equal(
		a.sha256,
		"9f665f453cf3e2ac4d37cab25bfdd63100f427151bd8378e3fa42d77af60b17f",
	);
	assert.equal(a.version, 2);
	assert.deepEqual((await submit(d))[1].version, 2);
	assert.equal((await submit(d))[1].error, "version_conflict");
	const box = (await list())[1];
	assert.equal(box.owner, "alex");
	assert.ok(Array.isArray(box.drafts));
	assert.deepEqual(
		box.drafts.find((r: { draft_id: unknown }) => r.draft_id === d),
		{ draft_id: d, version: 2, ...mail, sha256: a.sha256, document_ids: [] },
	);
	assert.deepEqual(
		(await list("", { ...job, for_user: "blair" }))[1].drafts,
		[],
	);
});

test("delivery checks owner, version and digest; same sent item converges and a different one conflicts", async () => {
	const { d, a } = await approved(11);
	const path = `reply-drafts/${d}/delivery`;
	const receipt = {
		version: a.version,
		sha256: a.sha256,
		status: "sent",
		sent_item_id: "example-sent-11",
		sent_at: "2026-01-01T12:00:00Z",
	};
	assert.equal(
		(await post(path, receipt, { ...job, for_user: "blair" }))[1].error,
		"not_mailbox_owner",
	);
	for (const changed of [{ version: 1 }, { sha256: "0".repeat(64) }])
		assert.equal(
			(await post(path, { ...receipt, ...changed }))[1].error,
			"draft_changed",
		);
	const args = { idempotency_key: randomUUID(), ...receipt };
	assert.deepEqual(await save(job, path, args), [
		200,
		{ draft_id: d, version: 2, status: "sent" },
	]);
	assert.equal((await save(job, path, args))[1].replayed, true);
	assert.equal((await post(path, receipt))[0], 200);
	const conflict = await post(path, {
		...receipt,
		sent_item_id: "example-other",
	});
	assert.equal(conflict[1].error, "already_sent");
	assert.equal(conflict[1].sent_item_id, receipt.sent_item_id);
	assert.equal(
		(
			await post(path, {
				version: 2,
				sha256: a.sha256,
				status: "failed",
				reason: "late",
			})
		)[1].rule,
		"reply_draft_sent_once",
	);
});

test("database rules allow aborted resubmission and unconfirmed reconciliation, and keep other failures final", async () => {
	for (const [n, reason] of [
		[12, "aborted_before_dispatch"],
		[13, "unconfirmed_after_30"],
		[14, "permanent"],
	] as const) {
		const { d, a } = await approved(n);
		const path = `reply-drafts/${d}/delivery`;
		assert.equal(
			(
				await post(path, {
					version: 2,
					sha256: a.sha256,
					status: "failed",
					reason,
				})
			)[0],
			200,
		);
		const again = await submit(d, { version: 2 });
		assert.equal(again[0], reason === "aborted_before_dispatch" ? 200 : 422);
		if (reason === "aborted_before_dispatch") {
			assert.equal(again[1].version, 3);
			assert.equal(
				(
					await post(path, {
						version: 2,
						sha256: a.sha256,
						status: "failed",
						reason,
					})
				)[1].error,
				"draft_changed",
			);
		}
		if (reason === "unconfirmed_after_30") {
			const box = (await list("?unconfirmed=true"))[1];
			assert.ok(Array.isArray(box.drafts));
			assert.ok(
				box.drafts.some((r: { draft_id: unknown }) => r.draft_id === d),
			);
			assert.equal(
				(
					await post(path, {
						version: 2,
						sha256: a.sha256,
						status: "sent",
						sent_item_id: "example-late-13",
						sent_at: "2026-01-02T12:00:00Z",
					})
				)[0],
				200,
			);
		}
	}
});

test("lists page by draft id, requests validate shape, and entrances stay separate", async () => {
	await approved(15);
	await approved(16);
	const first = (await list("?limit=1"))[1];
	assert.ok(Array.isArray(first.drafts));
	assert.equal(first.drafts.length, 1);
	assert.ok(first.next_cursor);
	const second = (await list(`?limit=1&after=${first.next_cursor}`))[1];
	assert.ok(Array.isArray(second.drafts));
	assert.notDeepEqual(first.drafts, second.drafts);
	for (const query of ["?limit=101", "?after=no", "?unconfirmed=false"])
		assert.equal((await list(query))[0], 400);
	assert.equal(
		(await list("", { job: "agent", for_user: "alex" }))[1].error,
		"unknown_job",
	);
	assert.equal(
		(await list("", { job: "mail_capture" }))[1].error,
		"not_mailbox_owner",
	);
	assert.equal((await save({ user: "alex" }, "reply-drafts", {}))[0], 404);
	assert.equal((await post(`reply-drafts/${id(99)}/submission`, {}))[0], 404);
	const { d, a } = await approved(17);
	assert.equal(
		(
			await post(`reply-drafts/${d}/delivery`, {
				version: 2,
				sha256: a.sha256,
				status: "sent",
			})
		)[0],
		400,
	);
	assert.equal((await submit(d, { document_ids: ["invalid"] }))[0], 400);
});

test("attachments freeze with approval and a crossed submission cannot replace them", async () => {
	const d = await draft(18);
	const answers = await Promise.all([
		submit(d, { document_ids: [id(50)] }),
		submit(d, { document_ids: [] }),
	]);
	assert.deepEqual(answers.map((a) => a[0]).sort(), [200, 409]);
	const approved = answers.find((a) => a[0] === 200);
	assert.ok(approved);
	const docs = (
		await db.query(
			"select document_id from reply_draft_document where reply_draft_id = $1",
			[d],
		)
	).rows.map((r) => r.document_id);
	assert.deepEqual(docs, answers[0][0] === 200 ? [id(50)] : []);
	const box = (await list())[1];
	assert.ok(Array.isArray(box.drafts));
	assert.deepEqual(
		box.drafts.find((r: { draft_id: unknown }) => r.draft_id === d)
			.document_ids,
		docs,
	);
});
