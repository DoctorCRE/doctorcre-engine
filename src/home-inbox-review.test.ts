import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "./save-door.ts";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, request, save } = doorTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const partner = id(1);
const other = id(2);
const deal = id(3);
const call = id(4);
const meeting = id(5);
const unstampedCall = id(6);

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${partner}', 'person', 'Example Partner'), ('${other}', 'person', 'Other Partner');
		insert into app_user (id, slug) values ('${partner}', 'example'), ('${other}', 'other');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Dental', '${partner}');
		insert into activity (id, kind, happened_at)
			select id, 'email', '2026-01-01'::date + offset_days::int
			from unnest(array[${[10, 11, 12, 13, 14, 15, 16].map((n) => `'${id(n)}'`).join(",")}]::uuid[])
			with ordinality t(id, offset_days);
		insert into email (activity_id, message_id, conversation_id, sender, sender_name, subject, body)
			select id, '<'||id||'@example.test>', case when id in ('${id(10)}', '${id(11)}', '${id(14)}') then 'Thread' end,
				'pat@example.test',
				case when id = '${id(10)}' then 'Sam Example' when id <> '${id(12)}' then 'Pat Example' end,
				case when id = '${id(10)}' then 'Earlier floor plan' else 'Floor plan' end,
				'Please send the plan.'
			from activity;
		insert into email_mailbox (activity_id, user_id) values
			('${id(10)}', '${partner}'), ('${id(11)}', '${partner}'), ('${id(11)}', '${other}'), ('${id(12)}', '${partner}');
		insert into activity_about (activity_id, deal_id) values ('${id(11)}', '${deal}');
		insert into activity_about (activity_id, party_id)
			select id, '${partner}' from activity where id <> '${id(11)}';
		insert into reply_draft (id, email_activity_id, owner_user_id, proposed_by_job, subject, body, evidence)
			values ${[10, 11, 12, 13, 14, 15, 16]
				.map(
					(n) =>
						`('${id(n + 10)}', '${id(n)}', '${n === 12 ? other : partner}', 'old_system', 'Floor plan', 'Here it is.', 'Please send the plan.')`,
				)
				.join(",")};
		select set_config('engine.job', '', true), set_config('engine.user_id', '${partner}', true);
		insert into activity (id, kind, happened_at) values
			('${call}', 'call', '2026-01-02T12:00Z'), ('${meeting}', 'meeting', '2026-01-03T12:00Z');
		insert into activity_about (activity_id, deal_id) values ('${call}', '${deal}');
		update reply_draft set status = 'dismissed', dismiss_reason = 'I already replied' where id = '${id(23)}';
		update reply_draft set status = 'approved', to_address = 'pat@example.test', cc_address = 'copy@example.test'
			where id in ('${id(24)}', '${id(25)}', '${id(26)}');
		select set_config('engine.job', 'old_system', true);
		update reply_draft set status = 'sent', sent_at = now(), sent_item_id = 'example-sent' where id = '${id(24)}';
		update reply_draft set status = 'failed', failure_reason = 'aborted_before_dispatch' where id = '${id(26)}';
		select set_config('engine.user_id', '', true);
		insert into activity (id, kind, happened_at) values ('${unstampedCall}', 'call', '2026-01-02T12:00Z');
		insert into activity_about (activity_id, deal_id) values ('${unstampedCall}', '${deal}');
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, what, owner_party_id, created_at, due_on)
			values ('${id(30)}', 'next_step', '${id(10)}', 'email', 'Please send the plan.', 'old_system', '${deal}', 'Send the plan', '${partner}', '2026-01-05', '2026-01-09'),
				('${id(31)}', 'next_step', '${id(11)}', 'email', 'Please send the plan.', 'old_system', '${deal}', 'Check the plan', '${partner}', '2026-01-03', null),
				('${id(32)}', 'next_step', '${id(12)}', 'email', 'Please send the plan.', 'old_system', '${deal}', 'Check the drawing', null, '2026-01-04', null),
				('${id(33)}', 'next_step', '${call}', 'call', 'Ask about the lease.', 'old_system', '${deal}', 'Check the lease', null, '2026-01-02', null),
				('${id(34)}', 'next_step', '${call}', 'call', 'Send a budget.', 'old_system', '${deal}', 'Send a budget', '${partner}', '2026-01-03', null),
				('${id(35)}', 'next_step', '${id(12)}', 'email', 'Please send details.', 'old_system', '${deal}', 'Send details', '${partner}', '2026-01-04', null),
				('${id(36)}', 'next_step', '${meeting}', 'meeting', 'Please check the date.', 'old_system', '${deal}', 'Check the date', '${partner}', '2026-01-04', null),
				('${id(37)}', 'next_step', '${unstampedCall}', 'call', 'Please check the floor plan.', 'old_system', '${deal}', 'Check the floor plan', null, '2026-01-04', null);
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, created_at)
			values ('${id(38)}', 'file_to_deal', '${id(11)}', 'email', 'Please file this.', 'old_system', '${deal}', '2026-01-02');
		select set_config('engine.job', '', true), set_config('engine.user_id', '${partner}', true);
		update proposal set status = 'dismissed' where id = '${id(35)}';
		update proposal set status = 'accepted' where id = '${id(36)}';
		select set_config('engine.job', 'mail_capture', true);
		insert into candidate (id, source, source_key, source_row, name, qualification)
			values ('${id(40)}', 'outlook-intake', 'made-up-key', '{"address":"new@example.test"}', 'New Example', 'Asks about a lease');
		insert into proposal (id, kind, candidate_id, evidence, proposed_by_job)
			values ('${id(41)}', 'email_lead', '${id(40)}', 'Asks about a lease', 'mail_capture');
		commit;`);
});
after(async () => {
	await db.query("rollback");
	await cleanup();
});

async function inbox(user = "example") {
	const response = await request(
		{ user },
		"home/inbox",
		{ method: "GET" },
		{ HOME_INBOX_READ_SCHEMA: "next" },
	);
	assert.equal(response.status, 200);
	const result: unknown = await response.json();
	assert.ok(isArguments(result) && Array.isArray(result.items));
	return result.items.filter(isArguments);
}

test("Home shows only its partner's active drafts and one per known conversation", async () => {
	const drafts = (await inbox()).filter(
		(card) => card.kind_label === "Reply draft" && card.source_state !== "done",
	);
	assert.deepEqual(drafts.map((card) => card.reply_draft_id).sort(), [
		id(21),
		id(25),
		id(26),
	]);
	assert.partialDeepStrictEqual(
		drafts.find((card) => card.reply_draft_id === id(21)),
		{
			item_id: `reply_draft:${id(21)}`,
			source_version: "1",
			title: "Reply to Pat Example: Floor plan",
			open_url: `/deals?deal=${deal}`,
			section: "inbox",
			source_activity: { kind: "email", id: id(11), deal_id: deal },
		},
	);
	assert.equal(
		drafts.find((card) => card.reply_draft_id === id(25))?.section,
		"working",
	);
	assert.equal(
		drafts.find((card) => card.reply_draft_id === id(26))?.source_state,
		"failed",
	);
	assert.deepEqual(
		(await inbox("other"))
			.filter((card) => card.kind_label === "Reply draft")
			.map((card) => card.reply_draft_id),
		[id(22)],
	);
});

test("Home shows a sent draft once in Done at the recorded send time", async () => {
	const {
		rows: [draft],
	} = await db.query<{ sent_at: Date }>(
		"select sent_at from reply_draft where id = $1",
		[id(24)],
	);
	assert.ok(draft);
	const done = (await inbox()).filter((card) => card.source_state === "done");
	assert.partialDeepStrictEqual(done, [
		{
			item_id: `reply_draft:${id(24)}`,
			reply_draft_status: "sent",
			disposition: "settled",
			completed_at: draft.sent_at.toISOString(),
			auto_settled: true,
		},
	]);
});

for (const item_id of [`suggestion:${id(30)}`, `reply_draft:${id(21)}`]) {
	test(`Home snoozes and undoes ${item_id.split(":")[0]} through its card version`, async () => {
		const user = { user: "example" };
		const card = async () =>
			(await inbox()).find((item) => item.item_id === item_id);
		const original = await card();
		assert.ok(original);
		const until = new Date(Date.now() + 86_400_000).toISOString();
		const snooze = {
			idempotency_key: randomUUID(),
			item_id,
			base_version: original.base_version,
			action: "snooze",
			until,
		};
		const [foreign] = await save({ user: "other" }, "home/marks", snooze);
		assert.equal(foreign, 404);
		const [status, answer] = await save(user, "home/marks", snooze);
		assert.equal(status, 200);
		assert.partialDeepStrictEqual(answer, {
			item_id,
			previous: { disposition: null, snoozed_until: null },
		});
		assert.partialDeepStrictEqual(await card(), {
			section: "snoozed",
			snoozed_until: until,
			base_version: answer.base_version,
		});
		const [stale] = await save(user, "home/marks", {
			...snooze,
			idempotency_key: randomUUID(),
		});
		assert.equal(stale, 409);
		const [undone, receipt] = await save(user, "home/marks", {
			idempotency_key: randomUUID(),
			item_id,
			base_version: answer.base_version,
			action: "unsettle",
		});
		assert.equal(undone, 200);
		assert.partialDeepStrictEqual(await card(), {
			section: "inbox",
			snoozed_until: null,
			base_version: receipt.base_version,
		});
		assert.notEqual(receipt.base_version, original.base_version);
	});
}

test("A new suggestion keeps the conversation snoozed and a later decision clears its settlement", async () => {
	const user = { user: "mail-reviewer" };
	const reviewer = id(9);
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${reviewer}', 'person', 'Example Mail Reviewer');
		insert into app_user (id, slug) values ('${reviewer}', '${user.user}');
		select set_config('engine.user_id', '${reviewer}', true);
		insert into activity (id, kind, happened_at) values
			('${id(17)}', 'email', '2026-01-10'), ('${id(18)}', 'email', '2026-01-11');
		insert into email (activity_id, message_id, conversation_id, sender, subject, body) values
			('${id(17)}', '<first@example.test>', 'Reviewer thread', 'pat@example.test', 'Example suite', 'Here is the first plan.'),
			('${id(18)}', '<second@example.test>', 'Reviewer thread', 'pat@example.test', 'Example suite', 'Here is the newer plan.');
		insert into activity_about (activity_id, deal_id) values
			('${id(17)}', '${deal}'), ('${id(18)}', '${deal}');
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id)
			values ('${id(50)}', 'file_to_deal', '${id(17)}', 'email', 'Please file the plan.', 'old_system', '${deal}'),
				('${id(51)}', 'possible_new_deal', '${id(17)}', 'email', 'Another example suite.', 'old_system', null);
		commit;`);
	const card = async () => {
		const [item] = await inbox(user.user);
		assert.ok(item);
		return item;
	};
	const mark = async (
		action: string,
		saved?: Record<string, unknown>,
		until?: string,
	) => {
		const item = saved ?? (await card());
		return save(user, "home/marks", {
			idempotency_key: randomUUID(),
			item_id: item.item_id,
			base_version: item.base_version,
			action,
			...(until && { until }),
		});
	};
	const until = new Date(Date.now() + 86_400_000).toISOString();
	assert.equal((await mark("snooze", await card(), until))[0], 200);
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '${reviewer}', true);
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job)
			values ('${id(52)}', 'possible_new_deal', '${id(18)}', 'email', 'Review the newer suite.', 'old_system');
		commit;`);
	assert.partialDeepStrictEqual(await card(), {
		item_id: `suggestion:${id(52)}`,
		section: "snoozed",
		snoozed_until: until,
	});
	assert.equal((await mark("unsettle"))[0], 200);
	assert.equal((await card()).section, "inbox");
	const [settled, receipt] = await mark("settle");
	assert.equal(settled, 200);
	assert.equal((await card())?.section, "settled");
	const [decided] = await save(user, `proposals/${id(51)}/decision`, {
		idempotency_key: randomUUID(),
		decision: "dismiss",
	});
	assert.equal(decided, 200);
	assert.partialDeepStrictEqual(await card(), {
		section: "inbox",
		merged_source_ids: [id(52), id(50)],
	});
	const [undo] = await mark("unsettle", receipt);
	assert.equal(undo, 409);
});

test("Home groups pending suggestions from each email conversation or call and keeps their targets", async () => {
	const suggestions = (await inbox()).filter((card) =>
		Array.isArray(card.suggestions),
	);
	assert.deepEqual(
		suggestions.flatMap((card) => card.merged_source_ids).sort(),
		[30, 31, 32, 33, 34, 38].map(id),
	);
	assert.partialDeepStrictEqual(
		suggestions.find((card) => card.proposal_id === id(30)),
		{
			source_type: "email_proposal",
			open_url: `/deals?deal=${deal}`,
			merged_source_ids: [id(30), id(31), id(38)],
			source_activity: { kind: "email", id: id(10) },
		},
	);
	assert.partialDeepStrictEqual(
		suggestions.find((card) => card.proposal_id === id(34)),
		{
			source_type: "capture_session",
			title: "Call on Fri, Jan 2: 2 suggestions",
			merged_source_ids: [id(34), id(33)],
			open_url: `/calls?session=${call}`,
			source_activity: { kind: "call", id: call },
		},
	);
	assert.deepEqual(
		(await inbox("other"))
			.filter((card) => Array.isArray(card.suggestions))
			.map((card) => card.merged_source_ids),
		[[id(38)]],
	);
});

test("Home leaves pending unknown-sender suggestions in the candidate queue", async () => {
	assert.ok(!(await inbox()).some((card) => card.proposal_id === id(41)));
});

test("Home shows one pending call log with the proposal to decide", async () => {
	const user = { user: "call-reviewer" };
	const reviewer = id(7);
	const callId = id(8);
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${reviewer}', 'person', 'Example Reviewer');
		insert into app_user (id, slug) values ('${reviewer}', '${user.user}');
		select set_config('engine.job', '', true), set_config('engine.user_id', '${reviewer}', true);
		insert into activity (id, kind, happened_at) values ('${callId}', 'call', '2026-01-06T12:00Z');
		insert into activity_about (activity_id, deal_id) values ('${callId}', '${deal}');
		commit;`);
	const [stored, proposal] = await save(
		{ job: "mail_capture", for_user: user.user },
		"proposals",
		{
			idempotency_key: randomUUID(),
			kind: "log_call",
			activity_id: callId,
			deal_id: deal,
			what: "Agreed to review the example plan.",
			evidence: "Let's review the example plan.",
		},
	);
	assert.equal(stored, 201);
	const cards = await inbox(user.user);
	assert.partialDeepStrictEqual(cards, [
		{
			item_id: `suggestion:${proposal.proposal_id}`,
			title: "Call on Tue, Jan 6: 1 suggestion",
			proposal_id: proposal.proposal_id,
			suggestions: [
				{ id: proposal.proposal_id, kind: "log_call", deal_id: deal },
			],
		},
	]);
	const [dismissed] = await save(
		user,
		`proposals/${cards[0]?.proposal_id}/decision`,
		{
			idempotency_key: randomUUID(),
			decision: "dismiss",
		},
	);
	assert.equal(dismissed, 200);
});

