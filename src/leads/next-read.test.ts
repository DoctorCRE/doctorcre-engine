import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "../save-door.ts";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, request, readerUrl, save } = doorTest();
const [legacyId, aliasId] = [randomUUID(), randomUUID()].sort();
const registryRef = "L-EXAMPLE";
const leadNotes =
	"[Web sweep 7/25 · finder conf LOW · verify: UNVERIFIED (present anyway, flag)] Planning a dental relocation.\n\n[Finder conf LOW] Needs two treatment rooms.\n[Verify: confirm the lease permits dental use]\n[Web sweep checklist](https://example.test/checklist)";
const note = randomUUID();
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
		insert into party_role (party_id, role, stage, owner_user_id, created_at) values
			('${copied}', 'lead', 'new', '${partner}', now() - interval '2 days'),
			('${fresh}', 'lead', 'opportunity', null, now()),
			('${converted}', 'lead', 'opportunity', null, now());
		with added as (insert into deal (name, owner_user_id)
			values ('Example Deal', '${partner}') returning id)
		insert into deal_party (deal_id, party_id, role)
			select id, '${converted}', 'client_contact' from added;
		insert into outside_id (source, value, party_id) values
			('old_system', '${copied}', '${copied}'),
			('old_system_lead', '${legacyId}', '${copied}'),
			('old_system_lead', '${aliasId}', '${copied}'),
			('old_system_ref', 'C-EXAMPLE', '${copied}'),
			('old_system_ref', '${registryRef}', '${copied}');
		insert into party_email (party_id, address, label, is_primary)
			values ('${copied}', 'lead@example.test', 'work', true);
		insert into party_phone (party_id, number, extension, label, is_primary) values
			('${copied}', '+12025550100', '123', 'work', true),
			('${copied}', '+12025550101', null, 'mobile', false);
		insert into activity (id, kind, happened_at, summary, reached) values
			('${call}', 'call', now() - interval '1 day', 'New call', true),
			('${meeting}', 'meeting', now() - interval '1 hour', 'New meeting', null),
			('${note}', 'note', now(), '${leadNotes}', null);
		set local engine.job = 'mail_capture';
		insert into activity (id, kind, happened_at, reached)
			values ('${mail}', 'email', now() - interval '2 hours', true);
		set local engine.job = '';
		insert into activity_about (activity_id, party_id) values
			('${mail}', '${copied}'), ('${call}', '${copied}'), ('${meeting}', '${copied}'),
			('${note}', '${copied}');
		insert into email (activity_id, message_id, sender, subject, body)
			values ('${mail}', '<mail@example.test>', 'lead@example.test', 'New email', 'New message');
		insert into lead_stage_move (id, party_id, from_stage, to_stage, activity_id, evidence_ref, strength, reason)
			values ('${move}', '${copied}', 'new', 'qualified', '${call}', 'Example reference', 'strong', 'New evidence');
		set constraints all immediate;
		alter table change disable trigger stamp_change;
		insert into change (table_name, record, action, old_value, new_value, changed_by_user_id, changed_at)
			select 'party_role', jsonb_build_object('party_id', '${fresh}'::uuid, 'role', 'lead'),
				'update', '{"stage":"new"}', '{"stage":"opportunity"}', '${partner}',
				case when i = 101 then '2026-01-01'::timestamptz else '2026-01-02'::timestamptz end
			from generate_series(1, 101) i order by i;
		alter table change enable trigger stamp_change;
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
		switched.leads
			.filter(({ id }) => id === legacyId || id === converted || id === fresh)
			.map(({ id, owner, stage }) => [id, owner, stage]),
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
			["email", "New email"],
			["call", "New call"],
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

test("a Quiet follow-ups lead reference selects the copied board row and opens its drawer", async () => {
	const { leads } = await read("", "next");
	const ref = new URL(
		`https://app.example.test/leads?lead=${registryRef}`,
	).searchParams.get("lead");
	const lead = leads.find((row) => row.registry_ref === ref || row.id === ref);
	assert.ok(lead);
	assert.equal(lead.id, legacyId);
	const { detail } = await read(`&lead_id=${lead.id}`, "next");
	assert.equal(record(detail).id, legacyId);
});

async function quietLead() {
	const id = randomUUID();
	await db.query(`begin;
		select set_config('engine.user_id', '${partner}', true);
		insert into party (id, kind, name, how_found) values ('${id}', 'person', 'Example Quiet Lead', 'referral');
		insert into party_role (party_id, role, stage, created_at)
			values ('${id}', 'lead', 'new', now() - interval '60 days');
		commit;`);
	return id;
}

async function quietProposal(id: string) {
	const response = await request({ user: "dell" }, "quiet-follow-ups", {
		method: "GET",
	});
	assert.equal(response.status, 200);
	const { proposals } = record(await response.json());
	assert.ok(Array.isArray(proposals));
	return proposals.map(record).find((row) => row.subject_id === id);
}

test("a contact recorded today moves an unclaimed lead off Quiet", async () => {
	const id = await quietLead();
	const before = await quietProposal(id);
	assert.deepEqual(
		[before?.basis, before?.last_contact_on, before?.owner_id, before?.owner],
		["created_at", null, null, null],
	);
	await db.query(`begin;
		select set_config('engine.user_id', '${partner}', true);
		with contact as (
			insert into activity (kind, happened_at, reached) values ('call', now(), true) returning id
		) insert into activity_about (activity_id, party_id) select id, '${id}' from contact;
		commit;`);
	assert.equal(await quietProposal(id), undefined);
});

