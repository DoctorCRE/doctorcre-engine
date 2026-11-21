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
const suggestedDeal = id(69);
const call = id(4);
const meeting = id(5);
const unstampedCall = id(6);
const evidenceReviewer = id(66);
const filingWithPhone = id(67);
const tourReply = id(68);
const knownContact = randomUUID();
const quotedRequest = `Hello,
Could you please also let me know whether the west suite is still available for a tour later this month?
Please send the plan.
November 8 works for the tour.

Thanks,
Known Contact
555-010-1234
From: Example Partner
Sent: 2026-01-02T19:00:00Z
Could you call?`;

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into how_found (slug, label) values ('inbound', 'Inbound');
		insert into phase (slug, label) values ('negotiation', 'Negotiating');
		insert into role (slug, label) values ('lead', 'Lead');
		insert into stage (role, slug, label) values ('lead', 'new', 'New'), ('lead', 'qualified', 'Qualified');
		insert into party (id, kind, name) values
			('${partner}', 'person', 'Example Partner'), ('${other}', 'person', 'Other Partner');
		insert into app_user (id, slug) values ('${partner}', 'example'), ('${other}', 'other');
		insert into party (id, kind, name) values ('${knownContact}', 'person', 'Known Contact');
		insert into party_email (party_id, address, label) values ('${knownContact}', 'known-cc@example.test', 'work'),
			('${knownContact}', 'pat@example.test', 'work'),
			('${knownContact}', 'shared@example.test', 'work'), ('${other}', 'shared@example.test', 'work');
		insert into deal (id, name, owner_user_id) values
			('${deal}', 'Example Dental', '${partner}'), ('${suggestedDeal}', 'Example Orthodontics', '${partner}');
		insert into activity (id, kind, happened_at)
			select id, 'email', '2026-01-01'::date + offset_days::int
			from unnest(array[${[10, 11, 12, 13, 14, 15, 16, 19].map((n) => `'${id(n)}'`).join(",")}]::uuid[])
			with ordinality t(id, offset_days);
		insert into email (activity_id, message_id, conversation_id, sender, sender_name, subject, body)
			select id, '<'||id||'@example.test>', case when id in ('${id(10)}', '${id(11)}', '${id(14)}') then 'Thread' end,
				case when id = '${id(16)}' then 'shared@example.test' else 'pat@example.test' end,
				case when id = '${id(10)}' then 'Sam Example' when id not in ('${id(12)}', '${id(16)}') then 'Pat Example' end,
				case when id = '${id(10)}' then 'Earlier floor plan' else 'Floor plan' end,
				case when id = '${id(12)}' then '${quotedRequest}' else 'Please send the plan.' end
			from activity;
		insert into email_summary (activity_id, source_activity_id, source_hash, generator_version, status, text, provenance, recorded_at)
			select id, id, 'sha256:' || repeat('a', 64), 'example.v1', 'available', summary, '{}', '2026-01-06'
			from (values ('${id(10)}'::uuid, 'Sam Example requested the **floor plan** (C-123) before the tour.'),
				('${id(11)}'::uuid, 'Pat Example asked for tour times at Cedar Suite.')) summaries(id, summary);
		insert into email_summary (activity_id, source_activity_id, source_hash, generator_version, status, provenance, recorded_at)
			values ('${id(12)}', '${id(12)}', 'sha256:' || repeat('a', 64), 'example.v1', 'unavailable', '{}', '2026-01-06');
		insert into email_mailbox (activity_id, user_id) values
			('${id(10)}', '${partner}'), ('${id(11)}', '${partner}'), ('${id(11)}', '${other}'),
			('${id(12)}', '${partner}'), ('${id(12)}', '${other}'), ('${id(14)}', '${other}');
		insert into activity_about (activity_id, deal_id) values ('${id(11)}', '${deal}');
		insert into activity_about (activity_id, party_id)
			select id, '${partner}' from activity where id <> '${id(11)}';
		insert into activity_about (activity_id, party_id) values ('${id(16)}', '${knownContact}');
		insert into reply_draft (id, email_activity_id, owner_user_id, proposed_by_job, subject, body, evidence)
			values ${[10, 11, 12, 13, 14, 15, 16]
				.map(
					(n) =>
						`('${id(n + 10)}', '${id(n === 14 ? 19 : n)}', '${n === 12 ? other : partner}', 'old_system', 'Re: Email from Pat Example: Re: Floor plan', 'Here it is.', '${n === 12 ? quotedRequest : "Please send the plan."}')`,
				)
				.join(",")};
		select set_config('engine.job', '', true), set_config('engine.user_id', '${partner}', true);
		insert into activity (id, kind, happened_at, from_party_id) values
			('${call}', 'call', '2026-01-03T02:00Z', '${knownContact}'), ('${meeting}', 'meeting', '2026-01-03T12:00Z', null);
		insert into activity_about (activity_id, deal_id) values ('${call}', '${deal}');
		update reply_draft set status = 'dismissed', dismiss_reason = 'I already replied' where id = '${id(23)}';
		update reply_draft set status = 'approved', to_address = 'pat@example.test', cc_address = 'copy@example.test'
			where id in ('${id(24)}', '${id(25)}', '${id(26)}');
		select set_config('engine.job', 'old_system', true);
		update reply_draft set status = 'sent', sent_at = now(), sent_item_id = 'example-sent' where id = '${id(24)}';
		update reply_draft set status = 'failed', failure_reason = 'attachment_missing' where id = '${id(26)}';
		select set_config('engine.user_id', '', true);
		insert into activity (id, kind, happened_at) values ('${unstampedCall}', 'call', '2026-01-02T12:00Z');
		insert into activity_about (activity_id, deal_id) values ('${unstampedCall}', '${deal}');
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, what, owner_party_id, created_at, due_on)
			values ('${id(30)}', 'next_step', '${id(10)}', 'email', 'Please send the plan.', 'old_system', '${deal}', 'Send the plan', '${partner}', '2026-01-05', '2026-01-09'),
				('${id(31)}', 'next_step', '${id(11)}', 'email', 'Please send the plan.', 'old_system', '${deal}', 'Check the plan', '${partner}', '2026-01-03', null),
				('${id(32)}', 'next_step', '${id(12)}', 'email', 'Review is needed.', 'old_system', '${deal}', 'Check the drawing', null, '2026-01-04', null),
				('${id(33)}', 'next_step', '${call}', 'call', 'Ask about the lease.', 'old_system', '${deal}', 'Check the lease', null, '2026-01-02', null),
				('${id(34)}', 'next_step', '${call}', 'call', 'Send a budget.', 'old_system', '${deal}', 'Send a budget', '${partner}', '2026-01-03', null),
				('${id(35)}', 'next_step', '${id(12)}', 'email', 'Please send details.', 'old_system', '${deal}', 'Send details', '${partner}', '2026-01-04', null),
				('${id(36)}', 'next_step', '${meeting}', 'meeting', 'Please check the date.', 'old_system', '${deal}', 'Check the date', '${partner}', '2026-01-04', null),
				('${id(37)}', 'next_step', '${unstampedCall}', 'call', 'Please check the floor plan.', 'old_system', '${deal}', 'Check the floor plan', null, '2026-01-04', null);
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, created_at)
			values ('${id(38)}', 'file_to_deal', '${id(11)}', 'email', 'Please file this.', 'old_system', '${suggestedDeal}', '2026-01-02');
		select set_config('engine.job', '', true), set_config('engine.user_id', '${partner}', true);
		update proposal set status = 'dismissed' where id = '${id(35)}';
		update proposal set status = 'accepted' where id = '${id(36)}';
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${evidenceReviewer}', 'person', 'Example Reviewer');
		insert into app_user (id, slug) values ('${evidenceReviewer}', 'evidence-reviewer');
		insert into email_mailbox (activity_id, user_id) values ('${id(12)}', '${evidenceReviewer}');
		select set_config('engine.user_id', '${evidenceReviewer}', true);
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id)
			values ('${filingWithPhone}', 'file_to_deal', '${id(13)}', 'email', 'Please call (202) 555-0142.', 'old_system', '${deal}');
		insert into reply_draft (id, email_activity_id, owner_user_id, proposed_by_job, subject, body, evidence)
			values ('${tourReply}', '${id(12)}', '${evidenceReviewer}', 'old_system', 'Tour', 'See you then.', 'November 8 works for the tour.');
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
	assert.equal(Object.hasOwn(result, "auto_settle_enabled"), false);
	const items = result.items.filter(isArguments);
	for (const item of items) {
		assert.ok(typeof item.title === "string" && item.title.length <= 90);
		assert.doesNotMatch(
			item.title,
			/…|\.\.\.|^email from|\breview(?: follow-up| call note)?:/i,
		);
		assert.equal(Object.hasOwn(item, "auto_settled"), false);
		assert.equal(Object.hasOwn(item, "explicit_unsettle"), false);
	}
	return items;
}

