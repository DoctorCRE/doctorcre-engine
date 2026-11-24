import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { docLinkOwnerTransaction } from "../doc-link.ts";
import { claimDocWork, finishDocJudgment } from "../doc-queue.ts";
import { isArguments } from "../save-door.ts";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, request, save, writerUrl } = doorTest();
const joe = randomUUID();
const dell = randomUUID();
const contact = randomUUID();
const vendorContact = randomUUID();
const ambiguousContact = randomUUID();
const movingContact = randomUUID();
const formerContact = randomUUID();
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
			('${formerContact}', 'person', 'Former Vendor Contact'),
			('${vendor}', 'company', 'Example Vendor'), ('${otherVendor}', 'company', 'Second Vendor');
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell');
		insert into role (slug, label) values ('vendor', 'Vendor');
		insert into party_role (party_id, role) values ('${vendor}', 'vendor'), ('${otherVendor}', 'vendor');
		insert into party_company (person_id, company_id) values
			('${vendorContact}', '${vendor}'), ('${movingContact}', '${vendor}'),
			('${formerContact}', '${vendor}'),
			('${ambiguousContact}', '${vendor}'), ('${ambiguousContact}', '${otherVendor}');
		insert into party_email (party_id, address, label) values
			('${contact}', 'contact@example.test', 'work'),
			('${vendorContact}', 'vendor-contact@example.test', 'work'),
			('${movingContact}', 'moving-contact@example.test', 'work'),
			('${formerContact}', 'former-contact@example.test', 'work'),
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
			recipients: [] as { address: string; kind: "to" }[],
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
	return mailboxCards(partner, ...ids);
}

