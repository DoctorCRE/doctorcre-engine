import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { isArguments } from "./save-door.ts";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, request } = doorTest();
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
			select id, '<'||id||'@example.test>', case when id in ('${id(10)}', '${id(11)}') then 'Thread' end,
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
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, what, owner_party_id, created_at)
			values ('${id(30)}', 'next_step', '${id(10)}', 'email', 'Please send the plan.', 'old_system', '${deal}', 'Send the plan', '${partner}', '2026-01-05'),
				('${id(31)}', 'next_step', '${id(11)}', 'email', 'Please send the plan.', 'old_system', '${deal}', 'Check the plan', '${partner}', '2026-01-03'),
				('${id(32)}', 'next_step', '${id(12)}', 'email', 'Please send the plan.', 'old_system', '${deal}', 'Check the drawing', null, '2026-01-04'),
				('${id(33)}', 'next_step', '${call}', 'call', 'Ask about the lease.', 'old_system', '${deal}', 'Check the lease', null, '2026-01-02'),
				('${id(34)}', 'next_step', '${call}', 'call', 'Send a budget.', 'old_system', '${deal}', 'Send a budget', '${partner}', '2026-01-03'),
				('${id(35)}', 'next_step', '${id(12)}', 'email', 'Please send details.', 'old_system', '${deal}', 'Send details', '${partner}', '2026-01-04'),
				('${id(36)}', 'next_step', '${meeting}', 'meeting', 'Please check the date.', 'old_system', '${deal}', 'Check the date', '${partner}', '2026-01-04'),
				('${id(37)}', 'next_step', '${unstampedCall}', 'call', 'Please check the floor plan.', 'old_system', '${deal}', 'Check the floor plan', null, '2026-01-04');
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

test("Home shows only its partner's open drafts and one per known conversation", async () => {
	const drafts = (await inbox()).filter(
		(card) => card.kind_label === "Reply draft",
	);
	assert.deepEqual(drafts.map((card) => card.reply_draft_id).sort(), [
		id(21),
		id(25),
		id(26),
	]);
	assert.partialDeepStrictEqual(
		drafts.find((card) => card.reply_draft_id === id(21)),
		{
			item_id: `email_proposal:${id(21)}`,
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