async function dashboard(user = "example") {
	const response = await request(
		{ user },
		"home/inbox?view=dashboard",
		{ method: "GET" },
		{ HOME_INBOX_READ_SCHEMA: "next" },
	);
	assert.equal(response.status, 200);
	const result: unknown = await response.json();
	assert.ok(
		isArguments(result) &&
			isArguments(result.reminders) &&
			isArguments(result.waiting),
	);
	const items = (group: Record<string, unknown>) => {
		assert.ok(Array.isArray(group.items));
		assert.equal(group.count, group.items.length);
		return group.items.filter(isArguments);
	};
	return { reminders: items(result.reminders), waiting: items(result.waiting) };
}

test("dashboard sends approved drafts to waiting, failed deliveries to reminders, and sent drafts to history", async () => {
	const { reminders, waiting } = await dashboard();
	assert.partialDeepStrictEqual(
		waiting.find((card) => card.reply_draft_id === id(25)),
		{
			waiting_reason: "Waiting for Outlook to confirm delivery",
			primary_action: null,
		},
	);
	assert.equal(
		reminders.find((card) => card.reply_draft_id === id(26))?.primary_action,
		"Review delivery",
	);
	assert.ok(
		[...reminders, ...waiting].every(
			(card) => card.reply_draft_id !== id(24) && !("thread" in card),
		),
	);
});

test("dashboard keeps an overdue decision's late label when a reply draft leads", async () => {
	const { reminders } = await dashboard();
	const card = reminders.find((card) => card.reply_draft_id === id(21));
	assert.equal(card?.due_on, "2026-01-09");
	assert.ok(typeof card.days_late === "number" && card.days_late >= 1);
	assert.equal(
		card.late_label,
		`${card.days_late} ${card.days_late === 1 ? "day" : "days"} late`,
	);
});

test("dashboard keeps one conversation card while delivery is unconfirmed", async () => {
	const proposer = id(69);
	const user = "waiting-reviewer";
	const draft = id(70);
	const suggestion = id(71);
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${proposer}', 'person', 'Example Waiting Reviewer');
		insert into app_user (id, slug) values ('${proposer}', '${user}');
		insert into email_mailbox (activity_id, user_id) values ('${id(11)}', '${proposer}');
		insert into reply_draft (id, email_activity_id, owner_user_id, proposed_by_job, subject, body, evidence)
			values ('${draft}', '${id(11)}', '${proposer}', 'old_system', 'Floor plan', 'Here it is.', 'Please send the plan.');
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, what, owner_party_id)
			values ('${suggestion}', 'next_step', '${id(11)}', 'email', 'Please send the plan.', 'old_system',
				'${deal}', 'Send the plan', '${proposer}');
		commit;`);
	const before = await dashboard(user);
	const pending = before.reminders.find(
		(card) => card.reply_draft_id === draft,
	);
	assert.ok(typeof pending?.card_id === "string");
	await db.query(`begin;
		select set_config('engine.user_id', '${proposer}', true);
		update reply_draft set status = 'approved', to_address = 'pat@example.test',
			cc_address = 'copy@example.test' where id = '${draft}';
		select set_config('engine.job', 'old_system', true);
		update reply_draft set status = 'failed', failure_reason = 'unconfirmed_after_3' where id = '${draft}';
		commit;`);
	const { reminders, waiting } = await dashboard(user);
	assert.deepEqual(reminders, []);
	assert.equal(waiting.length, 1);
	assert.partialDeepStrictEqual(waiting[0], {
		card_id: pending.card_id,
		proposal_id: suggestion,
		suggestions: [{ id: suggestion }],
		waiting_reason: "Waiting for Outlook to confirm delivery",
		primary_action: null,
		fallback_reply_draft: { id: draft, failure_reason: "unconfirmed_after_3" },
	});
});

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
			title: "Review the reply to Pat Example about Example Dental",
			why: "Pat Example asked for tour times at Cedar Suite.",
			primary_action: "Review reply",
			open_url: `/deals?deal=${deal}`,
			section: "inbox",
			source_activity: {
				kind: "email",
				id: id(11),
				deal_id: deal,
				happened_at: "2026-01-03T00:00:00.000Z",
			},
		},
	);
	assert.partialDeepStrictEqual(
		drafts.find((card) => card.reply_draft_id === id(25)),
		{
			section: "working",
			primary_action: null,
		},
	);
	assert.deepEqual(
		(await inbox("other"))
			.filter((card) => card.kind_label === "Reply draft")
			.map((card) => card.reply_draft_id),
		[id(22)],
	);
});

test("Home explains a failed reply without changing its recorded delivery code", async () => {
	assert.partialDeepStrictEqual(
		(await inbox()).find((card) => card.reply_draft_id === id(26)),
		{
			source_state: "failed",
			title: "Review reply delivery to shared@example.test",
			why: "An attachment could not be found.",
			primary_action: "Review delivery",
			failure_reason: "attachment_missing",
		},
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
			primary_action: null,
			disposition: "inbox",
			section: "done",
			completed_at: draft.sent_at.toISOString(),
		},
	]);
});

for (const item_id of [`suggestion:${id(32)}`, `reply_draft:${id(21)}`]) {
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
		const { waiting } = await dashboard();
		assert.partialDeepStrictEqual(
			waiting.find((entry) => entry.item_id === item_id),
			{
				waiting_reason: "Snoozed",
				returns_at: until,
				base_version: answer.base_version,
				primary_action: null,
			},
		);
		const [stale] = await save(user, "home/marks", {
			...snooze,
			idempotency_key: randomUUID(),
		});
		assert.equal(stale, 409);
		if (item_id === `reply_draft:${id(21)}`) {
			assert.partialDeepStrictEqual(await card(), {
				section: "snoozed",
				suggestions: [{ id: id(30) }, { id: id(31) }, { id: id(38) }],
			});
			assert.ok(
				!(await inbox()).some(
					(item) => item.item_id === `suggestion:${id(30)}`,
				),
			);
			const priorities = await request(
				user,
				"home/mail-priorities",
				{ method: "GET" },
				{ HOME_INBOX_READ_SCHEMA: "next" },
			);
			assert.equal(priorities.status, 200);
			const page: unknown = await priorities.json();
			assert.ok(isArguments(page) && Array.isArray(page.items));
			assert.ok(
				!page.items
					.filter(isArguments)
					.some((row) => row.conversation_id === "Thread"),
			);
		}
		const [undone, receipt] = await save(user, "home/marks", {
			idempotency_key: randomUUID(),
			item_id,
			base_version: answer.base_version,
			action: "unsnooze",
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

test("A new suggestion keeps the conversation snoozed and unsnooze returns it to the inbox", async () => {
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
			values ('${id(50)}', 'file_to_deal', '${id(17)}', 'email', 'Please file the plan.', 'old_system', '${suggestedDeal}'),
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
	const [unsnoozed, receipt] = await mark("unsnooze");
	assert.equal(unsnoozed, 200);
	assert.equal((await card()).section, "inbox");
	const [decided] = await save(user, `proposals/${id(50)}/decision`, {
		idempotency_key: randomUUID(),
		decision: "dismiss",
	});
	assert.equal(decided, 200);
	assert.partialDeepStrictEqual(await card(), {
		section: "inbox",
		merged_source_ids: [id(52)],
	});
	const [stale] = await mark("snooze", receipt, until);
	assert.equal(stale, 409);
});

test("Home groups pending suggestions from each email conversation or call and keeps their targets", async () => {
	const suggestions = (await inbox()).filter((card) =>
		Array.isArray(card.suggestions),
	);
	assert.deepEqual(
		suggestions.flatMap((card) => card.merged_source_ids).sort(),
		[21, 30, 31, 32, 33, 34, 38].map(id),
	);
	assert.partialDeepStrictEqual(
		suggestions.find((card) => card.reply_draft_id === id(21)),
		{
			source_type: "email_proposal",
			open_url: `/deals?deal=${deal}`,
			merged_source_ids: [id(21), id(30), id(31), id(38)],
			suggestions: [{ id: id(30) }, { id: id(31) }, { id: id(38) }],
			source_activity: { kind: "email", id: id(11) },
		},
	);
	assert.partialDeepStrictEqual(
		suggestions.find((card) => card.proposal_id === id(34)),
		{
			source_type: "capture_session",
			kind_label: "Call",
			title: "Review the proposed follow-up for Example Dental",
			why: "Call with Known Contact on Jan 2, 2026. Send a budget. 2 decisions to review.",
			primary_action: "Review suggestions",
			merged_source_ids: [id(34), id(33)],
			open_url: `/calls?session=${call}`,
			source_activity: { kind: "call", id: call },
		},
	);
	assert.deepEqual(
		(await inbox("other"))
			.filter((card) => Array.isArray(card.suggestions))
			.map((card) => card.merged_source_ids),
		[[id(22), id(32)], [id(38)]],
	);
});

test("Home names the deal and proposed phase even when the meeting proposal has no action text", async () => {
	const proposal = randomUUID();
	await db.query(`begin; select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '${other}', true);
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, to_phase)
			values ('${proposal}', 'phase_move', '${meeting}', 'meeting', 'We received the LOI.', 'old_system', '${deal}', 'negotiation');
		commit;`);
	assert.partialDeepStrictEqual(
		(await inbox("other")).find((card) => card.proposal_id === proposal),
		{
			title: "Review moving Example Dental to Negotiating",
			why: "Meeting on Jan 3, 2026. We received the LOI. Proposed: Move Example Dental to Negotiating.",
			primary_action: "Review suggestions",
			open_url: `/deals?deal=${deal}`,
			source_activity: {
				kind: "meeting",
				id: meeting,
				happened_at: "2026-01-03T12:00:00.000Z",
			},
		},
	);
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		delete from proposal where id = '${proposal}'; commit;`);
});

