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
const knownContact = randomUUID();

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into how_found (slug, label) values ('inbound', 'Inbound');
		insert into role (slug, label) values ('lead', 'Lead');
		insert into stage (role, slug, label) values ('lead', 'new', 'New');
		insert into party (id, kind, name) values
			('${partner}', 'person', 'Example Partner'), ('${other}', 'person', 'Other Partner');
		insert into app_user (id, slug) values ('${partner}', 'example'), ('${other}', 'other');
		insert into party (id, kind, name) values ('${knownContact}', 'person', 'Known Contact');
		insert into party_email (party_id, address, label) values ('${knownContact}', 'known-cc@example.test', 'work'),
			('${knownContact}', 'pat@example.test', 'work'),
			('${knownContact}', 'shared@example.test', 'work'), ('${other}', 'shared@example.test', 'work');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Dental', '${partner}');
		insert into activity (id, kind, happened_at)
			select id, 'email', '2026-01-01'::date + offset_days::int
			from unnest(array[${[10, 11, 12, 13, 14, 15, 16].map((n) => `'${id(n)}'`).join(",")}]::uuid[])
			with ordinality t(id, offset_days);
		insert into email (activity_id, message_id, conversation_id, sender, sender_name, subject, body)
			select id, '<'||id||'@example.test>', case when id in ('${id(10)}', '${id(11)}', '${id(14)}') then 'Thread' end,
				case when id = '${id(16)}' then 'shared@example.test' else 'pat@example.test' end,
				case when id = '${id(10)}' then 'Sam Example' when id not in ('${id(12)}', '${id(16)}') then 'Pat Example' end,
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
						`('${id(n + 10)}', '${id(n)}', '${n === 12 ? other : partner}', 'old_system', 'Re: Email from Pat Example: Re: Floor plan', 'Here it is.', 'Please send the plan.')`,
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
		assert.equal(Object.hasOwn(item, "auto_settled"), false);
		assert.equal(Object.hasOwn(item, "explicit_unsettle"), false);
	}
	return items;
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
			source_activity: {
				kind: "email",
				id: id(11),
				deal_id: deal,
				happened_at: "2026-01-03T00:00:00.000Z",
			},
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
	const [unsnoozed, receipt] = await mark("unsnooze");
	assert.equal(unsnoozed, 200);
	assert.equal((await card()).section, "inbox");
	const [decided] = await save(user, `proposals/${id(51)}/decision`, {
		idempotency_key: randomUUID(),
		decision: "dismiss",
	});
	assert.equal(decided, 200);
	assert.partialDeepStrictEqual(await card(), {
		section: "inbox",
		merged_source_ids: [id(52), id(50)],
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
			title: "Call with Known Contact left 2 decisions — review suggestions",
			why: "Call on Jan 2, 2026. Send a budget.",
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
		[[id(38)]],
	);
});

test("Home names a meeting's recorded decision with the deal and meeting date", async () => {
	const proposal = randomUUID();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, what, owner_party_id)
			values ('${proposal}', 'next_step', '${meeting}', 'meeting', 'L-223', 'old_system', '${deal}', 'Confirm the tour', '${other}');
		commit;`);
	assert.partialDeepStrictEqual(
		(await inbox("other")).find((card) => card.proposal_id === proposal),
		{
			title:
				"Meeting about Example Dental on Jan 3, 2026 left a decision — review suggestions",
			why: "Meeting on Jan 3, 2026. Confirm the tour.",
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
				title: "New Example · Possible lead",
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
		const mail = {
			kind: "email",
			happened_at: happenedAt,
			email: {
				message_id: messageId,
				...(match === "conversation_id" && { conversation_id: conversationId }),
				sender,
				sender_name: "New Sender",
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
		if (match === "other_mailbox" || match === "mismatch") {
			const standalone = cards.find(
				(card) => card.proposal_id === lead.proposal_id,
			);
			assert.equal(cards.length, match === "other_mailbox" ? 1 : 2);
			assert.partialDeepStrictEqual(standalone, {
				title: "New Sender · Possible lead",
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
			title: "New Sender · Floor plan",
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
		for (const proposal of [lead, filing]) {
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
			title:
				"Call about Example Dental on Jan 6, 2026 left a decision — review suggestions",
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
	assert.equal(filing?.title, "Pat Example · Floor plan");
	const step = (await inbox()).find((card) => card.proposal_id === id(32));
	assert.equal(step?.title, "Known Contact · Floor plan");
	const draft = (await inbox("other")).find(
		(card) => card.reply_draft_id === id(22),
	);
	assert.equal(draft?.title, "Reply to Known Contact: Floor plan");
	const shared = (await inbox()).find((card) => card.reply_draft_id === id(26));
	assert.equal(shared?.title, "Reply to shared@example.test: Floor plan");
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
				('${declinedDraft}', '${id(13)}', '${reviewer}', 'old_system', 'Floor plan', 'Here it is.', 'Please send the plan.');
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, created_at)
			values ('${id(60)}', 'possible_new_deal', '${id(10)}', 'email', 'Check the plan.', 'old_system', '2026-01-07'),
				('${id(61)}', 'possible_new_deal', '${id(11)}', 'email', 'Review the suite.', 'old_system', '2026-01-06'),
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
	assert.partialDeepStrictEqual(await thread(), {
		item_id: `reply_draft:${draft}`,
		suggestions: [{ id: id(60) }, { id: id(61) }],
	});
	assert.partialDeepStrictEqual(await unkeyed(), {
		item_id: `reply_draft:${declinedDraft}`,
		suggestions: [{ id: id(62) }],
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
	});
	const setDraft = (job: string, change: string) =>
		db.query(`begin;
		select set_config('engine.job', '${job}', true), set_config('engine.user_id', '${reviewer}', true);
		update reply_draft set ${change} where id = '${draft}'; commit;`);
	const approve =
		"status = 'approved', failure_reason = null, to_address = 'pat@example.test', cc_address = 'copy@example.test'";
	await setDraft("", approve);
	assert.partialDeepStrictEqual(await thread(), {
		item_id: `suggestion:${id(60)}`,
		title: "Pat Example · Floor plan",
		source_activity: {
			kind: "email",
			id: id(11),
			happened_at: "2026-01-03T00:00:00.000Z",
		},
		fallback_reply_draft: {
			id: draft,
			version: "2",
			status: "approved",
			failure_reason: null,
		},
		suggestions: [{ id: id(60) }, { id: id(61) }],
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
