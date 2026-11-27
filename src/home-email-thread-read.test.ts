import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { isArguments } from "./save-door.ts";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, request, save } = doorTest();
const caller = { user: "thread-reviewer" };
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const viewer = id(1);
const other = id(2);
const deal = id(3);
const followUp = id(4);
const filing = id(5);
const draft = id(6);
const duplicateProposal = id(7);
const duplicateDraft = id(8);
const partnerProposal = id(61);
const dell = id(70);
const sharedProposal = id(63);
const sharedPartners = [id(71), id(72)];
const start = "2026-01-05T15:00:00.000001Z";
const nextMicrosecond = "2026-01-05T15:00:00.000002Z";
const footer = "Please copy the surveyor.\nThanks again.";
const authored = "I sent the plan.\n\nUse the west door.";
const history = "Earlier message\nAn older plan.";
const captured =
	"I sent the plan. Use the west door. Earlier message An older plan.";
const carried = "Forwarded floor plan.";
const privateQuote = "A private note about the keys.";

const messages: {
	id: number;
	at: string;
	body: string;
	messageId?: string;
	subject?: string;
	conversation?: string;
	split?: [authored: string, history: string];
	mailboxes?: string[];
	sender?: [address: string, name: string];
}[] = [
	{ id: 10, at: start, body: captured },
	{
		id: 11,
		at: start,
		body: `  ${captured.replaceAll(" ", "\u2003\u0085")}\n`,
		messageId: "<plan@example.test>",
		split: [authored, history],
		mailboxes: [viewer, other],
	},
	{
		id: 12,
		at: start,
		body: captured,
		messageId: "<plan@example.test>",
		split: ["A later copy.", ""],
	},
	{ id: 13, at: nextMicrosecond, body: captured },
	{ id: 14, at: start, body: captured, subject: "suite plan" },
	{
		id: 15,
		at: start,
		body: captured,
		messageId: "<private@example.test>",
		split: ["Private split.", ""],
		mailboxes: [other],
	},
	{
		id: 19,
		at: "2026-01-06T14:00:00Z",
		body: carried,
		messageId: "<Forward@example.test>",
	},
	{
		id: 20,
		at: "2026-01-06T15:00:00Z",
		body: carried,
		messageId: "<Forward@example.test>",
		split: ["", carried],
	},
	{
		id: 21,
		at: "2026-01-06T15:00:00Z",
		body: carried,
		messageId: "<forward@example.test>",
		split: [carried, ""],
	},
	{ id: 22, at: "2026-01-06T15:00:00Z", body: carried },
	{ id: 23, at: "2026-01-06T15:00:00Z", body: "" },
	{ id: 24, at: "2026-01-06T15:00:00Z", body: "\u0085\t" },
	{
		id: 25,
		at: "2026-01-06T15:00:00Z",
		body: `${privateQuote}\n${footer}`,
		mailboxes: [other],
	},
	{
		id: 30,
		at: "2026-01-07T15:00:00Z",
		body: `The keys are ready.\n${footer}`,
		messageId: "<keys@example.test>",
		mailboxes: [viewer, other],
	},
	{
		id: 31,
		at: "2026-01-06T16:00:00Z",
		body: `Pick up the keys at four.\n${footer}`,
		messageId: "<keys@example.test>",
	},
	{
		id: 32,
		at: "2026-01-08T15:00:00Z",
		body: `Will do.\n> ${privateQuote}\n${footer}`,
	},
	{
		id: 40,
		at: start,
		body: captured,
		messageId: "<layout@example.test>",
		subject: "Old layout subject",
		conversation: "Layout thread",
	},
	{
		id: 41,
		at: start,
		body: captured,
		messageId: "<layout@example.test>",
		conversation: "Layout thread",
		split: [authored, history],
		mailboxes: [viewer, other],
	},
	{
		id: 60,
		at: start,
		body: captured,
		messageId: "<partner-ask@example.test>",
		conversation: "Partner thread",
	},
	{
		id: 62,
		at: nextMicrosecond,
		body: authored,
		messageId: "<partner@example.test>",
		conversation: "Partner thread",
		sender: ["dell@example.test", "Wayne Example"],
	},
	{
		id: 64,
		at: start,
		body: captured,
		messageId: "<shared@example.test>",
		conversation: "Shared thread",
		sender: ["shared@example.test", "Casey Example"],
	},
	{
		id: 65,
		at: nextMicrosecond,
		body: authored,
		messageId: "<outsider@example.test>",
		conversation: "Shared thread",
		sender: ["outsider@example.test", "Riley Outsider"],
	},
];

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${viewer}', 'person', 'Example Reviewer'), ('${other}', 'person', 'Other Reviewer'), ('${dell}', 'person', 'Wayne Example'),
			('${sharedPartners[0]}', 'person', 'Shared One'), ('${sharedPartners[1]}', 'person', 'Shared Two');
		insert into app_user (id, slug) values ('${viewer}', 'thread-reviewer'), ('${other}', 'other-reviewer'), ('${dell}', 'dell'),
			('${sharedPartners[0]}', 'shared-one'), ('${sharedPartners[1]}', 'shared-two');
		insert into party_email (party_id, address, label) values
			('${sharedPartners[0]}', 'shared@example.test', 'work'), ('${sharedPartners[1]}', 'shared@example.test', 'work');
		insert into party_email (party_id, address, label) values ('${dell}', 'dell@example.test', 'work');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Dental', '${viewer}');`);
	// Current insert rules prevent creating these historical duplicates.
	await db.query(`alter table email drop constraint email_message_id_key;
		alter table email disable trigger email_without_message_id_once;`);
	for (const message of messages) {
		const activityId = id(message.id);
		await db.query(
			"insert into activity (id, kind, happened_at) values ($1, 'email', $2)",
			[activityId, message.at],
		);
		await db.query(
			`insert into email (activity_id, message_id, conversation_id, sender, sender_name, subject, body, authored, history, imported)
			values ($1, $2::text, $3, $8, $9, $4, $5, $6, $7, $2 is null)`,
			[
				activityId,
				message.messageId ?? null,
				message.conversation ?? "Plan thread",
				message.subject ?? "Suite plan",
				message.body,
				...(message.split ?? [null, null]),
				...(message.sender ?? ["maya@example.test", null]),
			],
		);
		await db.query(
			"insert into email_mailbox (activity_id, user_id) select $1, unnest($2::uuid[])",
			[activityId, message.mailboxes ?? [viewer]],
		);
		await db.query(
			"insert into activity_about (activity_id, party_id) values ($1, $2)",
			[activityId, viewer],
		);
	}
	await db.query(`
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, what, owner_party_id)
		values ('${followUp}', 'next_step', '${id(10)}', 'email', 'I sent the plan.', 'old_system', '${deal}', 'Review the plan', '${viewer}'),
			('${filing}', 'file_to_deal', '${id(10)}', 'email', 'I sent the plan.', 'old_system', '${deal}', null, null),
			('${duplicateProposal}', 'file_to_deal', '${id(40)}', 'email', 'I sent the plan.', 'old_system', '${deal}', null, null),
			('${sharedProposal}', 'file_to_deal', '${id(64)}', 'email', 'I sent the plan.', 'old_system', '${deal}', null, null),
			('${partnerProposal}', 'file_to_deal', '${id(60)}', 'email', 'I sent the plan.', 'old_system', '${deal}', null, null);
		insert into reply_draft (id, email_activity_id, owner_user_id, proposed_by_job, subject, body, evidence)
		values ('${draft}', '${id(10)}', '${viewer}', 'old_system', 'Re: Suite plan', 'Thanks.', 'I sent the plan.'),
			('${duplicateDraft}', '${id(41)}', '${viewer}', 'old_system', 'Re: Suite plan', 'Thanks.', 'I sent the plan.');
		commit;`);
});

