import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { withPartnerAuth } from "./partner-auth.ts";
import { isArguments } from "./save-door.ts";
import { copyTest, readSchema } from "./test-copy.ts";
import { partnerApp } from "./worker.ts";

const { db, setup, cleanup, connectionString } = copyTest();
const appOrigin = "https://app.example.test";
const secret = randomBytes(32).toString("hex");
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ref = (payload: string) =>
	`al1_${Buffer.from(payload).toString("base64url")}`;
const joe = id(1);
const dell = id(2);
const lead = id(3);
const linkedLead = id(4);
const oldLead = id(5);
const leadDraft = id(6);
const linkedDraft = id(7);
const deal = id(8);
const call = id(9);
const proposal = id(10);
const finishedCall = id(11);
const finishedProposal = id(12);
const unknown = id(99);
const reply = (n: number) => ref(`rd:${id(n)}:joe:17`);
const callRef = (callId: string) => ref(`cr:${callId}:old_version`);

let joeCookie: string;
let dellCookie: string;

async function signIn(slug: string, owner: string) {
	await db.query(
		`insert into doctorcre_auth."user"
		(id, partner_user_id, name, email, "emailVerified", "createdAt", "updatedAt")
		values ($1, $2, 'Example Partner', $1 || '@example.test', true, now(), now())`,
		[slug, owner],
	);
	await db.query(
		`insert into doctorcre_auth.account
		(id, "userId", "providerId", "accountId", "createdAt", "updatedAt")
		values ($1, $1, 'google', $1, now(), now())`,
		[slug],
	);
	const { token } = await withPartnerAuth(
		{ appOrigin, connectionString, secret },
		async ({ auth }) =>
			(await auth.$context).internalAdapter.createSession(slug),
	);
	const signature = createHmac("sha256", secret).update(token).digest("base64");
	return `__Host-doctorcre_session=${encodeURIComponent(`${token}.${signature}`)}`;
}

const request = (path: string, cookie = joeCookie) =>
	partnerApp.request(
		`${appOrigin}/api/engine/${path}`,
		{ headers: { Cookie: cookie } },
		{
			DATABASE: { connectionString },
			PARTNER_AUTH_DATABASE: { connectionString },
			PARTNER_APP_ORIGIN: appOrigin,
			PARTNER_AUTH_SECRET: secret,
			HOME_INBOX_READ_SCHEMA: "next",
			LEADS_READ_SCHEMA: "next",
		},
	);
const open = (reference: string, cookie?: string) =>
	request(`action-links/${reference}`, cookie);

async function json(response: Response) {
	const value = await response.json();
	assert.ok(isArguments(value));
	return value;
}