test("An email suggestion names its sender and subject", async () => {
	const filing = (await inbox("other")).find(
		(card) => card.proposal_id === id(38),
	);
	assert.equal(filing?.title, "Pat Example · Floor plan");
	const step = (await inbox()).find((card) => card.proposal_id === id(32));
	assert.equal(step?.title, "pat@example.test · Floor plan");
});

test("A grouped suggestion card uses the latest source email, even when an older email has the newest suggestion", async () => {
	const group = (await inbox()).find((card) => card.proposal_id === id(30));
	assert.equal(group?.title, "Pat Example · Floor plan");
});

test("Home opens each visible suggestion with its original evidence and proposed fields", async () => {
	const read = (n: number, user = "example") =>
		request({ user }, `proposals/${id(n)}`, { method: "GET" });
	const email = await read(30);
	assert.equal(email.status, 200);
	assert.partialDeepStrictEqual(await email.json(), {
		proposal_id: id(30),
		kind: "next_step",
		what: "Send the plan",
		deal_id: deal,
		target_name: "Example Dental",
		owner_party_id: partner,
		evidence: "Please send the plan.",
		source_activity: {
			id: id(10),
			kind: "email",
			subject: "Earlier floor plan",
			sender: "pat@example.test",
			sender_name: "Sam Example",
			body: "Please send the plan.",
		},
	});
	const citedCall = await read(33);
	assert.equal(citedCall.status, 200);
	assert.partialDeepStrictEqual(await citedCall.json(), {
		kind: "next_step",
		what: "Check the lease",
		evidence: "Ask about the lease.",
		source_activity: {
			id: call,
			kind: "call",
			happened_at: "2026-01-02T12:00:00.000Z",
		},
	});
	assert.equal((await read(38, "other")).status, 200);
	assert.equal((await read(30, "other")).status, 404);
	assert.equal((await read(33, "other")).status, 404);
	assert.equal((await read(35)).status, 404);
	assert.equal((await read(41)).status, 404);
});