async function mailboxCards(caller: { user: string }, ...ids: string[]) {
	const response = await request(
		caller,
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

test("judgment files verified facts once across mailboxes and leaves the reply", async () => {
	const thread = "Judged";
	await store(mail("judged-first", thread, [{ deal_id: deal }]));
	await store(mail("judged-second", thread, [{ deal_id: otherDeal }]));
	const message = mail("judged", thread);
	message.email.sender = "vendor-contact@example.test";
	const activity = await captureForJudgment(message);
	assert.equal(await captureForJudgment(message, secondMailbox), activity);
	const filing = await propose(activity);
	const [, draft] = await save(capture, "reply-drafts", {
		idempotency_key: randomUUID(),
		activity_id: activity,
		evidence,
		body: "I’ll send it shortly.",
		subject: "Re: Floor plan",
	});
	assert.ok(typeof draft.draft_id === "string");
	const first = await claimFiling(joe, activity);
	const second = await claimFiling(dell, activity);
	assert.deepEqual(second.destinations, first.destinations);
	const facts = [
		fact("deal", deal, "Floor plan requested"),
		fact("vendor", vendor, "Vendor needs the floor plan"),
	];
	assert.equal(await first.answer(facts), 204);
	assert.equal(await first.answer(facts), 404);
	assert.equal(await second.answer(facts), 204);
	const { rows } = await db.query(
		`select summary, a.changed_by_job, a.changed_for_user_id, b.deal_id, b.party_id
		from activity a join activity_about b on b.activity_id = a.id
		where summary in ($1, $2) order by summary`,
		facts.map(({ text }) => text),
	);
	assert.deepEqual(rows, [
		{
			summary: "Floor plan requested",
			changed_by_job: "mail_capture",
			changed_for_user_id: joe,
			deal_id: deal,
			party_id: null,
		},
		{
			summary: "Vendor needs the floor plan",
			changed_by_job: "mail_capture",
			changed_for_user_id: joe,
			deal_id: null,
			party_id: vendor,
		},
	]);
	assert.equal(
		(
			await db.query(
				`select from save_receipt where verb = 'file-email-facts'
		and answer->>'source_activity_id' = $1 and jsonb_array_length(answer->'facts') = 2`,
				[activity],
			)
		).rowCount,
		1,
	);
	const [reply, extra] = await cards(filing, draft.draft_id);
	assert.equal(extra, undefined);
	assert.equal(reply?.reply_draft_id, draft.draft_id);
	assert.equal(reply?.suggestions, undefined);
});

for (const reason of ["unlink", "dismissal", "conflict", "unverified"]) {
	test(`judgment saves no facts after ${reason}`, async () => {
		const conflict = reason === "conflict";
		const unresolved = conflict || reason === "unverified";
		const thread = `Judgment ${reason}`;
		if (conflict) {
			await store(mail("judge-first", thread, [{ deal_id: deal }]));
			await store(mail("judge-conflicting", thread, [{ deal_id: otherDeal }]));
		}
		const activity = await captureForJudgment(
			mail(`judge-${reason}`, thread, conflict ? [] : [{ deal_id: deal }]),
		);
		const claim = await claimFiling(joe, activity);
		if (reason === "unlink")
			await db.query(`begin; select set_config('engine.user_id', '${joe}', true);
				delete from activity_about where activity_id = '${activity}' and deal_id = '${deal}'; commit`);
		if (reason === "dismissal") {
			const proposal = await propose(activity);
			const [status] = await save(partner, `proposals/${proposal}/decision`, {
				idempotency_key: randomUUID(),
				decision: "dismiss",
				reason: "It belongs elsewhere.",
			});
			assert.equal(status, 200);
		}
		const text = `Fact for ${reason}`;
		const facts = [
			fact("deal", reason === "unverified" ? otherDeal : deal, text),
		];
		if (conflict) facts.push(fact("deal", otherDeal, text));
		assert.equal(await claim.answer(facts), unresolved ? 422 : 204);
		assert.equal(
			await claim.finish({ kind: "failed" }),
			unresolved ? 204 : 404,
		);
		assert.equal(
			(await db.query("select from activity where summary = $1", [text]))
				.rowCount,
			0,
		);
		const { rows } = await db.query<{ id: string }>(
			"select id from proposal where activity_id = $1 and status = 'pending'",
			[activity],
		);
		const reviews = await cards(...rows.map(({ id }) => id));
		assert.equal(reviews.length, unresolved ? 1 : 0);
		if (unresolved)
			assert.equal(reviews[0]?.title, "Review where to file this email");
	});
}

const fact = (kind: string, id: string, text: string) => ({
	destination: { kind, id },
	text,
	quote: evidence,
});

async function filingProposals(activity: string) {
	const { rows } = await db.query<{ id: string }>(
		"select id from proposal where activity_id = $1 and status = 'pending'",
		[activity],
	);
	return rows.map(({ id }) => id);
}

test("a new legacy correction can move an email after a partner filed it", async () => {
	const { activity_id } = await store(mail("correction", "Filing correction"));
	const filing = await propose(activity_id);
	const accept = (proposalId: string, destination: string) =>
		save(partner, `proposals/${proposalId}/decision`, {
			idempotency_key: randomUUID(),
			decision: "accept",
			deal_id: destination,
			reason: "Partner selected this deal.",
		});
	assert.equal((await accept(filing, deal))[0], 200);

	const [created, { proposal_id: correction }] = await save(
		capture,
		"proposals",
		{
			idempotency_key: randomUUID(),
			kind: "possible_new_deal",
			activity_id,
			evidence,
		},
	);
	assert.equal(created, 201);
	assert.ok(typeof correction === "string");
	const review = await cards(correction);
	const [corrected, outcome] = await accept(correction, otherDeal);
	assert.equal(corrected, 200, JSON.stringify(outcome));
	assert.equal(review.length, 1);
	assert.deepEqual(
		(
			await db.query(
				"select deal_id from activity_about where activity_id = $1 and deal_id is not null",
				[activity_id],
			)
		).rows,
		[{ deal_id: otherDeal }],
	);
});

for (const decision of ["dismiss", "accept"]) {
	test(`a partner's ${decision} settles filing for an already claimed second copy`, async () => {
		const message = mail(`shared-${decision}`, `Shared filing ${decision}`);
		message.email.sender = "ambiguous-contact@example.test";
		if (decision === "accept") {
			await store(
				mail(
					"shared-parent",
					message.email.conversation_id,
					[{ deal_id: deal }],
					true,
				),
			);
		}
		const activity = await captureForJudgment(message);
		assert.equal(await captureForJudgment(message, secondMailbox), activity);
		const pendingDeal = await propose(activity, otherDeal);
		const first = await claimFiling(joe, activity);
		const second = await claimFiling(dell, activity);
		assert.equal(await first.answer([]), 204);
		const proposal = (await filingProposals(activity)).find(
			(id) => id !== pendingDeal,
		);
		assert.ok(proposal);
		assert.equal(
			(
				await save(partner, `proposals/${proposal}/decision`, {
					idempotency_key: randomUUID(),
					decision,
					reason: "Reviewed by the mailbox partner.",
					...(decision === "accept" && { deal_id: deal }),
				})
			)[0],
			200,
		);
		const remaining = await mailboxCards({ user: "dell" }, pendingDeal);
		const [status, refusal] = await save(
			{ user: "dell" },
			`proposals/${pendingDeal}/decision`,
			{
				idempotency_key: randomUUID(),
				decision: "accept",
				reason: "File on the other deal.",
			},
		);
		const text = `Second copy after ${decision}`;
		assert.equal(await second.answer([fact("vendor", vendor, text)]), 204);
		assert.deepEqual(
			{ cards: remaining.length, status, error: refusal.error },
			{ cards: 0, status: 409, error: "already_decided" },
		);
		assert.deepEqual(
			(
				await db.query(
					"select status, decided_by_user_id from proposal where id = $1",
					[pendingDeal],
				)
			).rows,
			[{ status: "superseded", decided_by_user_id: joe }],
		);
		assert.equal(
			(await db.query("select from activity where summary = $1", [text]))
				.rowCount,
			0,
		);
		assert.equal(
			(
				await db.query(
					"select from activity_about where activity_id = $1 and party_id = $2",
					[activity, vendor],
				)
			).rowCount,
			0,
		);
		assert.deepEqual(await filingProposals(activity), []);
		assert.deepEqual(await mailboxCards({ user: "dell" }, proposal), []);
	});
}

test("an affiliation ending before the email was sent leaves filing for review", async () => {
	const message = mail("former-contact", "Former vendor");
	message.email.sender = "former-contact@example.test";
	const activity = await captureForJudgment(message);
	const claim = await claimFiling(joe, activity);
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		update party_company set ended_on = '2026-11-02'
		where person_id = '${formerContact}' and company_id = '${vendor}'; commit`);
	const text = "Fact for a former affiliation";
	assert.equal(await claim.answer([fact("vendor", vendor, text)]), 204);
	assert.equal(
		(await db.query("select from activity where summary = $1", [text]))
			.rowCount,
		0,
	);
	assert.partialDeepStrictEqual(
		await cards(...(await filingProposals(activity))),
		[
			{
				title: "Review where to file this email",
				primary_action: "Choose vendor",
			},
		],
	);
});

test("a vendor-only fallback offers and accepts a vendor choice", async () => {
	const message = mail("vendor-review", "Vendor filing review");
	message.email.sender = "ambiguous-contact@example.test";
	const activity = await captureForJudgment(message);
	assert.equal(await (await claimFiling(joe, activity)).answer([]), 204);
	const [proposal] = await filingProposals(activity);
	assert.ok(proposal);
	assert.partialDeepStrictEqual(await cards(proposal), [
		{
			title: "Review where to file this email",
			primary_action: "Choose vendor",
		},
	]);
	const [status, detail] = await save(
		partner,
		`proposals/${proposal}`,
		{},
		"GET",
	);
	assert.equal(status, 200);
	assert.deepEqual(detail.filing_choices, [
		{ kind: "vendor", label: "Choose vendor" },
	]);
	const selectedVendor = randomUUID();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${selectedVendor}', 'company', 'Selected Vendor');
		insert into party_role (party_id, role) values ('${selectedVendor}', 'vendor');
		commit`);
	const decide = (target: object) =>
		save(partner, `proposals/${proposal}/decision`, {
			idempotency_key: randomUUID(),
			decision: "accept",
			...target,
		});
	assert.equal(
		(await decide({ deal_id: deal, reason: "Review the target." }))[0],
		422,
	);
	assert.equal((await decide({ vendor_id: selectedVendor }))[0], 200);
	assert.equal(
		(
			await db.query(
				"select from activity_about where activity_id = $1 and party_id = $2",
				[activity, selectedVendor],
			)
		).rowCount,
		1,
	);
	assert.deepEqual(await cards(proposal), []);
	const survivor = randomUUID();
	await db.query("begin");
	try {
		await db.query(`select set_config('engine.user_id', '${joe}', true);
			insert into party (id, kind, name) values ('${survivor}', 'company', 'Surviving Vendor');
			select merge_party('${selectedVendor}', '${survivor}');`);
		const { rows } = await db.query(
			`select p.filed_vendor_id from proposal p join activity_about a
				on a.activity_id = p.activity_id and a.party_id = p.filed_vendor_id
				where p.id = $1 and p.status = 'accepted' and p.decided_by_user_id = $2`,
			[proposal, joe],
		);
		assert.deepEqual(rows, [{ filed_vendor_id: survivor }]);
	} finally {
		await db.query("rollback");
	}
});

test("Home offers both filing choices when the email has both kinds of destination", async () => {
	const thread = "Mixed filing review";
	await store(mail("mixed-parent", thread, [{ deal_id: deal }], true));
	const message = mail("mixed-review", thread);
	message.email.sender = "vendor-contact@example.test";
	const activity = await captureForJudgment(message);
	assert.equal(await (await claimFiling(joe, activity)).answer([]), 204);
	assert.partialDeepStrictEqual(
		await cards(...(await filingProposals(activity))),
		[
			{
				title: "Review where to file this email",
				primary_action: "Review filing",
				filing_choices: [
					{ kind: "deal", label: "Choose deal" },
					{ kind: "vendor", label: "Choose vendor" },
				],
			},
		],
	);
});

test("judgment can file to a vendor the sender worked for on the sent date", async () => {
	const sender = randomUUID();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${sender}', 'person', 'Previous Contact');
		insert into party_email (party_id, address, label) values ('${sender}', 'previous@example.test', 'work');
		insert into party_company (person_id, company_id, started_on, ended_on)
			values ('${sender}', '${vendor}', '2026-11-01', '2026-11-03');
		commit`);
	const message = mail("historic-vendor", "Historical vendor");
	message.email.sender = "previous@example.test";
	const activity = await captureForJudgment(message);
	const text = "Fact for the vendor on the sent date";
	assert.equal(
		await (await claimFiling(joe, activity)).answer([
			fact("vendor", vendor, text),
		]),
		204,
	);
	assert.equal(
		(await db.query("select from activity where summary = $1", [text]))
			.rowCount,
		1,
	);
});

test("a completed judgment's vendor destination follows a vendor merge", async () => {
	const message = mail("merge-judgment", "Merge filing vendor");
	message.email.sender = "vendor-contact@example.test";
	const activity = await captureForJudgment(message);
	const claim = await claimFiling(joe, activity);
	assert.deepEqual(claim.destinations, [{ kind: "vendor", id: vendor }]);
	assert.equal(
		await claim.answer([
			fact("vendor", vendor, "Send the merged vendor a plan"),
		]),
		204,
	);
	await db.query("begin");
	try {
		await db.query(`select set_config('engine.user_id', '${joe}', true);
			select merge_party('${vendor}', '${otherVendor}');
			set constraints all immediate;`);
		const { rows } = await db.query(
			`select j.state, d.vendor_id from doc_judgment_job j
			join doc_judgment_destination d on d.job_id = j.id
			where j.activity_id = $1`,
			[activity],
		);
		assert.deepEqual(rows, [{ state: "answered", vendor_id: otherVendor }]);
	} finally {
		await db.query("rollback");
	}
});

async function captureForJudgment(
	message: ReturnType<typeof mail>,
	caller = capture,
) {
	const response = await request(
		caller,
		"activities",
		{
			method: "POST",
			body: JSON.stringify({ ...message, idempotency_key: randomUUID() }),
		},
		{ EMAIL_FILING_JUDGMENT: "true" },
	);
	assert.equal(response.status, 201);
	const body: unknown = await response.json();
	assert.ok(isArguments(body) && typeof body.activity_id === "string");
	return body.activity_id;
}

async function claimFiling(owner: string, activity: string) {
	await db.query(
		"update doc_judgment_job set state = 'failed' where kind = 'email_summary' and state = 'queued'",
	);
	const work = await docLinkOwnerTransaction(writerUrl, owner, (tx) =>
		claimDocWork(tx, owner, "mac_with_judgment"),
	);
	assert.ok(work?.kind === "email_filing", "expected a queued filing claim");
	assert.equal(work.activity_id, activity);
	const finish = (outcome: object) =>
		docLinkOwnerTransaction(writerUrl, owner, (tx) =>
			finishDocJudgment(tx, owner, work.claim_id, outcome),
		);
	return {
		destinations: work.destinations,
		finish,
		answer: (facts: object[]) =>
			finish({ kind: "answered", result: { facts } }),
	};
}

test("mail sent by either partner still queues filing but asks neither partner", async () => {
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party_email (party_id, address, label) values
			('${joe}', 'first-partner@example.test', 'work'), ('${dell}', 'second-partner@example.test', 'work');
		commit;`);
	const senders = [
		"first-partner@example.test",
		"second-partner@example.test",
		"contact@example.test",
	];
	const shown = [];
	for (const [index, sender] of senders.entries()) {
		const thread = `Sent mail ${index}`;
		await store(mail(`sent-${index}-first`, thread, [{ deal_id: deal }], true));
		await store(
			mail(`sent-${index}-second`, thread, [{ deal_id: otherDeal }], true),
		);
		const message = mail(`sent-${index}`, thread);
		message.email.sender = sender;
		message.email.recipients = [
			{ address: "vendor-contact@example.test", kind: "to" },
		];
		const activity = await captureForJudgment(message);
		assert.equal(await captureForJudgment(message, secondMailbox), activity);
		const { rows } = await db.query<{ owner_user_id: string }>(
			"select owner_user_id from doc_judgment_job where kind = 'email_filing' and activity_id = $1 order by owner_user_id",
			[activity],
		);
		assert.deepEqual(
			rows.map((row) => row.owner_user_id),
			[joe, dell].sort(),
		);
		const filing = await propose(activity);
		shown.push([
			(await cards(filing)).length,
			(await mailboxCards({ user: "dell" }, filing)).length,
		]);
	}
	assert.deepEqual(shown, [
		[0, 0],
		[0, 0],
		[1, 1],
	]);
});