before(async () => {
	await setup();
	await db.query("drop table next.doc_link");
	await db.query(await readSchema("partner-auth.sql"));
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into how_found (slug, label) values ('referral', 'Referral');
		insert into role (slug, label) values ('lead', 'Lead'), ('client', 'Client');
		insert into stage (role, slug, label) values ('lead', 'new', 'New');
		insert into party (id, kind, name, how_found) values
			('${joe}', 'person', 'Example Partner One', null),
			('${dell}', 'person', 'Example Partner Two', null),
			('${lead}', 'person', 'Example Lead', 'referral'),
			('${linkedLead}', 'person', 'Example Client', 'referral');
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell');
		insert into party_role (party_id, role, stage, owner_user_id) values
			('${lead}', 'lead', 'new', '${dell}'), ('${linkedLead}', 'lead', 'new', '${joe}'),
			('${linkedLead}', 'client', null, null);
		insert into client (party_id) values ('${linkedLead}');
		insert into outside_id (source, value, party_id) values
			('old_system_lead', '${oldLead}', '${lead}'),
			('old_system_lead', '${id(98)}', '${lead}');
		insert into lead_contact_draft (id, party_id, owner_user_id, subject, body, scheduled_for, time_zone)
			values ('${leadDraft}', '${lead}', '${dell}', 'Introduction', 'Hello', now(), 'UTC'),
				('${linkedDraft}', '${linkedLead}', '${joe}', 'Introduction', 'Hello', now(), 'UTC');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Deal', '${dell}');
		insert into activity (id, kind, happened_at) values
			('${call}', 'call', '2026-01-01T12:00Z'), ('${finishedCall}', 'call', '2026-01-01T12:00Z'),
			('${id(20)}', 'email', '2026-01-01T12:00Z'), ('${id(21)}', 'email', '2026-01-01T12:00Z'),
			('${id(22)}', 'email', '2026-01-02T12:00Z'), ('${id(23)}', 'email', '2026-01-01T12:00Z'),
			('${id(24)}', 'email', '2026-01-01T12:00Z'), ('${id(25)}', 'email', '2026-01-03T12:00Z');
		insert into activity_about (activity_id, deal_id)
			select id, '${deal}' from activity;
		insert into proposal (id, activity_id, activity_kind, deal_id, kind, owner_party_id, what, evidence, proposed_by_job)
			values ('${proposal}', '${call}', 'call', '${deal}', 'next_step', '${joe}', 'Confirm timing', 'Timing', 'old_system'),
				('${finishedProposal}', '${finishedCall}', 'call', '${deal}', 'next_step', '${joe}', 'Confirm date', 'Date', 'old_system');
		insert into email (activity_id, message_id, sender, subject, body, conversation_id)
			select id, '<' || id || '@example.test>', 'sender@example.test', 'Example', 'Please reply',
				case when id in ('${id(21)}', '${id(22)}', '${id(25)}') then 'ExampleThread' end
			from activity where kind = 'email';
		insert into email_mailbox (activity_id, user_id)
			select activity_id, case when activity_id in ('${id(24)}', '${id(25)}') then '${dell}' else '${joe}' end::uuid
			from email;
		insert into reply_draft (id, email_activity_id, owner_user_id, proposed_by_job, evidence, subject, body)
			select id, id, '${joe}', 'old_system', 'Please reply', 'Reply', 'Hello'
			from activity where kind = 'email';
		select set_config('engine.job', '', true), set_config('engine.user_id', '${joe}', true);
		update reply_draft set body = 'Current revision' where id = '${id(20)}';
		update reply_draft set status = 'dismissed', decided_at = now(),
			dismiss_reason = 'Replaced by a newer reply draft in this conversation' where id = '${id(21)}';
		update reply_draft set status = 'dismissed', decided_at = now(),
			dismiss_reason = 'Reply declined' where id = '${id(23)}';
		update proposal set status = 'dismissed', decided_at = now(), decided_by_user_id = '${joe}'
			where id = '${finishedProposal}';
		commit;`);
	joeCookie = await signIn("joe", joe);
	dellCookie = await signIn("dell", dell);
});
after(cleanup);

test("a reply link opens the current pending revision or its visible pending successor", async () => {
	const counts = () =>
		db.query(
			"select (select count(*) from reply_draft) as drafts, (select count(*) from change) as changes",
		);
	const before = (await counts()).rows;
	const target = (n: number) => ({
		kind: "reply_draft",
		path: `/api/engine/home/cards/reply_draft:${id(n)}`,
	});
	for (const [original, current] of [
		[20, 20],
		[21, 22],
		[20, 20],
	] as const) {
		const response = await open(reply(original));
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("cache-control"), "no-store");
		assert.deepEqual(await response.json(), target(current));
		const home = await request(`home/cards/reply_draft:${id(current)}`);
		assert.equal(home.status, 200);
		assert.equal((await json(home)).reply_draft_id, id(current));
	}
	const detail = await request(`reply-drafts/${id(20)}`);
	assert.equal(detail.status, 200);
	assert.equal((await json(detail)).version, 2);
	assert.deepEqual((await counts()).rows, before);
});

test("a lead draft link opens the shared lead using the board's legacy ID", async () => {
	const response = await open(ref(`ld:${leadDraft}`));
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), {
		kind: "lead",
		path: `/leads?lead=${oldLead}`,
	});
	const drawer = await request(`leads?lead_id=${oldLead}`);
	assert.equal(drawer.status, 200);
	const { detail } = await json(drawer);
	assert.ok(isArguments(detail));
	assert.equal(detail.party_id, lead);
});

test("a call link opens its pending review on the copied deal", async () => {
	const response = await open(callRef(call));
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), {
		kind: "call_review",
		path: `/api/engine/home/cards/suggestion:${proposal}`,
		deal_id: deal,
		activity_id: call,
	});
	const home = await request(`home/cards/suggestion:${proposal}`);
	assert.equal(home.status, 200);
	const { source_activity } = await json(home);
	assert.ok(isArguments(source_activity));
	assert.equal(source_activity.id, call);
});

async function unavailable(reference: string, cookie?: string) {
	const response = await open(reference, cookie);
	assert.equal(response.status, 404);
	const { correlation_id, ...body } = await json(response);
	assert.equal(typeof correlation_id, "string");
	assert.deepEqual(body, {
		error: "action_link_unavailable",
		hint: "This link is no longer available.",
	});
}

test("finished, inaccessible, missing and retired links give the same answer", async () => {
	await unavailable(reply(20), dellCookie);
	await unavailable(ref(`rd:${id(20)}:dell:17`));
	await unavailable(reply(23));
	await unavailable(reply(24));
	await unavailable(ref(`ld:${linkedDraft}`));
	await unavailable(callRef(finishedCall));
	await unavailable(callRef(call), dellCookie);
	await unavailable(callRef(unknown));
	await unavailable(ref(`fe:${call}:1`));
	await unavailable(ref(`ld:${unknown}`));
	await unavailable(ref(`xx:${unknown}`));
	await unavailable("al1_!");
});

test("a saved link requires a PartnerApp session", async () => {
	const response = await open(reply(20), "");
	assert.equal(response.status, 401);
	assert.equal(response.headers.get("cache-control"), "no-store");
});
