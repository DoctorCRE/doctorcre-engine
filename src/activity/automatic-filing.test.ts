import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "../save-door.ts";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, request, save } = doorTest();
const joe = randomUUID();
const dell = randomUUID();
const contact = randomUUID();
const vendorContact = randomUUID();
const ambiguousContact = randomUUID();
const movingContact = randomUUID();
const vendor = randomUUID();
const otherVendor = randomUUID();
const deal = randomUUID();
const otherDeal = randomUUID();
const capture = { job: "mail_capture", for_user: "joe" };
const secondMailbox = { ...capture, for_user: "dell" };
const partner = { user: "joe" };

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${joe}', 'person', 'Example Partner'), ('${dell}', 'person', 'Second Partner'),
			('${contact}', 'person', 'Example Contact'),
			('${vendorContact}', 'person', 'Example Vendor Contact'),
			('${ambiguousContact}', 'person', 'Second Vendor Contact'),
			('${movingContact}', 'person', 'Moving Contact'),
			('${vendor}', 'company', 'Example Vendor'), ('${otherVendor}', 'company', 'Second Vendor');
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell');
		insert into role (slug, label) values ('vendor', 'Vendor');
		insert into party_role (party_id, role) values ('${vendor}', 'vendor'), ('${otherVendor}', 'vendor');
		insert into party_company (person_id, company_id) values
			('${vendorContact}', '${vendor}'), ('${movingContact}', '${vendor}'),
			('${ambiguousContact}', '${vendor}'), ('${ambiguousContact}', '${otherVendor}');
		insert into party_email (party_id, address, label) values
			('${contact}', 'contact@example.test', 'work'),
			('${vendorContact}', 'vendor-contact@example.test', 'work'),
			('${movingContact}', 'moving-contact@example.test', 'work'),
			('${ambiguousContact}', 'ambiguous-contact@example.test', 'work');
		insert into deal (id, name, owner_user_id) values
			('${deal}', 'Example Deal', '${joe}'), ('${otherDeal}', 'Other Deal', '${joe}');
		commit;`);
});
after(cleanup);

const evidence = "Please send the floor plan.";
function mail(
	name: string,
	conversation_id: string,
	about: object[] = [],
	earlier = false,
) {
	return {
		idempotency_key: randomUUID(),
		kind: "email",
		happened_at: earlier ? "2026-11-02T12:00:00Z" : "2026-11-03T12:00:00Z",
		about,
		email: {
			message_id: `${name}@example.test`,
			conversation_id,
			sender: "contact@example.test",
			recipients: [],
			subject: "Floor plan",
			body: evidence,
		},
	};
}

async function store(message: ReturnType<typeof mail>, caller = capture) {
	const [status, email] = await save(caller, "activities", message);
	assert.equal(status, 201);
	const { activity_id, about, replayed } = email;
	assert.ok(typeof activity_id === "string");
	return { activity_id, about, replayed };
}

async function propose(activity_id: string, deal_id = deal) {
	const [status, proposal] = await save(capture, "proposals", {
		idempotency_key: randomUUID(),
		kind: "file_to_deal",
		activity_id,
		deal_id,
		evidence,
	});
	assert.equal(status, 201);
	assert.ok(typeof proposal.proposal_id === "string");
	return proposal.proposal_id;
}

async function cards(...ids: string[]) {
	const response = await request(
		partner,
		"home/inbox",
		{ method: "GET" },
		{
			HOME_INBOX_READ_SCHEMA: "next",
		},
	);
	assert.equal(response.status, 200);
	const payload: unknown = await response.json();
	assert.ok(isArguments(payload) && Array.isArray(payload.items));
	return payload.items
		.filter(isArguments)
		.filter((card) =>
			ids.some((id) => id === card.proposal_id || id === card.reply_draft_id),
		);
}

test("a single-deal thread files once across retries and mailboxes, leaving its reply", async () => {
	const message = mail("reply", "Outlook-reply");
	const first = await store(message);
	const filing = await propose(first.activity_id);
	assert.equal((await cards(filing)).length, 1);
	const [draftStatus, draft] = await save(capture, "reply-drafts", {
		idempotency_key: randomUUID(),
		activity_id: first.activity_id,
		evidence,
		body: "I’ll send it shortly.",
		subject: "Re: Floor plan",
	});
	assert.equal(draftStatus, 201);
	assert.ok(typeof draft.draft_id === "string");
	await store(mail("earlier", "Outlook-reply", [{ deal_id: deal }], true));
	await store(
		mail("earlier-other", "Outlook-other", [{ deal_id: otherDeal }], true),
	);
	const retry = { ...message, idempotency_key: randomUUID() };
	const copies = await Promise.all([
		store(retry),
		store(
			{
				...message,
				idempotency_key: randomUUID(),
				email: { ...message.email, conversation_id: "Outlook-other" },
			},
			secondMailbox,
		),
	]);
	for (const copy of copies) {
		assert.equal(copy.activity_id, first.activity_id);
		assert.deepEqual(copy.about, [{ party_id: contact }, { deal_id: deal }]);
	}
	assert.equal((await store(retry)).replayed, true);
	assert.deepEqual(
		(
			await db.query(
				`select
		(select count(*)::int from activity_about where activity_id = $1 and deal_id = $2) as links,
		(select count(*)::int from email_mailbox where activity_id = $1) as mailboxes`,
				[first.activity_id, deal],
			)
		).rows,
		[{ links: 1, mailboxes: 2 }],
	);
	const [reply, extra] = await cards(filing, draft.draft_id);
	assert.ok(reply);
	assert.equal(extra, undefined);
	assert.equal(reply.reply_draft_id, draft.draft_id);
	assert.equal(reply.suggestions, undefined);
	const { rows } = await db.query("select status from proposal where id = $1", [
		filing,
	]);
	assert.deepEqual(rows, [{ status: "pending" }]);
});

test("capture can file an unknown sender through the exact conversation ID alone", async () => {
	await store(mail("exact-parent", "Outlook-Exact", [{ deal_id: deal }], true));
	const message = mail("exact-child", "Outlook-Exact");
	message.email.sender = "unknown@example.test";
	const filed = await store(message);
	assert.deepEqual(filed.about, [{ deal_id: deal }]);
	const redundant = await propose(filed.activity_id);
	assert.deepEqual(await cards(redundant), []);
	const different = mail("different", "Outlook-exact");
	assert.deepEqual((await store(different)).about, [{ party_id: contact }]);
});

test("one current vendor contact files there while two vendor matches leave the filing question", async () => {
	const single = mail("single-vendor", "Vendor");
	single.email.sender = "vendor-contact@example.test";
	const known = await store(single);
	assert.deepEqual(
		known.about,
		[vendorContact, vendor].sort().map((party_id) => ({ party_id })),
	);
	const differentDeal = await propose(known.activity_id);
	assert.equal((await cards(differentDeal)).length, 1);

	const multiple = mail("two-vendors", "Vendors");
	multiple.email.sender = "ambiguous-contact@example.test";
	const ambiguous = await store(multiple);
	const filing = await propose(ambiguous.activity_id);
	assert.deepEqual(ambiguous.about, [{ party_id: ambiguousContact }]);
	assert.equal((await cards(filing)).length, 1);
});

test("another mailbox copy keeps the vendor filed before the sender moved", async () => {
	const message = mail("vendor-move", "Outlook-vendor-move");
	message.email.sender = "moving-contact@example.test";
	const first = await store(message);
	const about = [vendor, movingContact]
		.sort()
		.map((party_id) => ({ party_id }));
	assert.deepEqual(first.about, about);
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		update party_company set ended_on = '2026-11-04'
			where person_id = '${movingContact}' and company_id = '${vendor}';
		insert into party_company (person_id, company_id) values
			('${movingContact}', '${otherVendor}');
		commit;`);
	const copy = { ...message, idempotency_key: randomUUID() };
	const second = await store(copy, secondMailbox);
	assert.equal(second.activity_id, first.activity_id);
	assert.deepEqual(second.about, about);
	await store(
		mail("vendor-move-deal", "Outlook-vendor-move", [{ deal_id: deal }], true),
	);
	const filed = await store({ ...message, idempotency_key: randomUUID() });
	assert.deepEqual(filed.about, [...about, { deal_id: deal }]);
});

