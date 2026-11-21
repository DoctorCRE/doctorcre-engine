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
const draftArgs = (n: number) => ({
	activity_id: id(n),
	subject: mail.subject,
	body: mail.body,
	evidence: "Please reply",
});
async function draft(n: number, caller = job) {
	const [status, body] = await post("reply-drafts", draftArgs(n), caller);
	assert.equal(status, 201);
	assert.ok(typeof body.draft_id === "string");
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
 insert into party_email (party_id, address, label, is_primary) values ('${id(2)}', 'blair@example.com', 'work', true);
 insert into activity (id, kind, happened_at) select v, 'email', '2026-01-02T12:00:00Z' from unnest(array[${Array.from({ length: 27 }, (_, i) => `'${id(i + 10)}'`).join(",")}]::uuid[]) v;
 update activity set happened_at = '2026-01-01T12:00:00Z' where id in ('${id(25)}', '${id(34)}', '${id(35)}');
 insert into document (id, name, r2_key) values ('${id(50)}', 'Example plan', 'example/plan.pdf');
 insert into email (activity_id, message_id, sender, subject, body) select id, '<' || id || '@example.test>', 'doctor@example.com', 'Example', 'Please reply' from activity;
 update email set conversation_id = 'ExampleThread' where activity_id in (${[22, 23, 24, 25, 29].map((n) => `'${id(n)}'`).join(",")});
 update email set conversation_id = 'examplethread' where activity_id = '${id(26)}';
 update email set conversation_id = 'ConcurrentThread' where activity_id in ('${id(30)}', '${id(31)}');
 update email set conversation_id = 'BackfilledThread' where activity_id between '${id(32)}' and '${id(34)}';
 update email set conversation_id = 'RollbackThread' where activity_id in ('${id(35)}', '${id(36)}');
 insert into activity_about (activity_id, party_id) select id, '${id(1)}' from activity;
 commit;`);
});
after(cleanup);

test("a new store dismisses only its partner's pending draft in the same Outlook conversation", async () => {
	const { d: approvedDraft } = await approved(22);
	const { d: sentDraft, a: sent } = await approved(23);
	assert.equal(
		(
			await post(`reply-drafts/${sentDraft}/delivery`, {
				version: sent.version,
				sha256: sent.sha256,
				status: "sent",
				sent_item_id: "example-sent-23",
				sent_at: "2026-01-01T12:00:00Z",
			})
		)[0],
		200,
	);
	const { d: failedDraft, a: failed } = await approved(24);
	assert.equal(
		(
			await post(`reply-drafts/${failedDraft}/delivery`, {
				version: failed.version,
				sha256: failed.sha256,
				status: "failed",
				reason: "unconfirmed_after_30",
			})
		)[0],
		200,
	);
	const older = await draft(25);
	const otherPartner = await draft(25, { ...job, for_user: "blair" });
	const otherConversation = await draft(26);
	const noConversation = [await draft(27), await draft(28)];

	const newer = await draft(29);
	assert.deepEqual(
		await post("reply-drafts", { ...draftArgs(25), body: "Changed" }),
		[200, { draft_id: older, version: 1, existing: true }],
	);
	const [status, refusal] = await submit(older);
	assert.deepEqual(
		[status, refusal.error, refusal.version],
		[409, "draft_changed", 1],
	);
	const { rows } = await db.query(
		"select id, status from reply_draft where email_activity_id between $1 and $2",
		[id(22), id(29)],
	);
	assert.deepEqual(Object.fromEntries(rows.map((r) => [r.id, r.status])), {
		[older]: "dismissed",
		[approvedDraft]: "approved",
		[sentDraft]: "sent",
		[failedDraft]: "failed",
		...Object.fromEntries(
			[newer, otherPartner, otherConversation, ...noConversation].map((d) => [
				d,
				"pending",
			]),
		),
	});
	const history = await db.query(
		`select old_value ->> 'status' as previous, new_value ->> 'status' as current,
			new_value ->> 'dismiss_reason' as reason, changed_by_job, changed_for_user_id
		from change where table_name = 'reply_draft' and record ->> 'id' = $1 and action = 'update'`,
		[older],
	);
	assert.deepEqual(history.rows, [
		{
			previous: "pending",
			current: "dismissed",
			reason: "Replaced by a newer reply draft in this conversation",
			changed_by_job: "mail_capture",
			changed_for_user_id: id(1),
		},
	]);
});

test("overlapping stores in the same conversation leave the highest activity id pending when times tie", async () => {
	const drafts = await Promise.all([draft(30), draft(31)]);
	const { rows } = await db.query(
		"select status from reply_draft where id = any($1::uuid[]) order by email_activity_id",
		[drafts],
	);
	assert.deepEqual(rows, [{ status: "dismissed" }, { status: "pending" }]);
});

test("an older email or a lower activity id at the same time cannot replace the newest email's draft", async () => {
	const newest = await draft(33);
	const tied = await draft(32);
	const older = await draft(34);
	const { rows } = await db.query(
		"select id, status from reply_draft where id = any($1::uuid[]) order by email_activity_id",
		[[tied, newest, older]],
	);
	assert.deepEqual(rows, [
		{ id: tied, status: "dismissed" },
		{ id: newest, status: "pending" },
		{ id: older, status: "dismissed" },
	]);
});

test("a receipt failure rolls back the new draft, earlier dismissal, and change history", async () => {
	const earlier = await draft(35);
	const key = randomUUID();
	await db.query(`alter table save_receipt add constraint test_reply_receipt_refused
		check (idempotency_key <> '${key}')`);
	const [status, refusal] = await save(job, "reply-drafts", {
		...draftArgs(36),
		idempotency_key: key,
	});
	assert.deepEqual([status, refusal.rule], [422, "test_reply_receipt_refused"]);
	const { rows } = await db.query(
		"select id, status, revision, decided_at, dismiss_reason from reply_draft where email_activity_id in ($1, $2)",
		[id(35), id(36)],
	);
	assert.deepEqual(rows, [
		{
			id: earlier,
			status: "pending",
			revision: 1,
			decided_at: null,
			dismiss_reason: null,
		},
	]);
	const history = await db.query(
		"select action from change where table_name = 'reply_draft' and record ->> 'id' = $1",
		[earlier],
	);
	assert.deepEqual(history.rows, [{ action: "insert" }]);
});

test("a draft is stored once per email and owner, submissions freeze the known UTF-8 digest", async () => {
	const args = {
		idempotency_key: randomUUID(),
		activity_id: id(10),
		subject: mail.subject,
		body: mail.body,
		evidence: "Please reply",
	};
	assert.equal(
		(await post("reply-drafts", { ...args, to: mail.to, cc: mail.cc }))[0],
		400,
	);
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
	const [conflict, refusal] = await submit(d);
	assert.deepEqual(
		[conflict, refusal.error, refusal.version],
		[409, "version_conflict", 2],
	);
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

test("the owner can read, edit and decline a pending reply at its current revision", async () => {
	const d = await draft(36);
	const path = `reply-drafts/${d}`;
	const alex = { user: "alex" };
	const blair = { user: "blair" };
	const get = (caller: Caller = alex) => save(caller, path, {}, "GET");
	const [status, detail] = await get();
	assert.equal(status, 200);
	assert.deepEqual(detail, {
		draft_id: d,
		version: 1,
		status: "pending",
		failure_reason: null,
		...mail,
		attachments: [],
		thread: [],
		source_activity: {
			id: id(36),
			kind: "email",
			sender: mail.to,
			sender_name: null,
			subject: "Example",
			body: "Please reply",
			happened_at: "2026-01-02T12:00:00.000Z",
		},
	});
	const otherDraft = await draft(36, { ...job, for_user: "blair" });
	assert.equal(
		(await save(blair, `reply-drafts/${otherDraft}`, {}, "GET"))[1].cc,
		null,
	);
	assert.equal((await get(blair))[0], 403);
	assert.equal((await get(job))[0], 404);

	const edit = {
		idempotency_key: randomUUID(),
		version: 1,
		subject: "Re: Example",
		body: "The plan is attached.",
	};
	const decline = {
		idempotency_key: randomUUID(),
		version: 2,
		reason: "Replied from Outlook",
	};
	const edited = { draft_id: d, version: 2, status: "pending" };
	assert.deepEqual(await save(alex, `${path}/edit`, edit), [200, edited]);
	assert.deepEqual(await save(alex, `${path}/edit`, edit), [
		200,
		{ ...edited, replayed: true },
	]);
	assert.partialDeepStrictEqual((await get())[1], {
		...edited,
		body: edit.body,
		subject: edit.subject,
	});
	for (const [action, args] of [
		["edit", edit],
		["dismissal", decline],
	] as const) {
		const route = `${path}/${action}`;
		const attempt = {
			...args,
			idempotency_key: randomUUID(),
			version: 1,
		};
		assert.equal((await save(blair, route, attempt))[0], 403);
		assert.equal((await save(job, route, attempt))[0], 404);
		const [stale, refusal] = await save(alex, route, attempt);
		assert.equal(stale, 409);
		assert.partialDeepStrictEqual(refusal, {
			error: "version_conflict",
			version: 2,
		});
	}
	assert.equal((await post(`${path}/dismissal`, { version: 2 }, alex))[0], 400);
	const dismissed = { draft_id: d, version: 3, status: "dismissed" };
	assert.deepEqual(await save(alex, `${path}/dismissal`, decline), [
		200,
		dismissed,
	]);
	assert.deepEqual(await save(alex, `${path}/dismissal`, decline), [
		200,
		{ ...dismissed, replayed: true },
	]);
	assert.partialDeepStrictEqual((await get())[1], dismissed);
	const [closed, refusal] = await post(
		`${path}/edit`,
		{ version: 3, subject: edit.subject, body: edit.body },
		alex,
	);
	assert.equal(closed, 409);
	assert.partialDeepStrictEqual(refusal, {
		error: "draft_changed",
		version: 3,
	});
});

test("draft detail shows the frozen addresses and attached documents after approval", async () => {
	const d = await draft(21);
	assert.equal(
		(await submit(d, { cc: "frozen@example.test", document_ids: [id(50)] }))[0],
		200,
	);
	const [status, detail] = await save(
		{ user: "alex" },
		`reply-drafts/${d}`,
		{},
		"GET",
	);
	assert.equal(status, 200);
	assert.partialDeepStrictEqual(detail, {
		status: "approved",
		version: 2,
		to: mail.to,
		cc: "frozen@example.test",
		attachments: [
			{ document_id: id(50), name: "Example plan", content_type: null },
		],
	});
});

test("an approved draft refuses edits and repeat approval and still records its receipt", async () => {
	const { d, a } = await approved(19);
	assert.partialDeepStrictEqual(
		await post(
			`reply-drafts/${d}/edit`,
			{ version: a.version, subject: "Revised subject", body: "Revised reply" },
			{ user: "alex" },
		),
		[409, { error: "draft_changed", version: a.version }],
	);
	const [status, refusal] = await submit(d, { version: 2 });
	assert.deepEqual(
		[status, refusal.error, refusal.rule],
		[422, "database_refused_the_statement", "reply_draft_sent_once"],
	);
	assert.deepEqual(
		await post(`reply-drafts/${d}/delivery`, {
			version: a.version,
			sha256: a.sha256,
			status: "sent",
			sent_item_id: "example-sent-19",
			sent_at: "2026-01-01T12:00:00Z",
		}),
		[200, { draft_id: d, version: 2, status: "sent" }],
	);
});

test("an invalid-recipient failure can be approved with corrected recipients and sent", async () => {
	const d = await draft(20);
	const [status, a] = await submit(d, { cc: "wrong@example.com" });
	assert.equal(status, 200);
	const path = `reply-drafts/${d}/delivery`;
	assert.equal(
		(
			await post(path, {
				version: 2,
				sha256: a.sha256,
				status: "failed",
				reason: "submission_recipients_invalid",
			})
		)[0],
		200,
	);
	const [again, corrected] = await submit(d, {
		version: 2,
		document_ids: [id(50)],
	});
	assert.equal(again, 200);
	assert.equal(corrected.version, 3);
	const box = (await list())[1];
	assert.ok(Array.isArray(box.drafts));
	assert.deepEqual(
		box.drafts.find((r: { draft_id: unknown }) => r.draft_id === d),
		{
			draft_id: d,
			version: 3,
			...mail,
			sha256: corrected.sha256,
			document_ids: [id(50)],
		},
	);
	assert.deepEqual(
		await post(path, {
			version: 3,
			sha256: corrected.sha256,
			status: "sent",
			sent_item_id: "example-sent-20",
			sent_at: "2026-01-01T12:00:00Z",
		}),
		[200, { draft_id: d, version: 3, status: "sent" }],
	);
});