for (const decision of ["accept", "dismiss"]) {
	test(`The mailbox partner can ${decision} a new sender's suggestion from Home`, async () => {
		const user = { user: "example" };
		const job = { job: "mail_capture", for_user: user.user };
		const address = `new-${decision}@example.test`;
		const quote =
			decision === "accept" ? "I am looking to lease a suite." : null;
		const [stored, proposal] = await save(job, "proposals/email-lead", {
			idempotency_key: randomUUID(),
			address,
			display_name: "New Example",
			summary: "Asked about leasing a suite.",
			first_seen_at: "2026-01-08T12:00:00Z",
			message_ref: `example-mail-${decision}`,
			applies_to: "new_matter",
			confidence: 0.9,
			...(quote && { evidence_quote: quote }),
		});
		assert.equal(stored, 201);
		const proposalId = proposal.proposal_id;
		assert.equal(typeof proposalId, "string");
		const path = `proposals/${proposalId}`;
		const findCards = async (viewer = user.user) =>
			(await inbox(viewer)).filter((card) => card.proposal_id === proposalId);
		assert.partialDeepStrictEqual(await findCards(), [
			{
				item_id: `suggestion:${proposalId}`,
				title: "Review adding New Example as a lead",
				source_type: "email_proposal",
				section: "inbox",
				source_activity: null,
				open_url: null,
				suggestions: [
					{ id: proposalId, kind: "email_lead", activity_id: null },
				],
			},
		]);
		assert.deepEqual(await findCards("other"), []);
		const detail = await request(user, path, { method: "GET" });
		assert.equal(detail.status, 200);
		assert.partialDeepStrictEqual(await detail.json(), {
			proposal_id: proposalId,
			kind: "email_lead",
			target_name: "New Example",
			evidence: "Asked about leasing a suite.",
			evidence_quote: quote,
			applies_to: "new_matter",
			source_activity: {
				kind: "email",
				id: null,
				happened_at: "2026-01-08T12:00:00Z",
				sender: address,
				sender_name: "New Example",
				subject: null,
				body: null,
			},
		});
		assert.equal(
			(await request({ user: "other" }, path, { method: "GET" })).status,
			404,
		);
		const decide = (caller: typeof user | typeof job) =>
			save(caller, `${path}/decision`, {
				idempotency_key: randomUUID(),
				decision,
				...(decision === "dismiss" && { reason: "Outside our market" }),
			});
		assert.equal((await decide(job))[0], 403);
		assert.equal((await decide({ user: "other" }))[0], 404);
		const [decided, receipt] = await decide(user);
		assert.equal(decided, 200);
		assert.equal(
			receipt.status,
			decision === "accept" ? "accepted" : "dismissed",
		);
		if (decision === "accept") {
			const role = await db.query(
				`select role.stage, role.owner_user_id from party_role role
				join party_email email on email.party_id = role.party_id
				where role.role = 'lead' and email.address = $1`,
				[address],
			);
			assert.deepEqual(role.rows, [{ stage: "new", owner_user_id: partner }]);
		}
		assert.deepEqual(await findCards(), []);
		assert.equal((await request(user, path, { method: "GET" })).status, 404);
	});
}