after(async () => {
	await db.query("rollback");
	await cleanup();
});

async function thread(path = `proposals/${followUp}`) {
	const response = await request(caller, path, {
		method: "GET",
	});
	assert.equal(response.status, 200, path);
	const detail: unknown = await response.json();
	assert.ok(isArguments(detail) && Array.isArray(detail.thread), path);
	return detail.thread.filter(isArguments);
}

const entry = (activity: number, body: string, folded: string | null) => ({
	activity_id: id(activity),
	body,
	folded,
});

test("shows one exact Message-ID across mailbox copies and joins its single missing-ID match", async () => {
	const entries = (await thread())
		.filter(({ activity_id }) =>
			[10, 11, 12, 13, 14, 15].some((n) => activity_id === id(n)),
		)
		.map(({ activity_id, body, folded }) => ({ activity_id, body, folded }));
	assert.deepEqual(entries, [
		entry(11, authored, history),
		entry(14, captured, null),
		entry(13, captured, null),
	]);
});

test("keeps an ambiguous message, case-distinct IDs and empty captures separate", async () => {
	const entries = (await thread()).filter(({ activity_id }) =>
		[19, 20, 21, 22, 23, 24].some((n) => activity_id === id(n)),
	);
	assert.deepEqual(
		entries.map(({ activity_id }) => activity_id),
		[20, 21, 22, 23, 24].map(id),
	);
	assert.partialDeepStrictEqual(entries[0], entry(20, "", carried));
	assert.partialDeepStrictEqual(entries[1], entry(21, carried, null));
});