test("a step saved today appears on the lead and moves it off Quiet", async () => {
	const id = await quietLead();
	assert.equal((await quietProposal(id))?.subject_id, id);
	const [status] = await save({ user: "dell" }, "next-steps", {
		idempotency_key: randomUUID(),
		party_id: id,
		what: "Call about the lease",
		due_on: "2099-01-20",
		hold_until: "2099-01-19",
	});
	assert.equal(status, 201);
	const { leads } = await read("", "next");
	assert.equal(
		leads.find((lead) => lead.id === id)?.next_action_date,
		"2099-01-20",
	);
	assert.equal(await quietProposal(id), undefined);
});

test("editing an imported follow-up moves the lead off Quiet", async () => {
	const partyId = await quietLead();
	const leadId = randomUUID();
	const {
		rows: [step],
	} = await db.query<{ id: string }>(
		`with actor as (select set_config('engine.job', 'old_system', true)),
		copied as (
			insert into outside_id (source, value, party_id)
			select 'old_system_lead', $1::text, $2::uuid from actor returning value, party_id
		)
		insert into next_step (id, party_id, what, due_on, owner_party_id)
		select md5('old_system:lead:' || value || ':follow_up')::uuid,
			party_id, 'Imported lead follow-up', '2020-01-05', $3::uuid from copied
		returning id`,
		[leadId, partyId, partner],
	);
	assert.ok(step);
	const untouched = await quietProposal(leadId);
	assert.deepEqual(
		[untouched?.next_action_date, untouched?.due_on],
		["2020-01-05", "2020-01-05"],
	);
	const {
		rows: [change],
	} = await db.query<{ id: string }>(
		`select id from change where table_name = 'next_step' and action = 'insert'
		and record = jsonb_build_object('id', $1::uuid)`,
		[step.id],
	);
	assert.ok(change);
	const [status, body] = await save(
		{ user: "dell" },
		`next-steps/${step.id}/changes`,
		{
			idempotency_key: randomUUID(),
			seen_change_id: Number(change.id),
			what: "Call about the new location",
			hold_until: "2099-01-19",
		},
	);
	assert.equal(status, 200, JSON.stringify(body));
	assert.equal(await quietProposal(leadId), undefined);
});

test("the drawer and reachability keep the primary phone extension and mobile route", async () => {
	const { detail } = await read(`&lead_id=${legacyId}`, "next");
	const opened = record(detail);
	const inputs = record(record(opened.reachability).source_inputs);
	assert.deepEqual(
		[opened.phone, inputs.phone, inputs.cell],
		["+12025550100 x123", "+12025550100 x123", "+12025550101"],
	);
});

test("the drawer returns readable plans and research without generic handling advice", async () => {
	const { detail } = await read(`&lead_id=${legacyId}`, "next");
	const opened = record(detail);
	assert.equal(opened.notes, leadNotes);
	assert.equal(
		opened.plans,
		"Planning a dental relocation.\n\nNeeds two treatment rooms.\n[Verify: confirm the lease permits dental use]\n[Web sweep checklist](https://example.test/checklist)",
	);
	assert.equal(opened.handling_advice, null);
	assert.equal(
		record(opened.research).next_step,
		"Check the practice website, professional registry and public filings. Save what you find.",
	);
});

test("a recent reached call establishes contact with its recorded source", async () => {
	const { leads } = await read("", "next");
	const reachability = record(
		leads.find((row) => row.id === legacyId)?.reachability,
	);
	const contact = record(reachability.successful_contact);
	assert.deepEqual(
		[contact.activity_id, contact.source, contact.kind],
		[call, "dell", "call"],
	);
	assert.deepEqual(reachability.missing_reasons, [
		"verified_usable_route_not_established",
	]);
});

test("stage history pages by event time and breaks ties by descending audit ID", async () => {
	const query = `&lead_id=${fresh}`;
	const { detail } = await read(query, "next");
	const opened = record(detail);
	assert.ok(Array.isArray(opened.stage_history));
	const first = opened.stage_history.map(record);
	assert.equal(first.length, 100);
	assert.ok(
		first.every((entry) => entry.occurred_at === "2026-01-02T00:00:00+00:00"),
	);
	const ids = first.map(({ mutation_order }) => BigInt(String(mutation_order)));
	assert.deepEqual(
		ids,
		ids.toSorted((a, b) => (a > b ? -1 : Number(a < b))),
	);
	const { next_cursor: cursor, has_more: hasMore } = record(
		opened.stage_history_page,
	);
	assert.equal(hasMore, true);
	assert.equal(cursor, first.at(-1)?.mutation_order);
	assert.match(String(cursor), /^\d+$/);

	const tail = record(
		(await read(`${query}&stage_history_cursor=${cursor}`, "next")).detail,
	);
	assert.ok(Array.isArray(tail.stage_history));
	assert.deepEqual(
		tail.stage_history.map((entry) => record(entry).occurred_at),
		["2026-01-01T00:00:00+00:00"],
	);
	assert.equal(record(tail.stage_history_page).has_more, false);
});