test("Home stops offering a lead when its sender is verified as a partner", async () => {
	const address = "example-partner-address@example.test";
	const [status, proposal] = await save(
		{ job: "mail_capture", for_user: "example" },
		"proposals/email-lead",
		{
			idempotency_key: randomUUID(),
			address,
			display_name: "Example Sender",
			summary: "Asked about leasing a suite.",
			first_seen_at: "2026-01-08T12:00:00Z",
			message_ref: "example-mail-partner",
			applies_to: "new_matter",
			confidence: 0.9,
		},
	);
	assert.equal(status, 201);
	const card = async () =>
		(await inbox()).find((row) => row.proposal_id === proposal.proposal_id);
	assert.ok(await card());

	const account = randomUUID();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${account}', 'person', 'Example Account Partner');
		insert into app_user (id, slug) values ('${account}', 'joe');
		insert into party_email (party_id, address, label) values ('${account}', '${address}', 'personal');
		commit;`);
	assert.equal(await card(), undefined);
});

test("Home keeps a possible lead when a partner shares the sender address with an outside party", async () => {
	const address = "shared-address@example.test";
	const [status, proposal] = await save(
		{ job: "mail_capture", for_user: "example" },
		"proposals/email-lead",
		{
			idempotency_key: randomUUID(),
			address,
			display_name: "Example Sender",
			summary: "Asked about leasing a suite.",
			first_seen_at: "2026-01-08T12:00:00Z",
			message_ref: "example-mail-shared-address",
			applies_to: "new_matter",
			confidence: 0.9,
		},
	);
	assert.equal(status, 201);

	const account = randomUUID();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${account}', 'person', 'Another Example Account Partner');
		insert into app_user (id, slug) values ('${account}', 'dell');
		insert into party_email (party_id, address, label) values
			('${account}', '${address}', 'personal'), ('${knownContact}', '${address}', 'work');
		commit;`);
	assert.ok(
		(await inbox()).some((row) => row.proposal_id === proposal.proposal_id),
	);
});

for (const match of [
	"message_id",
	"conversation_id",
	"other_mailbox",
	"mismatch",
]) {
	test(`Home groups a new sender's filing and lead suggestions by verified mail identity (${match})`, async () => {
		const user = { user: "example" };
		const job = { job: "mail_capture", for_user: user.user };
		const otherMailbox = { ...job, for_user: "other" };
		const sender = `${match}@example.test`.replaceAll("_", "-");
		const messageId = `Exact-${sender}`;
		const conversationId = `Outlook-${match}`;
		const happenedAt = "2026-01-08T12:00:00Z";
		const [proposed, lead] = await save(job, "proposals/email-lead", {
			idempotency_key: randomUUID(),
			address: sender,
			display_name: "New Sender",
			summary: "Asked about leasing a suite.",
			first_seen_at: happenedAt,
			message_ref: `local-${match}`,
			applies_to: "new_matter",
			confidence: 0.9,
			...(match === "conversation_id"
				? { conversation_id: conversationId }
				: {
						message_id:
							match === "mismatch" ? messageId.toLowerCase() : messageId,
					}),
		});
		assert.equal(proposed, 201);
		const byConversation = match === "conversation_id";
		const mail = {
			kind: "email",
			happened_at: byConversation ? "2026-01-10T12:00:00Z" : happenedAt,
			email: {
				message_id: messageId,
				...(match === "conversation_id" && { conversation_id: conversationId }),
				sender: byConversation ? "newer-reply@example.test" : sender,
				sender_name: byConversation ? "Newer Reply" : "New Sender",
				recipients: [{ address: "known-cc@example.test", kind: "cc" }],
				subject: "Floor plan",
				body: "Text from the filed email.",
			},
		};
		const [stored, email] = await save(otherMailbox, "activities", {
			...mail,
			idempotency_key: randomUUID(),
		});
		assert.equal(stored, 201);
		if (match !== "other_mailbox")
			assert.equal(
				(
					await save(job, "activities", {
						...mail,
						idempotency_key: randomUUID(),
					})
				)[0],
				201,
			);
		if (byConversation)
			await db.query(`begin; select set_config('engine.job', 'old_system', true);
				insert into email_summary (activity_id, source_activity_id, source_hash, generator_version, status, text, provenance, recorded_at)
					values ('${email.activity_id}', '${email.activity_id}', 'sha256:' || repeat('b', 64), 'example.v1', 'available',
						'Newer Reply confirmed the floor plan.', '{}', '2026-01-10');
				commit;`);
		const [suggested, filing] = await save(otherMailbox, "proposals", {
			idempotency_key: randomUUID(),
			kind: "file_to_deal",
			activity_id: email.activity_id,
			evidence: "The floor plan belongs to this deal.",
			deal_id: deal,
		});
		assert.equal(suggested, 201);
		const relevantCards = async (viewer = user.user) =>
			(await inbox(viewer)).filter(
				(card) =>
					Array.isArray(card.merged_source_ids) &&
					card.merged_source_ids.some(
						(id) => id === lead.proposal_id || id === filing.proposal_id,
					),
			);
		assert.partialDeepStrictEqual(await relevantCards("other"), [
			{ suggestions: [{ id: filing.proposal_id, kind: "file_to_deal" }] },
		]);
		const cards = await relevantCards();
		const dashboardCards = await dashboard();
		assert.ok(
			[...dashboardCards.reminders, ...dashboardCards.waiting].every(
				(card) =>
					Array.isArray(card.merged_source_ids) &&
					card.merged_source_ids.every((member) => member !== lead.proposal_id),
			),
		);
		if (match === "other_mailbox" || match === "mismatch") {
			const standalone = cards.find(
				(card) => card.proposal_id === lead.proposal_id,
			);
			assert.equal(cards.length, match === "other_mailbox" ? 1 : 2);
			assert.partialDeepStrictEqual(standalone, {
				title: "Review adding New Sender as a lead",
				source_activity: null,
				suggestions: [
					{ id: lead.proposal_id, kind: "email_lead", activity_id: null },
				],
			});
			for (const [caller, proposal] of [
				[user, lead],
				[{ user: "other" }, filing],
			] as const) {
				assert.equal(
					(
						await save(caller, `proposals/${proposal.proposal_id}/decision`, {
							idempotency_key: randomUUID(),
							decision: "dismiss",
							reason: "Outside our market.",
						})
					)[0],
					200,
				);
			}
			return;
		}

		assert.equal(
			cards.length,
			1,
			"the filing and possible lead share one Home card",
		);
		assert.partialDeepStrictEqual(cards[0], {
			proposal_id: filing.proposal_id,
			primary_action: "Choose deal",
			source_activity: { id: email.activity_id, kind: "email" },
			suggestions: [
				{
					id: filing.proposal_id,
					kind: "file_to_deal",
					activity_id: email.activity_id,
				},
				{ id: lead.proposal_id, kind: "email_lead", activity_id: null },
			],
		});
		const details = await request(user, `proposals/${lead.proposal_id}`, {
			method: "GET",
		});
		assert.equal(details.status, 200);
		assert.partialDeepStrictEqual(await details.json(), {
			evidence: "Asked about leasing a suite.",
			source_activity: { id: null, subject: null, body: null, summary: null },
		});
		for (const proposal of [filing, lead]) {
			if (byConversation && proposal === lead)
				assert.partialDeepStrictEqual(await relevantCards(), [
					{
						proposal_id: lead.proposal_id,
						title: "Review adding New Sender as a lead",
						why: "Email from New Sender received on Jan 8, 2026. Asked about leasing a suite. Review the possible lead.",
						source_activity: null,
					},
				]);
			const [status] = await save(
				user,
				`proposals/${proposal.proposal_id}/decision`,
				{
					idempotency_key: randomUUID(),
					decision: "accept",
					...(proposal === filing && { reason: "File the floor plan." }),
				},
			);
			assert.equal(status, 200);
		}
		assert.deepEqual(await relevantCards(), []);
	});
}

