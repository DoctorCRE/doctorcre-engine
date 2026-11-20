import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "../save-door.ts";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, request, readerUrl } = doorTest();
const [legacyId, aliasId] = [randomUUID(), randomUUID()].sort();
const [partner, copied, fresh, converted, oldOwner, mail, call, meeting, move] =
	Array.from({ length: 9 }, () => randomUUID());

before(async () => {
	await setup();
	await db.query(`grant select on public.actor, public.party, public.practice_origination_event,
		public.practice_origination_feed, public.v_lead_workspace, public.v_lead_prospect_engagement,
		public.v_record_flag_subject, public.v_ref_index, public.v_lead_workspace_correspondence
		to ${new URL(readerUrl).username}`);
	await db.query(`begin;
		insert into public.actor (id, slug, kind, display_name)
			values ('${partner}', 'dell', 'human', 'Example Partner'),
				('${oldOwner}', 'legacy-owner', 'human', 'Former Owner');
		insert into public.contact_state (slug, label, sort, contactable) values ('active', 'Active', 1, true);
		insert into public.lead_stage (slug, label) values ('new', 'New');
		insert into public.party (id, kind, name, created_by, updated_by)
			values ('${copied}', 'person', 'Example Copied Lead', '${partner}', '${partner}');
		insert into public.lead (id, party_id, stage, owner_id, created_by, updated_by)
			values ('${legacyId}', '${copied}', 'new', '${oldOwner}', '${partner}', '${partner}');
		set local engine.job = 'old_system';
		insert into how_found (slug, label) values ('referral', 'Referral');
		insert into party (id, kind, name, how_found) values
			('${partner}', 'person', 'Example Partner', null),
			('${copied}', 'person', 'Example Copied Lead', 'referral'),
			('${fresh}', 'company', 'Example Fresh Lead', 'referral'),
			('${converted}', 'company', 'Example Converted Lead', 'referral');
		insert into app_user (id, slug) values ('${partner}', 'dell');
		set local engine.job = '';
		set local engine.user_id = '${partner}';
		insert into role (slug, label) values ('lead', 'Lead'), ('client_contact', 'Client contact');
		insert into stage (role, slug, label) values
			('lead', 'new', 'New'), ('lead', 'qualified', 'Qualified'),
			('lead', 'opportunity', 'Opportunity');
		insert into party_role (party_id, role, stage, owner_user_id) values
			('${copied}', 'lead', 'new', '${partner}'),
			('${fresh}', 'lead', 'opportunity', null),
			('${converted}', 'lead', 'opportunity', null);
		with added as (insert into deal (name, owner_user_id)
			values ('Example Deal', '${partner}') returning id)
		insert into deal_party (deal_id, party_id, role)
			select id, '${converted}', 'client_contact' from added;
		insert into outside_id (source, value, party_id) values
			('old_system', '${copied}', '${copied}'),
			('old_system_lead', '${legacyId}', '${copied}'),
			('old_system_lead', '${aliasId}', '${copied}');
		insert into party_email (party_id, address, label, is_primary)
			values ('${copied}', 'lead@example.test', 'work', true);
		insert into activity (id, kind, happened_at, summary, reached) values
			('${mail}', 'email', '2026-04-01', null, null),
			('${call}', 'call', '2026-04-02', 'New call', true),
			('${meeting}', 'meeting', '2026-04-03', 'New meeting', null);
		insert into activity_about (activity_id, party_id) values
			('${mail}', '${copied}'), ('${call}', '${copied}'), ('${meeting}', '${copied}');
		insert into email (activity_id, message_id, sender, subject, body)
			values ('${mail}', '<mail@example.test>', 'lead@example.test', 'New email', 'New message');
		insert into lead_stage_move (id, party_id, from_stage, to_stage, activity_id, evidence_ref, strength, reason)
			values ('${move}', '${copied}', 'new', 'qualified', '${call}', 'Example reference', 'strong', 'New evidence');
		commit;`);
});
after(async () => {
	await db.query("rollback");
	await cleanup();
});

function record(value: unknown) {
	assert.ok(isArguments(value));
	return value;
}

async function read(query: string, schema?: "next") {
	const response = await request(
		{ user: "dell" },
		`leads?workspace=leads${query}`,
		{ method: "GET" },
		{ LEADS_READ_SCHEMA: schema },
	);
	assert.equal(response.status, 200);
	const body = record(await response.json());
	assert.ok(Array.isArray(body.leads));
	return { leads: body.leads.map(record), detail: body.detail };
}

test("the switch shows corrected and unclaimed owners, and opens copied and new lead IDs", async () => {
	const switched = await read("", "next");
	assert.deepEqual(
		switched.leads.map(({ id, owner, stage }) => [id, owner, stage]),
		[
			[legacyId, "dell", "qualified"],
			[converted, null, "opportunity"],
			[fresh, null, "opportunity"],
		],
	);
	assert.equal(
		switched.leads.find((row) => row.id === converted)?.is_deal,
		true,
	);
	assert.equal(
		switched.leads.find((row) => row.id === fresh)?.owner_label,
		null,
	);
	for (const id of [fresh, legacyId, aliasId, copied]) {
		const { detail } = await read(`&lead_id=${id}`, "next");
		assert.equal(record(detail).id, id);
	}
	const { leads } = await read("");
	assert.deepEqual(
		leads.map(({ id, owner }) => [id, owner]),
		[[legacyId, "legacy-owner"]],
	);
});

test("the copied drawer shows new correspondence and one entry for a stage move", async () => {
	const { detail } = await read(`&lead_id=${legacyId}`, "next");
	const opened = record(detail);
	assert.equal(opened.email, "lead@example.test");
	assert.ok(
		Array.isArray(opened.correspondence) && Array.isArray(opened.stage_history),
	);
	assert.deepEqual(
		opened.correspondence.map((entry) => {
			const { kind, summary } = record(entry);
			return [kind, summary];
		}),
		[
			["meeting", "New meeting"],
			["call", "New call"],
			["email", "New email"],
		],
	);
	assert.deepEqual(
		opened.stage_history.map((entry) => {
			const { event_id, prior_stage, stage, reason } = record(entry);
			return [event_id, prior_stage, stage, reason];
		}),
		[[move, "new", "qualified", "New evidence"]],
	);
});