test("a newer stored conflicting deal leaves a backfill unfiled", async () => {
	const conversation = "Outlook-backfill";
	await store(mail("oldest", conversation, [{ deal_id: deal }], true));
	await store({
		...mail("newest", conversation, [{ deal_id: otherDeal }]),
		happened_at: "2026-11-04T12:00:00Z",
	});
	const backfill = mail("backfill", conversation);
	backfill.email.sender = "vendor-contact@example.test";
	assert.deepEqual((await store(backfill)).about, [
		{ party_id: vendorContact },
	]);
});

test("a conflicting explicit deal on another mailbox copy keeps the original filing", async () => {
	const message = mail("duplicate-conflict", "Outlook-duplicate-conflict", [
		{ deal_id: deal },
	]);
	const first = await store(message);
	const copy = await store(
		{
			...message,
			idempotency_key: randomUUID(),
			about: [{ deal_id: otherDeal.toUpperCase() }],
		},
		secondMailbox,
	);
	assert.equal(copy.activity_id, first.activity_id);
	assert.deepEqual(copy.about, [{ deal_id: deal }, { party_id: contact }]);
});

for (const conflict of ["two thread deals", "a different existing deal"]) {
	test(`${conflict} leaves the filing question open`, async () => {
		const conversation = `Outlook-${conflict}`;
		await store(
			mail(
				`first-${conversation.replaceAll(" ", "-")}`,
				conversation,
				[{ deal_id: deal }],
				true,
			),
		);
		const ambiguous = conflict === "two thread deals";
		if (ambiguous)
			await store(
				mail(
					"second-thread-deal",
					conversation,
					[{ deal_id: otherDeal }],
					true,
				),
			);
		const current = await store(
			mail(
				ambiguous ? "ambiguous-thread" : "conflicting-thread",
				conversation,
				ambiguous ? [] : [{ deal_id: otherDeal }],
			),
		);
		assert.deepEqual(
			current.about,
			ambiguous
				? [{ party_id: contact }]
				: [{ deal_id: otherDeal }, { party_id: contact }],
		);
		const filing = await propose(current.activity_id);
		assert.equal((await cards(filing)).length, 1);
		if (!ambiguous) {
			const [status, legacy] = await save(
				capture,
				`activities/${current.activity_id}/about`,
				{ about: [{ deal_id: deal }], idempotency_key: randomUUID() },
			);
			assert.equal(status, 200);
			assert.deepEqual(legacy.about, current.about);
		}
	});
}