test("Mail priorities ranks inbound work once per Outlook conversation and opens the same Home card", async () => {
	const user = { user: "example" };
	const url = "home/mail-priorities";
	const get = (viewer = user, enabled = true) =>
		request(
			viewer,
			url,
			{ method: "GET" },
			enabled ? { HOME_INBOX_READ_SCHEMA: "next" } : {},
		);
	assert.equal((await get(user, false)).status, 404);

	const response = await get();
	assert.equal(response.status, 200);
	const page: unknown = await response.json();
	assert.ok(isArguments(page) && Array.isArray(page.items));
	const priorities = page.items.filter(isArguments);
	const thread = priorities.filter((row) => row.conversation_id === "Thread");
	const cards = await inbox();
	const matchingCard = cards.find(
		(card) => card.item_id === `suggestion:${id(30)}`,
	);
	assert.ok(matchingCard);
	assert.equal(thread.length, 1);
	assert.partialDeepStrictEqual(thread, [
		{
			item_id: matchingCard.item_id,
			base_version: matchingCard.base_version,
			title: matchingCard.title,
			sender: "Pat Example",
			subject: "Floor plan",
			kind: "next_step",
			suggestion: "Send the plan",
			proposal_id: id(30),
			reply_draft_id: null,
			due_on: "2026-01-09",
			source_activity: {
				kind: "email",
				id: id(10),
				happened_at: "2026-01-02T00:00:00.000Z",
			},
		},
	]);
	assert.equal(priorities[0]?.item_id, matchingCard.item_id);
	const other: unknown = await (await get({ user: "other" })).json();
	assert.ok(isArguments(other) && Array.isArray(other.items));
	assert.partialDeepStrictEqual(
		other.items
			.filter(isArguments)
			.filter((row) => row.conversation_id === "Thread"),
		[{ item_id: `suggestion:${id(38)}`, proposal_id: id(38) }],
	);
});