// A job suggests the same decision on every message of a conversation.
async function suggestOnEachMessage(conversation: string, kind: string) {
	const job = { job: "mail_capture", for_user: "example" };
	const ids: string[] = [];
	for (const day of [11, 12, 13]) {
		const [stored, email] = await save(job, "activities", {
			idempotency_key: randomUUID(),
			kind: "email",
			happened_at: `2026-01-${day}T12:00:00Z`,
			email: {
				message_id: `<${conversation}-${day}@example.test>`,
				conversation_id: conversation,
				sender: "pat@example.test",
				recipients: [],
				subject: "Suite question",
				body: `Message ${day} about the suite.`,
			},
		});
		assert.equal(stored, 201);
		const [suggested, proposal] = await save(job, "proposals", {
			idempotency_key: randomUUID(),
			kind,
			activity_id: email.activity_id,
			evidence: "This thread is about the suite.",
			...(kind === "file_to_deal" && { deal_id: deal }),
		});
		assert.equal(suggested, 201);
		ids.push(String(proposal.proposal_id));
	}
	return ids;
}

test("Home shows a filing suggested on every message of a conversation once and settles it for the thread", async () => {
	const user = { user: "example" };
	const filings = await suggestOnEachMessage(
		"Outlook-repeat-filing",
		"file_to_deal",
	);
	const choices = await suggestOnEachMessage(
		"Outlook-repeat-choice",
		"possible_new_deal",
	);
	const decisions = async (ids: string[]) =>
		(await inbox()).flatMap(({ suggestions }) => {
			const shown = Array.isArray(suggestions)
				? suggestions.filter(isArguments).map(({ id }) => String(id))
				: [];
			return shown.some((id) => ids.includes(id)) ? [shown] : [];
		});
	for (const ids of [filings, choices])
		assert.deepEqual(await decisions(ids), [[ids[2]]]);
	for (const [ids, decision] of [
		[filings, { decision: "accept", reason: "The thread is about this deal." }],
		[choices, { decision: "dismiss", reason: "Not a deal." }],
	] as const) {
		const [status] = await save(user, `proposals/${ids[2]}/decision`, {
			idempotency_key: randomUUID(),
			...decision,
		});
		assert.equal(status, 200);
		assert.deepEqual(await decisions(ids), []);
	}
	const settled = await db.query(
		`select p.kind, p.status, about.deal_id from proposal p
		left join activity_about about on about.activity_id = p.activity_id and about.deal_id is not null
		where p.id = any($1::uuid[]) order by p.kind, p.created_at`,
		[[...filings, ...choices]],
	);
	assert.deepEqual(settled.rows, [
		...filings.map(() => ({
			kind: "file_to_deal",
			status: "accepted",
			deal_id: deal,
		})),
		...choices.map(() => ({
			kind: "possible_new_deal",
			status: "dismissed",
			deal_id: null,
		})),
	]);
});

test("Two accepts of different suggestions in one filing settle it once", {
	timeout: 10000,
}, async (t) => {
	// Locks are taken in id order, so the race clicks the lowest and highest ids.
	const [lowest, middle, highest] = (
		await suggestOnEachMessage("Outlook-racing-filing", "file_to_deal")
	).sort();
	const accept = (proposal: string | undefined) =>
		save({ user: "example" }, `proposals/${proposal}/decision`, {
			idempotency_key: randomUUID(),
			decision: "accept",
			reason: "The thread is about this deal.",
		});
	const waiting = async (count: number) => {
		while (
			(
				await db.query(
					`select count(distinct pid)::int as waiting from pg_locks
					where not granted and pid in (
						select pid from pg_locks
						where database = (select oid from pg_database where datname = current_database())
					)`,
				)
			).rows[0].waiting < count
		)
			t.signal.throwIfAborted();
	};
	// Holding the middle suggestion parks the first accept inside its decision.
	await db.query("begin");
	await db.query("select from proposal where id = $1 for update", [middle]);
	const first = accept(lowest);
	await waiting(1);
	const second = accept(highest);
	await waiting(2);
	await db.query("commit");
	const answers = await Promise.all([first, second]);
	assert.deepEqual(
		answers.map(([status, body]) => [status, body.error ?? body.status]),
		[
			[200, "accepted"],
			[409, "already_decided"],
		],
	);
	const { rows } = await db.query(
		"select status from proposal where id = any($1::uuid[])",
		[[lowest, middle, highest]],
	);
	assert.deepEqual(
		rows.map(({ status }) => status),
		["accepted", "accepted", "accepted"],
	);
});