test("a partner's unlink prevents filing again and hides the same filing question", async () => {
	const conversation = "Outlook-unlinked";
	await store(mail("unlink-parent", conversation, [{ deal_id: deal }], true));
	const message = mail("unlink-reply", conversation, [{ deal_id: deal }]);
	const saved = await store(message);
	const filing = await propose(saved.activity_id);
	const otherFiling = await propose(saved.activity_id, otherDeal);
	await db.query(`begin; select set_config('engine.user_id', '${joe}', true);
		delete from activity_about where activity_id = '${saved.activity_id}' and deal_id = '${deal}';
		commit;`);
	const again = await store(
		{ ...message, idempotency_key: randomUUID() },
		secondMailbox,
	);
	assert.deepEqual(again.about, [{ party_id: contact }]);
	const [status, legacy] = await save(
		capture,
		`activities/${saved.activity_id.toUpperCase()}/about`,
		{ about: [{ deal_id: deal.toUpperCase() }], idempotency_key: randomUUID() },
	);
	assert.equal(status, 200);
	assert.deepEqual(legacy.about, [{ party_id: contact }]);
	assert.partialDeepStrictEqual(await cards(filing, otherFiling), [
		{ proposal_id: otherFiling, suggestions: [{ id: otherFiling }] },
	]);
});

test("dismissing filing prevents an inherited link on a fresh delivery", async () => {
	const message = mail("dismissed-reply", "Outlook-dismissed");
	const saved = await store(message);
	const filing = await propose(saved.activity_id);
	assert.equal(
		(
			await save(partner, `proposals/${filing}/decision`, {
				idempotency_key: randomUUID(),
				decision: "dismiss",
				reason: "This belongs elsewhere.",
			})
		)[0],
		200,
	);
	await store(
		mail("dismissed-parent", "Outlook-dismissed", [{ deal_id: deal }], true),
	);
	const again = await store(
		{ ...message, idempotency_key: randomUUID() },
		secondMailbox,
	);
	assert.deepEqual(again.about, [{ party_id: contact }]);
	const [status, routed] = await save(
		capture,
		`activities/${saved.activity_id}/about`,
		{ about: [{ deal_id: deal }], idempotency_key: randomUUID() },
	);
	assert.equal(status, 200);
	assert.deepEqual(routed.about, again.about);
	assert.deepEqual(await cards(filing), []);
});