test("Mail priorities keeps two emails without conversation IDs in separate groups", async () => {
	const user = { user: "unkeyed-reviewer" };
	const reviewer = id(53);
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${reviewer}', 'person', 'Example Reviewer');
		insert into app_user (id, slug) values ('${reviewer}', '${user.user}');
		select set_config('engine.user_id', '${reviewer}', true);
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job)
			values ('${id(54)}', 'possible_new_deal', '${id(12)}', 'email', 'Review the first suite.', 'old_system'),
				('${id(55)}', 'possible_new_deal', '${id(15)}', 'email', 'Review the other suite.', 'old_system');
		commit;`);
	const response = await request(
		user,
		"home/mail-priorities",
		{ method: "GET" },
		{ HOME_INBOX_READ_SCHEMA: "next" },
	);
	assert.equal(response.status, 200);
	assert.partialDeepStrictEqual(await response.json(), {
		items: [
			{ conversation_id: null, source_activity: { id: id(12) } },
			{ conversation_id: null, source_activity: { id: id(15) } },
		],
	});
});

test("Mail priorities caps inbound groups at 25 and skips snoozed cards and partner-sent mail", async () => {
	const user = { user: "priority-reviewer" };
	const reviewer = id(56);
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${reviewer}', 'person', 'Example Priority Reviewer');
		insert into app_user (id, slug) values ('${reviewer}', '${user.user}');
		insert into party_email (party_id, address, label) values ('${reviewer}', 'reviewer@example.test', 'work');
		select set_config('engine.user_id', '${reviewer}', true);
		insert into activity (id, kind, happened_at)
			select md5('priority-email' || n)::uuid, 'email', '2026-03-01'::date + n
			from generate_series(0, 26) n;
		insert into email (activity_id, message_id, conversation_id, sender, subject, body)
			select md5('priority-email' || n)::uuid, '<priority-' || n || '@example.test>', 'Group ' || n,
				case when n = 0 then 'reviewer@example.test' else 'pat@example.test' end,
				'Example plan', 'Please check the plan.'
			from generate_series(0, 26) n;
		insert into activity_about (activity_id, deal_id)
			select md5('priority-email' || n)::uuid, '${deal}' from generate_series(0, 26) n;
		insert into proposal (kind, activity_id, activity_kind, evidence, proposed_by_job)
			select 'possible_new_deal', md5('priority-email' || n)::uuid, 'email', 'Please check the plan.', 'old_system'
			from generate_series(0, 26) n;
		commit;`);
	const priorities = async (start: number, more: boolean) => {
		const response = await request(
			user,
			"home/mail-priorities",
			{ method: "GET" },
			{ HOME_INBOX_READ_SCHEMA: "next" },
		);
		assert.equal(response.status, 200);
		const page: unknown = await response.json();
		assert.ok(isArguments(page) && Array.isArray(page.items));
		const rows = page.items.filter(isArguments);
		assert.equal(page.more, more);
		assert.deepEqual(
			rows.map((row) => row.conversation_id),
			Array.from({ length: 25 }, (_, i) => `Group ${start + i}`),
		);
		return rows;
	};
	const [first] = await priorities(1, true);
	assert.ok(first);
	const [status] = await save(user, "home/marks", {
		idempotency_key: randomUUID(),
		item_id: first.item_id,
		base_version: first.base_version,
		action: "snooze",
		until: new Date(Date.now() + 86_400_000).toISOString(),
	});
	assert.equal(status, 200);
	await priorities(2, false);
});