test("A copied email lead suggestion keeps its mailbox and intake reading on Home", async () => {
	const candidateId = id(40);
	const proposalId = id(41);
	await db.query(`begin;
		select set_config('engine.job', 'mail_capture', true), set_config('engine.user_id', '${other}', true);
		insert into candidate (id, source, source_key, source_row, name, qualification)
			values ('${candidateId}', 'outlook-intake', 'example-copy', '{"address":"copied@example.test","reading":{"applies_to":"existing_deal"}}',
				'Copied Example', 'Asked about the floor plan.');
		insert into proposal (id, kind, candidate_id, proposed_by_job, evidence)
			values ('${proposalId}', 'email_lead', '${candidateId}', 'mail_capture', 'Asked about the floor plan.');
		commit;`);
	assert.ok(!(await inbox()).some((card) => card.proposal_id === proposalId));
	assert.partialDeepStrictEqual(
		(await inbox("other")).find((card) => card.proposal_id === proposalId),
		{ suggestions: [{ id: proposalId, candidate_id: candidateId }] },
	);
	const detail = await request({ user: "other" }, `proposals/${proposalId}`, {
		method: "GET",
	});
	assert.equal(detail.status, 200);
	assert.partialDeepStrictEqual(await detail.json(), {
		applies_to: "existing_deal",
		evidence_quote: null,
		source_activity: { happened_at: null },
	});
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
			title: "Review the call note for Example Dental",
			why: "Call on Jan 6, 2026. Let's review the example plan. Proposed: Agreed to review the example plan.",
			primary_action: "Review suggestions",
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

test("Home uses the copied call log's reviewer when the call has no partner stamp", async () => {
	const copied = id(42);
	const unassigned = id(43);
	const copiedForOther = id(44);
	const newLog = id(45);
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '${partner}', true);
		insert into proposal (id, kind, activity_id, activity_kind, proposed_by_job, deal_id, what, evidence)
			values ('${copied}', 'log_call', '${unstampedCall}', 'call', 'old_system', '${deal}', 'Review the plan.', 'Review the plan.');
		select set_config('engine.user_id', '', true);
		insert into proposal (id, kind, activity_id, activity_kind, proposed_by_job, deal_id, what, evidence)
			values ('${unassigned}', 'log_call', '${unstampedCall}', 'call', 'old_system', '${deal}', 'Review the lease.', 'Review the lease.');
		select set_config('engine.user_id', '${other}', true);
		insert into proposal (id, kind, activity_id, activity_kind, proposed_by_job, deal_id, what, evidence)
			values ('${copiedForOther}', 'log_call', '${call}', 'call', 'old_system', '${deal}', 'Review the timing.', 'Review the timing.');
		select set_config('engine.job', 'mail_capture', true);
		insert into proposal (id, kind, activity_id, activity_kind, proposed_by_job, deal_id, what, evidence)
			values ('${newLog}', 'log_call', '${unstampedCall}', 'call', 'mail_capture', '${deal}', 'Review the budget.', 'Review the budget.');
		commit;`);
	try {
		const calls = async (user: string, callId = unstampedCall) =>
			(await inbox(user)).filter(
				(card) => card.open_url === `/calls?session=${callId}`,
			);
		assert.partialDeepStrictEqual(await calls("example"), [
			{ proposal_id: copied, merged_source_ids: [copied] },
		]);
		assert.deepEqual(
			await calls("other"),
			[],
			"A new suggestion needs its call's partner stamp",
		);
		assert.deepEqual(
			await calls("other", call),
			[],
			"A copied proposal cannot override its call's partner stamp",
		);
		for (const [user, proposal, status] of [
			["example", copied, 200],
			["other", copied, 404],
			["example", unassigned, 404],
			["other", newLog, 404],
			["other", copiedForOther, 404],
		] as const) {
			const detail = await request({ user }, `proposals/${proposal}`, {
				method: "GET",
			});
			assert.equal(detail.status, status);
		}
		const [status] = await save(
			{ user: "example" },
			`proposals/${copied}/decision`,
			{
				idempotency_key: randomUUID(),
				decision: "dismiss",
			},
		);
		assert.equal(status, 200);
		assert.deepEqual(await calls("example"), []);
	} finally {
		await db.query(`begin; select set_config('engine.job', 'old_system', true);
			delete from proposal where id in ('${copied}', '${unassigned}', '${copiedForOther}', '${newLog}'); commit;`);
	}
});

test("Home uses recorded sender names and matches an unambiguous address", async () => {
	const filing = (await inbox("other")).find(
		(card) => card.proposal_id === id(38),
	);
	assert.partialDeepStrictEqual(filing, {
		title: "Choose the deal for Pat Example's email",
		why: "Pat Example asked for tour times at Cedar Suite. Please file this. Suggested deal is Example Orthodontics.",
		primary_action: "Choose deal",
	});
});

test("Home uses the shortest saved request before signatures and quoted headers", async () => {
	const draft = (await inbox("other")).find(
		(card) => card.reply_draft_id === id(22),
	);
	assert.partialDeepStrictEqual(draft, {
		title: "Review the reply to Known Contact",
		why: "Please send the plan.",
		primary_action: "Review reply",
	});
});

test("Home omits callback numbers from titles built from saved proposal evidence", async () => {
	const card = (await inbox("evidence-reviewer")).find(
		(card) => card.proposal_id === filingWithPhone,
	);
	assert.equal(card?.title, "Choose the deal for Pat Example's email");
});

test("Home keeps a confirmed tour date from the saved excerpt without a summary", async () => {
	const card = (await inbox("evidence-reviewer")).find(
		(card) => card.reply_draft_id === tourReply,
	);
	assert.partialDeepStrictEqual(card, {
		title: "Review the reply to Known Contact",
		why: "November 8 works for the tour.",
	});
});

test("Home explains a proposed follow-up when the email summary is unavailable", async () => {
	const step = (await inbox()).find((card) => card.proposal_id === id(32));
	assert.partialDeepStrictEqual(step, {
		title: "Review the proposed follow-up for Example Dental",
		why: "Email from Known Contact received on Jan 3, 2026. Proposed follow-up: Check the drawing.",
		primary_action: "Review follow-up",
	});
});

test("a proposed follow-up keeps copied sender wording in the evidence", async () => {
	const proposal = id(32);
	async function setWording(what: string) {
		await db.query(
			`begin; select set_config('engine.job', 'old_system', true);`,
		);
		await db.query("update proposal set what = $1 where id = $2", [
			what,
			proposal,
		]);
		await db.query("commit");
	}
	try {
		for (const wording of ["Morgan Example", "Email from Morgan Example"]) {
			await setWording(wording);
			const step = (await inbox()).find(
				(card) => card.proposal_id === proposal,
			);
			assert.partialDeepStrictEqual(step, {
				title: "Review the proposed follow-up for Example Dental",
				why: `Email from Known Contact received on Jan 3, 2026. Proposed follow-up: ${wording}.`,
			});
		}
	} finally {
		await setWording("Check the drawing");
	}
});

test("Home names the proposed phase, lead and lead stage for email decisions", async () => {
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '${other}', true);
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, to_phase)
			values ('${id(63)}', 'phase_move', '${id(13)}', 'email', 'The LOI arrived.', 'old_system', '${deal}', 'negotiation');
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, party_id, to_stage, how_found, from_stage, strength)
			values ('${id(64)}', 'new_lead', '${id(16)}', 'email', 'Asked about representation.', 'old_system', '${knownContact}', 'new', 'inbound', null, null),
				('${id(65)}', 'lead_stage_move', '${id(15)}', 'email', 'Confirmed their plans.', 'old_system', '${partner}', 'qualified', null, 'new', 'weak');
		commit;`);
	try {
		const cards = await inbox("other");
		assert.partialDeepStrictEqual(
			cards.find((card) => card.proposal_id === id(63)),
			{
				title: "Review moving Example Dental to Negotiating",
				why: "Email from Pat Example received on Jan 4, 2026. The LOI arrived. Proposed phase is Negotiating.",
				primary_action: "Review phase change",
			},
		);
		assert.partialDeepStrictEqual(
			cards.find((card) => card.proposal_id === id(64)),
			{
				title: "Review adding Known Contact as a lead",
				primary_action: "Review lead",
			},
		);
		assert.partialDeepStrictEqual(
			cards.find((card) => card.proposal_id === id(65)),
			{
				title: "Review moving Example Partner to Qualified",
				why: "Email from Pat Example received on Jan 6, 2026. Confirmed their plans. Proposed lead stage is Qualified.",
				primary_action: "Review lead stage",
			},
		);
	} finally {
		await db.query(`begin;
			select set_config('engine.job', 'old_system', true);
			delete from proposal where id in ('${id(63)}', '${id(64)}', '${id(65)}'); commit;`);
	}
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
			happened_at: "2026-01-03T02:00:00.000Z",
		},
	});
	assert.equal((await read(38, "other")).status, 200);
	assert.equal((await read(30, "other")).status, 404);
	assert.equal((await read(33, "other")).status, 404);
	assert.equal((await read(35)).status, 404);
	assert.equal((await read(41)).status, 404);
});

test("draft and proposal details return only the viewer's distinct messages in the exact Outlook thread", async () => {
	const get = async (path: string, user = "example") => {
		const response = await request({ user }, path, { method: "GET" });
		assert.equal(response.status, 200);
		const detail: unknown = await response.json();
		assert.ok(isArguments(detail));
		return detail.thread;
	};
	const thread = [
		{
			activity_id: id(10),
			sender_name: "Sam Example",
			happened_at: "2026-01-02T00:00:00.000Z",
			body: "Please send the plan.",
		},
		{
			activity_id: id(11),
			sender_name: "Pat Example",
			happened_at: "2026-01-03T00:00:00.000Z",
			body: "Please send the plan.",
		},
	];
	assert.deepEqual(await get(`proposals/${id(30)}`), thread);
	assert.deepEqual(await get(`reply-drafts/${id(21)}`), thread);
	assert.deepEqual(await get(`proposals/${id(38)}`, "other"), [
		thread[1],
		{
			activity_id: id(14),
			sender_name: "Pat Example",
			happened_at: "2026-01-06T00:00:00.000Z",
			body: "Please send the plan.",
		},
	]);
	assert.deepEqual(await get(`proposals/${id(32)}`), [
		{
			activity_id: id(12),
			sender_name: "Known Contact",
			happened_at: "2026-01-04T00:00:00.000Z",
			body: quotedRequest,
		},
	]);
});