test("a thread leaves out messages from another mailbox and shows unsplit bodies as stored", async () => {
	const entries = (await thread())
		.filter(({ activity_id }) =>
			[25, 30, 31, 32].some((n) => activity_id === id(n)),
		)
		.map(({ activity_id, body, folded }) => ({ activity_id, body, folded }));
	assert.deepEqual(entries, [
		entry(30, `The keys are ready.\n${footer}`, null),
		entry(32, `Will do.\n> ${privateQuote}\n${footer}`, null),
	]);
});

test("Home follow-up, email filing and draft reviews show the same grouped thread", async () => {
	const entries = await thread();
	assert.deepEqual(
		entries.map(({ activity_id }) => activity_id),
		[11, 14, 13, 20, 21, 22, 23, 24, 30, 32].map(id),
	);
	assert.deepEqual(await thread(`proposals/${filing}`), entries);
	assert.deepEqual(await thread(`reply-drafts/${draft}`), entries);
});

test("a proposal and draft on different copies identify the same displayed email", async () => {
	const [proposalStatus, proposal] = await save(
		caller,
		`proposals/${duplicateProposal}`,
		{},
		"GET",
	);
	const [draftStatus, reply] = await save(
		caller,
		`reply-drafts/${duplicateDraft}`,
		{},
		"GET",
	);
	assert.equal(proposalStatus, 200);
	assert.equal(draftStatus, 200);
	assert.partialDeepStrictEqual(proposal, {
		proposal_id: duplicateProposal,
		source_activity: { id: id(41), subject: "Suite plan" },
	});
	assert.partialDeepStrictEqual(reply, {
		draft_id: duplicateDraft,
		source_activity: { id: id(41), subject: "Suite plan" },
	});
	assert.ok(Array.isArray(proposal.thread));
	assert.equal(proposal.thread.length, 1);
	assert.partialDeepStrictEqual(
		proposal.thread[0],
		entry(41, authored, history),
	);
	assert.deepEqual(reply.thread, proposal.thread);
});

test("names a message from a partner's mailbox address by the partner, not its display name", async () => {
	const names = (await thread(`proposals/${partnerProposal}`)).map(
		({ sender_name }) => sender_name,
	);
	assert.deepEqual(names, [null, "Dell"]);
});

test("reads a thread when one address belongs to two partners, naming no partner", async () => {
	const names = (await thread(`proposals/${sharedProposal}`)).map(
		({ sender_name }) => sender_name,
	);
	assert.deepEqual(names, ["Casey Example", "Riley Outsider"]);
});

test("keeps the display name of a sender who is not a partner", async () => {
	const names = (await thread(`proposals/${sharedProposal}`)).map(
		({ sender_name }) => sender_name,
	);
	assert.equal(names[1], "Riley Outsider");
});