test("dashboard hides proposals and drafts when their source is in another mailbox", async () => {
	const user = { user: "private-source-reviewer" };
	const reviewer = id(72);
	const proposal = id(73);
	const draft = id(74);
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${reviewer}', 'person', 'Example Private Source Reviewer');
		insert into app_user (id, slug) values ('${reviewer}', '${user.user}');
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, what, owner_party_id)
			values ('${proposal}', 'next_step', '${id(10)}', 'email', 'Please send the plan.', 'old_system',
				'${deal}', 'Send the plan', '${reviewer}');
		insert into reply_draft (id, email_activity_id, owner_user_id, proposed_by_job, subject, body, evidence)
			values ('${draft}', '${id(12)}', '${reviewer}', 'old_system', 'Floor plan', 'Here it is.', 'Please send the plan.');
		commit;`);
	for (const path of [`proposals/${proposal}`, `reply-drafts/${draft}`]) {
		assert.equal((await request(user, path, { method: "GET" })).status, 404);
	}
	assert.deepEqual(await dashboard(user.user), { reminders: [], waiting: [] });
});

test("single-message threads keep requests, signatures and history without corroborating mail", async () => {
	const emails = [75, 76, 77, 79, 81, 82, 83, 84].map(id);
	const proposals = emails.map(() => randomUUID());
	const reviewer = id(80);
	const user = { user: "thread-cleanup-reviewer" };
	const bodies = [
		"Thanks!\nCould you confirm that Tuesday still works?",
		"Here is the plan.\n----\nPlease check the second page.",
		"Please send the plan.\n\nBest regards,\nPat Example\nPhone: 555-010-1234",
		"Thanks!\nhttps://example.test/floor-plan",
		"Current message.\r\nFrom: Pat <pat@example.test>\r\nSent: yesterday\r\nOld message.",
		"Current message.\r\nFrom: Pat\r\n <pat@example.test>\r\nSent: yesterday\r\nOld message.",
		"Current message.\r\nFrom: Pat\r\n  Sent: yesterday\r\nOld message.",
		"Current message.\r\n  Please keep this line.",
	];
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${reviewer}', 'person', 'Example Thread Reviewer');
		insert into app_user (id, slug) values ('${reviewer}', '${user.user}');`);
	for (const [index, email] of emails.entries()) {
		await db.query(
			"insert into activity (id, kind, happened_at) values ($1, 'email', '2026-01-01'::date + $2::int)",
			[email, index],
		);
		await db.query(
			`insert into email (activity_id, message_id, conversation_id, sender, sender_name, subject, body)
			values ($1::uuid, $1::uuid::text || '@example.test', null, 'pat@example.test', 'Pat Example', 'Example plan', $2)`,
			[email, bodies[index]],
		);
		await db.query(
			"insert into email_mailbox (activity_id, user_id) values ($1, $2)",
			[email, reviewer],
		);
		await db.query(
			"insert into activity_about (activity_id, party_id) values ($1, $2)",
			[email, reviewer],
		);
		await db.query(
			`insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job)
			values ($1, 'possible_new_deal', $2, 'email', 'Please check the plan.', 'old_system')`,
			[proposals[index], email],
		);
	}
	await db.query("commit");
	const threads = [];
	for (const proposal of proposals) {
		const response = await request(user, `proposals/${proposal}`, {
			method: "GET",
		});
		assert.equal(response.status, 200);
		const detail: unknown = await response.json();
		assert.ok(isArguments(detail) && Array.isArray(detail.thread));
		threads.push(detail.thread.filter(isArguments).map(({ body }) => body));
	}
	assert.deepEqual(
		threads,
		bodies.map((body) => [body]),
	);
});

test("every Home email review shows each message once without signatures, headers or quoted history", async () => {
	const reviewer = randomUUID();
	const user = { user: "clean-thread-reviewer" };
	const [ask, answer, confirm, later] = [
		randomUUID(),
		randomUUID(),
		randomUUID(),
		randomUUID(),
	];
	const followUp = randomUUID();
	const chooseDeal = randomUUID();
	const draft = randomUUID();
	const requestText = "Could you send the suite 200 plan?";
	const answerText = "Here is the plan.";
	const confirmText = "Tuesday at 10 works.";
	const signature =
		"Maya Example | leasing director | Direct: 555-010-2000 | License 12345";
	const messages = [
		{
			id: ask,
			address: "maya@example.test",
			sender: "Maya Example",
			body: `${requestText}\r\n\r\n${signature}`,
			kept: requestText,
		},
		{
			id: answer,
			address: "partner@example.test",
			sender: "Example Thread Partner",
			body: `${answerText}\r\n\r\n*From:* Maya Example <maya@example.test>\r\n\r\n*Sent:* Monday, January 5, 2026 9:00 AM\r\n*To:* Example Thread Partner\r\n*Subject:* Suite 200\r\n\r\n${requestText}`,
			kept: answerText,
		},
		{
			id: confirm,
			address: "maya@example.test",
			sender: "Maya Example",
			body: `${confirmText}\r\n${signature}\r\n> ${answerText}\r\n> ${requestText}`,
			kept: confirmText,
		},
		{
			id: later,
			address: "maya@example.test",
			sender: "Maya Example",
			body: `Bring the keys.\n${signature}`,
			kept: "Bring the keys.",
		},
	];
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${reviewer}', 'person', 'Example Thread Partner');
		insert into app_user (id, slug) values ('${reviewer}', '${user.user}');`);
	for (const [index, message] of messages.entries()) {
		await db.query(
			"insert into activity (id, kind, happened_at) values ($1, 'email', '2026-01-05'::date + $2::int)",
			[message.id, index],
		);
		await db.query(
			`insert into email (activity_id, message_id, conversation_id, sender, sender_name, subject, body)
			values ($1::uuid, $1::uuid::text || '@example.test', 'Clean thread', $2, $3, 'Suite 200', $4)`,
			[message.id, message.address, message.sender, message.body],
		);
		await db.query(
			"insert into email_mailbox (activity_id, user_id) values ($1, $2)",
			[message.id, reviewer],
		);
		await db.query(
			"insert into activity_about (activity_id, party_id) values ($1, $2)",
			[message.id, reviewer],
		);
	}
	await db.query(
		`insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, what, owner_party_id)
		values ($1, 'next_step', $3, 'email', 'Tuesday at 10 works.', 'old_system', $4, 'Book the tour', $5),
			($2, 'file_to_deal', $3, 'email', 'Tuesday at 10 works.', 'old_system', $4, null, null)`,
		[followUp, chooseDeal, confirm, deal, reviewer],
	);
	await db.query(
		`insert into reply_draft (id, email_activity_id, owner_user_id, proposed_by_job, subject, body, evidence)
		values ($1, $2, $3, 'old_system', 'Re: Suite 200', 'See you Tuesday.', 'Tuesday at 10 works.')`,
		[draft, confirm, reviewer],
	);
	await db.query("commit");
	for (const path of [
		`proposals/${followUp}`,
		`proposals/${chooseDeal}`,
		`reply-drafts/${draft}`,
	]) {
		const response = await request(user, path, { method: "GET" });
		assert.equal(response.status, 200, path);
		const detail: unknown = await response.json();
		assert.ok(isArguments(detail) && Array.isArray(detail.thread), path);
		assert.deepEqual(
			detail.thread.filter(isArguments).map(({ activity_id, body }) => ({
				activity_id,
				body,
			})),
			messages.map(({ id, kept }) => ({ activity_id: id, body: kept })),
			path,
		);
	}
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
		(card) => card.item_id === `reply_draft:${id(21)}`,
	);
	assert.ok(matchingCard);
	assert.equal(matchingCard.due_on, "2026-01-09");
	assert.equal(thread.length, 1);
	assert.partialDeepStrictEqual(thread, [
		{
			item_id: matchingCard.item_id,
			base_version: matchingCard.base_version,
			title: "Pat Example · Floor plan",
			sender: "Pat Example",
			subject: "Floor plan",
			kind: "reply_draft",
			suggestion: "Review reply draft",
			proposal_id: null,
			reply_draft_id: id(21),
			due_on: "2026-01-09",
			source_activity: {
				kind: "email",
				id: id(11),
				happened_at: "2026-01-03T00:00:00.000Z",
			},
		},
	]);
	assert.equal(priorities[0]?.item_id, matchingCard.item_id);
	assert.equal(
		priorities.find((row) => row.proposal_id === id(32))?.title,
		"Known Contact · Floor plan",
	);
	const other: unknown = await (await get({ user: "other" })).json();
	assert.ok(isArguments(other) && Array.isArray(other.items));
	assert.partialDeepStrictEqual(
		other.items
			.filter(isArguments)
			.filter((row) => row.conversation_id === "Thread"),
		[{ item_id: `suggestion:${id(38)}`, proposal_id: id(38) }],
	);
});

test("Home falls back to suggestions and keeps delivery feedback on their card", async () => {
	const user = { user: "draft-reviewer" };
	const reviewer = id(57);
	const draft = id(58);
	const declinedDraft = id(59);
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${reviewer}', 'person', 'Example Draft Reviewer');
		insert into app_user (id, slug) values ('${reviewer}', '${user.user}');
		select set_config('engine.user_id', '${reviewer}', true);
		insert into reply_draft (id, email_activity_id, owner_user_id, proposed_by_job, subject, body, evidence)
			values ('${draft}', '${id(11)}', '${reviewer}', 'old_system', 'Floor plan', 'Here it is.', 'Please send the plan.'),
				('${declinedDraft}', '${id(13)}', '${reviewer}', 'old_system', 'Floor plan', 'Here it is.', 'Reply suggested.');
		insert into email_mailbox (activity_id, user_id) values ('${id(10)}', '${reviewer}'), ('${id(11)}', '${reviewer}');
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, created_at, deal_id, what, owner_party_id, due_on)
			values ('${id(60)}', 'next_step', '${id(10)}', 'email', 'Please send the plan.', 'old_system', '2026-01-07',
				'${deal}', '**Send the plan** (loop #7)', '${reviewer}', '2026-01-09');
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, created_at)
			values ('${id(61)}', 'possible_new_deal', '${id(11)}', 'email', 'Review the suite.', 'old_system', '2026-01-06'),
				('${id(62)}', 'possible_new_deal', '${id(13)}', 'email', 'Review the other suite.', 'old_system', '2026-01-06');
		commit;`);
	const cards = () => inbox(user.user);
	const activeCard = async (emailIds: string[]) => {
		const active = (await cards()).filter(
			(card) =>
				card.source_state !== "done" &&
				isArguments(card.source_activity) &&
				typeof card.source_activity.id === "string" &&
				emailIds.includes(card.source_activity.id),
		);
		assert.equal(active.length, 1, "The conversation has one active card");
		return active[0];
	};
	const thread = () => activeCard([10, 11, 14].map(id));
	const unkeyed = () => activeCard([id(13)]);
	const dashboardBefore = await dashboard(user.user);
	const beforeCard = dashboardBefore.reminders.find(
		(card) => card.item_id === `reply_draft:${draft}`,
	);
	assert.ok(typeof beforeCard?.card_id === "string");
	assert.partialDeepStrictEqual(await unkeyed(), {
		item_id: `reply_draft:${declinedDraft}`,
		why: "Email from Pat Example received on Jan 4, 2026. Review the drafted reply.",
		suggestions: [{ id: id(62) }],
	});
	assert.partialDeepStrictEqual(await thread(), {
		item_id: `reply_draft:${draft}`,
		title: "Review the reply to Pat Example about Example Dental",
		why: "Pat Example asked for tour times at Cedar Suite.",
		primary_action: "Review reply",
		due_on: "2026-01-09",
		suggestions: [{ id: id(60) }, { id: id(61) }, { id: id(38) }],
	});
	const [declined] = await save(
		user,
		`reply-drafts/${declinedDraft}/dismissal`,
		{
			idempotency_key: randomUUID(),
			reason: "The example reply is no longer needed.",
			version: 1,
		},
	);
	assert.equal(declined, 200);
	assert.partialDeepStrictEqual(await unkeyed(), {
		item_id: `suggestion:${id(62)}`,
		kind_label: "Suggestion",
		title: "Choose the deal for Pat Example's email",
		primary_action: "Choose deal",
	});
	const setDraft = (job: string, change: string) =>
		db.query(`begin;
		select set_config('engine.job', '${job}', true), set_config('engine.user_id', '${reviewer}', true);
		update reply_draft set ${change} where id = '${draft}'; commit;`);
	const approve =
		"status = 'approved', failure_reason = null, to_address = 'pat@example.test', cc_address = 'copy@example.test'";
	await setDraft("", approve);
	const dashboardAfter = await dashboard(user.user);
	const afterCard = dashboardAfter.reminders.find(
		(card) => card.item_id === `suggestion:${id(60)}`,
	);
	assert.equal(afterCard?.card_id, beforeCard.card_id);
	assert.partialDeepStrictEqual(await thread(), {
		item_id: `suggestion:${id(60)}`,
		title: "Review the proposed follow-up for Example Dental",
		why: "Sam Example requested the floor plan before the tour. Proposed follow-up: Send the plan. 3 decisions to review.",
		primary_action: "Review follow-up",
		due_on: "2026-01-09",
		source_activity: {
			kind: "email",
			id: id(10),
			happened_at: "2026-01-02T00:00:00.000Z",
		},
		fallback_reply_draft: {
			id: draft,
			version: "2",
			status: "approved",
			failure_reason: null,
		},
		suggestions: [{ id: id(60) }, { id: id(61) }, { id: id(38) }],
	});
	await setDraft(
		"old_system",
		"status = 'failed', failure_reason = 'aborted_before_dispatch'",
	);
	assert.partialDeepStrictEqual(await thread(), {
		item_id: `suggestion:${id(60)}`,
		fallback_reply_draft: {
			id: draft,
			version: "2",
			status: "failed",
			failure_reason: "aborted_before_dispatch",
		},
	});
	await setDraft("", approve);
	await setDraft(
		"old_system",
		"status = 'sent', sent_at = now(), sent_item_id = 'example-draft-sent'",
	);
	const suggestion = await thread();
	assert.ok(suggestion && !("fallback_reply_draft" in suggestion));
	assert.equal(suggestion.item_id, `suggestion:${id(60)}`);
	assert.deepEqual(
		(await cards())
			.filter((card) => card.source_state === "done")
			.map((card) => card.item_id),
		[`reply_draft:${draft}`],
	);

	const [dismissed] = await save(user, `proposals/${id(60)}/decision`, {
		idempotency_key: randomUUID(),
		decision: "dismiss",
	});
	assert.equal(dismissed, 200);
	const filing = (await dashboard(user.user)).reminders.find(
		(card) => card.card_id === beforeCard.card_id,
	);
	assert.partialDeepStrictEqual(filing, {
		title: "Choose the deal for Pat Example's email",
		why: "Pat Example asked for tour times at Cedar Suite. Review the suite. 2 decisions to review.",
		primary_action: "Choose deal",
	});
});

test("Mail priorities keeps two emails without conversation IDs in separate groups", async () => {
	const user = { user: "unkeyed-reviewer" };
	const reviewer = id(53);
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${reviewer}', 'person', 'Example Reviewer');
		insert into app_user (id, slug) values ('${reviewer}', '${user.user}');
		insert into email_mailbox (activity_id, user_id) values ('${id(12)}', '${reviewer}');
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
