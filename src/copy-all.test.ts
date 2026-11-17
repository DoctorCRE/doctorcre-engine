import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { URL } from "node:url";
import pg from "pg";
import { asAdmin } from "../scripts/test-database.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const read = (file: string) =>
	readFile(new URL(`../schema/${file}`, import.meta.url), "utf8");

// The order "Running the copies" in docs/new-database.md names, with the inputs the owner supplies to each.
const order: [file: string, input?: string][] = [
	["copy-parties.sql"],
	[
		"copy-markets.sql",
		`create temp table copy_market_county (market_slug text not null, county_fips text not null) on commit drop;
 insert into copy_market_county values ('example-bay', '01001');`,
	],
	[
		"copy-leads-clients.sql",
		`create temp table copy_how_found (old_type text, source text, how_found text, primary key (old_type, source)) on commit drop;
 insert into copy_how_found values ('lead', 'Example referral', 'referral'), ('client', 'Example referral', 'referral');`,
	],
	[
		"copy-national-account-owners.sql",
		`create temp table copy_account_owner_date (account_client_id uuid primary key, started_on date not null) on commit drop;
 insert into copy_account_owner_date values ('${id(23)}', '2024-03-01');`,
	],
	[
		"copy-client-brands.sql",
		`create temp table copy_client_brand_date (location_client_id uuid primary key, started_on date not null) on commit drop;
 insert into copy_client_brand_date values ('${id(20)}', '2024-01-01');`,
	],
	["copy-candidates-drafts.sql"],
	["copy-vendors.sql"],
	["copy-buildings.sql"],
	["copy-deals.sql"],
	["copy-vendors.sql"],
	["copy-leases.sql"],
	["copy-critical-dates.sql"],
	["copy-deal-files.sql"],
	["copy-deal-file-text.sql"],
	[
		"copy-commissions.sql",
		`insert into commission_tier (user_id, from_deal, partner_user_id, closing_share)
 values ('${id(1)}', 1, '${id(2)}', 0.6), ('${id(2)}', 1, '${id(1)}', 0.6) on conflict do nothing;`,
	],
	["copy-invoice-emails.sql"],
	["copy-space-needs.sql"],
	["copy-activity.sql"],
	["copy-calls.sql"],
	["copy-meetings.sql"],
	["copy-lead-stage-moves.sql"],
	["copy-deal-next-steps.sql"],
	["copy-call-suggestions.sql"],
	["copy-preferences.sql"],
	["copy-change-history.sql"],
];

// One made-up snapshot of today's system: two partners and a clinic client leasing a suite, with its vendor and a lead.
const OLD = `
create table ops.meeting (id uuid primary key, title text not null, started_by_actor uuid not null references public.actor,
 started_at timestamptz not null, ended_at timestamptz, ended_by_actor uuid references public.actor);
create table ops.meeting_note (id uuid primary key, meeting_id uuid not null references ops.meeting,
 note_number integer not null, revision integer not null, body text not null,
 author_actor uuid not null references public.actor, created_at timestamptz not null, unique (meeting_id,note_number,revision));

insert into public.actor (id, slug, kind, display_name) values
 ('${id(1)}', 'partner_one', 'human', 'Example Partner One'),
 ('${id(2)}', 'partner_two', 'human', 'Example Partner Two'),
 ('${id(3)}', 'example-mail', 'automation', 'Example mail job');
insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 1),
 ('do_not_contact', 'Example do not contact', false, 2);
insert into public.party (id, kind, name, created_by, updated_by, created_at, updated_at, email, phone, title, org_id, city) values
 ('${id(10)}', 'org', 'Example Clinic Group', '${id(1)}', '${id(1)}', '2024-01-01', '2024-02-01', null, null, null, null, null),
 ('${id(11)}', 'person', 'Example Doctor', '${id(1)}', '${id(1)}', '2024-01-02', '2024-02-02', 'doctor@example.com', '217-555-0100', 'Owner', '${id(10)}', 'Example City'),
 ('${id(12)}', 'org', 'Example Builders', '${id(1)}', '${id(1)}', '2024-01-03', '2024-02-03', null, null, null, null, null),
 ('${id(13)}', 'org', 'Example Landlord', '${id(1)}', '${id(1)}', '2024-01-04', '2024-02-04', null, null, null, null, null),
 ('${id(14)}', 'person', 'Example Prospect', '${id(1)}', '${id(1)}', '2024-01-05', '2024-02-05', null, null, null, null, null);
insert into public.party (id, kind, name, created_by, updated_by, deleted_at) values
 ('${id(15)}', 'person', 'Example Removed', '${id(1)}', '${id(1)}', '2024-06-01');
update public.party set specialty = 'Dentistry' where id = '${id(11)}';
update public.party set contact_state = 'do_not_contact', contact_state_reason = 'Example asked us to stop',
 contact_state_set_by = '${id(1)}', contact_state_set_at = '2024-03-01' where id = '${id(13)}';
insert into public.party (id, kind, name, created_by, updated_by, created_at, updated_at) values
 ('${id(16)}', 'org', 'Example National Brand', '${id(1)}', '${id(1)}', '2024-01-06', '2024-02-06');
update public.party set org_id = '${id(16)}' where id = '${id(10)}';
insert into public.client_type (slug, label) values ('national_account', 'Example account');
insert into public.client_status (slug, label) values ('active_deal', 'Example active deal');
insert into public.client (id, party_id, status, client_type, acquisition_source, created_by, updated_by, created_at) values
 ('${id(20)}', '${id(10)}', 'active_deal', null, 'Example referral', '${id(1)}', '${id(1)}', '2024-01-01'),
 ('${id(23)}', '${id(16)}', 'active_deal', 'national_account', 'Example referral', '${id(1)}', '${id(1)}', '2024-01-06');
insert into public.national_account_owner (account_client_id, owner_actor_id, set_by) values ('${id(23)}', '${id(1)}', '${id(1)}');
insert into public.lead_stage (slug, label) values ('qualified', 'Example qualified');
insert into public.lead (id, party_id, stage, source_type, created_by, updated_by, created_at, updated_at) values
 ('${id(21)}', '${id(14)}', 'qualified', 'Example referral', '${id(1)}', '${id(1)}', '2024-01-05', '2024-02-05');
insert into public.vendor_category (slug, label, sort) values ('gc', 'Example contractor', 1);
insert into public.vendor_disposition (slug, label, workable, sort) values ('active', 'Example active', true, 1);
insert into public.vendor (id, party_id, category, category_slug, created_by, updated_by, created_at, updated_at) values
 ('${id(22)}', '${id(12)}', 'Example contractor', 'gc', '${id(1)}', '${id(1)}', '2024-01-03', '2024-02-03');
insert into public.vendor_market (slug, name, kind, boundary, source, reviewed_by, reviewed_at) values
 ('example-bay', 'Example Bay', 'market', 'Example counties', 'Example review', '${id(1)}', '2025-01-01');
insert into public.vendor_market_membership (market_slug, vendor_id, office_presence, source, reviewed_by, reviewed_at) values
 ('example-bay', '${id(22)}', true, 'Example review', '${id(1)}', '2025-01-02');
insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Example lease', 1);
insert into public.deal_phase (slug, label) values ('negotiation', 'Example negotiation'), ('closed', 'Example closed');
insert into public.participant_role (slug, label) values ('landlord_side', 'Example landlord');
insert into public.deal (id, client_id, name, deal_type, phase, owner, city, created_by, updated_by, created_at, updated_at) values
 ('${id(30)}', '${id(20)}', 'Example clinic lease', 'lease', 'negotiation', 'partner_one', 'Example Bay', '${id(1)}', '${id(1)}', '2025-01-01', '2025-02-01');
insert into public.deal (id, client_id, name, deal_type, phase, owner, invoiced_on, created_by, updated_by, created_at, updated_at) values
 ('${id(34)}', '${id(20)}', 'Example closed lease', 'lease', 'closed', 'partner_one', '2025-03-01', '${id(1)}', '${id(1)}', '2024-06-01', '2025-03-02');
insert into public.event (id, subject_type, subject_id, field, old_value, new_value, occurred_at, actor_id, verb, cause) values
 ('${id(31)}', 'deal', '${id(30)}', 'phase', null, '{"phase":"negotiation"}', '2025-01-02', '${id(1)}', 'update-deal', 'human_stated'),
 ('${id(35)}', 'deal', '${id(34)}', 'phase', null, '{"phase":"negotiation"}', '2024-06-02', '${id(1)}', 'update-deal', 'human_stated'),
 ('${id(36)}', 'deal', '${id(34)}', 'phase', '{"phase":"negotiation"}', '{"phase":"closed"}', '2025-03-02T12:00Z', '${id(3)}', 'update-deal', 'automation_job'),
 ('${id(37)}', 'deal', '${id(34)}', 'invoiced_on', '{"invoiced_on":null}', '{"invoiced_on":"2025-03-01"}', '2025-03-02T12:00Z', '${id(3)}', 'update-deal', 'ingest_email');
update public.event set sponsoring_human_slug = 'partner_one' where id = '${id(37)}';
insert into public.deal_participant (deal_id, party_id, role, set_by) values ('${id(30)}', '${id(13)}', 'landlord_side', '${id(1)}');
insert into public.negotiation_round (id, deal_id, round_no, side, proposed_on, created_at, created_by) values
 ('${id(32)}', '${id(30)}', 1, 'tenant', '2025-01-10', '2025-01-10', '${id(1)}');
update public.vendor set verticals = '{dental}', loan_programs = '{construction}';
update public.vendor set deal_evidence = '[{"deal_id": "${id(30)}", "role": "worked", "occurred_at": "2025-01-20T00:00:00Z", "evidence_ref": "Example worked"}]';
insert into public.party_link_kind (slug, label, sort) values ('referral', 'Example referral', 1), ('knows', 'Example knows', 2);
insert into public.party_link (id, from_party, to_party, kind, source, created_by, created_at, occurred_on, note) values
 ('${id(33)}', '${id(12)}', '${id(10)}', 'referral', 'example', '${id(1)}', '2024-12-01', '2024-12-01', 'Example referral note'),
 ('${id(38)}', '${id(11)}', '${id(14)}', 'knows', 'example', '${id(1)}', '2024-12-03', '2024-12-03', 'Example acquaintance');
insert into public.negotiation_claim_type (slug, label, falsifiable, reversal_test, sort) values ('annual', 'Example annual floor', false, 'Example test', 1);
insert into public.negotiation_claim (id, round_id, claim_type, stated_floor, stated_floor_basis, quote, source, created_by, created_at) values
 ('${id(39)}', '${id(32)}', 'annual', 31, 'usd_sf_yr', 'Example stated floor', 'stated', '${id(1)}', '2025-01-10');
insert into public.party_link_deal (link_id, deal_id, referred_by, note, created_by, created_at) values
 ('${id(33)}', '${id(30)}', '${id(12)}', 'Example deal referral', '${id(1)}', '2024-12-02');
insert into public.building (id, address, city, state, zip, created_by, updated_by, created_at, updated_at) values
 ('${id(40)}', '100 Example Way', 'Example City', 'TX', '75000', '${id(1)}', '${id(1)}', '2024-01-01', '2024-02-01');
insert into public.space (id, building_id, suite, created_by, updated_by, created_at) values
 ('${id(41)}', '${id(40)}', 'Suite 100', '${id(1)}', '${id(1)}', '2024-03-01');
insert into public.building_ownership (id, building_id, party_id, kind, source, created_at, created_by) values
 ('${id(42)}', '${id(40)}', '${id(13)}', 'owner', 'stated', '2024-03-02', '${id(1)}');
insert into public.premises (id, deal_id, label, created_by) values ('${id(43)}', '${id(30)}', 'Example suite', '${id(1)}');
insert into public.premises_space values ('${id(43)}', '${id(41)}');
insert into public.attachment (id, subject_type, subject_id, r2_key, filename, mime, sha256, bytes, created_by) values
 ('${id(50)}', 'deal', '${id(30)}', 'leases/50.pdf', 'Example lease.pdf', 'application/pdf', '${"5".repeat(64)}', 1000, '${id(1)}');
insert into public.lease (id, deal_id, client_id, premises_id, doc_attachment, expiration_on, created_by, created_at, updated_at) values
 ('${id(51)}', '${id(30)}', '${id(20)}', '${id(43)}', '${id(50)}', '2030-01-31', '${id(1)}', '2025-01-01', '2025-03-01');
insert into public.critical_date (id, deal_id, kind, due_on, note, source, status, created_at, created_by, updated_at) values
 ('${id(60)}', '${id(30)}', 'lease_end', '2030-01-31', 'Example note', 'Example source', 'open', '2025-01-01', '${id(1)}', '2025-02-01');
insert into public.commission (id, deal_id, status, gross_amount, created_at, updated_at, created_by) values
 ('${id(70)}', '${id(30)}', 'expected', 1000, '2025-01-01', '2025-02-01', '${id(1)}');
insert into public.commission (id, deal_id, status, gross_amount, received_on, created_at, updated_at, created_by) values
 ('${id(71)}', '${id(34)}', 'received', 500, '2025-04-01', '2025-03-02', '2025-04-01', '${id(1)}');
insert into public.space_search (id, client_id, deal_id, spec, created_by, created_at) values
 ('${id(80)}', '${id(20)}', '${id(30)}', '{"min_sf": 1000, "max_sf": 2000}', '${id(1)}', '2025-01-01');
insert into public.deal_client_need (id, deal_id, vendor_id, description, applicability, source_ref, source_revision, observed_at, fresh_until,
 restriction, withdrawn, revision, approved_revision, approved_client_id, approved_by, approved_at, created_by, updated_by, updated_at) values
 ('${id(81)}', '${id(30)}', '${id(22)}', 'Example requirement', 'For this suite', 'Example source', 'v1', '2025-01-01', '2099-01-01',
 'allowed', false, 1, 1, '${id(20)}', '${id(1)}', '2025-01-02', '${id(1)}', '${id(1)}', '2025-01-02');
insert into public.attachment (id, subject_type, subject_id, r2_key, filename, mime, sha256, bytes, created_by) values
 ('${id(52)}', 'deal', '${id(30)}', 'files/52.pdf', 'Example plan.pdf', 'application/pdf', '${"6".repeat(64)}', 2000, '${id(1)}');
insert into ops.deal_document_text (document_ref, entity_ref, content_hash, text_format_version, status, pages, text_hash, created_at) values
 ('${id(52)}', '${id(30)}', '${"6".repeat(64)}', 'page-text.v1', 'produced', '["Example page"]', 'example-digest', '2025-03-01');
insert into public.activity_kind (slug, label, is_contact) values ('call', 'Example call', true);
insert into public.lead_stage (slug, label) values ('new', 'Example new'), ('outreach_active', 'Example outreach');
insert into public.lead_lane (slug, label) values ('example_lane', 'Example lane');
update public.lead set lane = 'example_lane';
insert into public.activity (id, kind, occurred_at, recorded_at, updated_at, actor_id, summary, deal_id, client_id, lead_id) values
 ('${id(82)}', 'call', '2025-01-03', '2025-01-03', '2025-01-03', '${id(1)}', 'Example call', '${id(30)}', '${id(20)}', null),
 ('${id(83)}', 'call', '2025-01-05', '2025-01-05', '2025-01-05', '${id(1)}', 'Example prospect call', null, null, '${id(21)}');
insert into public.deal_note (id, deal_id, kind, text, actor_id, created_at) values
 ('${id(84)}', '${id(30)}', 'note', 'Example deal note', '${id(1)}', '2025-01-04');
insert into public.event (id, actor_id, verb, subject_type, subject_id, field, old_value, new_value, cause, occurred_at) values
 ('${id(93)}', '${id(1)}', 'add-deal-note', 'deal', '${id(30)}', 'note', null, '{"note": "Example deal note"}', 'human_stated', '2025-01-04'),
 ('${id(94)}', '${id(1)}', 'update-party', 'party', '${id(10)}', 'name', '{"name": "Example Clinic"}', '{"name": "Example Clinic Group"}', 'human_stated', '2024-01-15');
insert into public.lead_stage_move (id, lead_id, from_stage, to_stage, activity_id, evidence_ref, strength, status, created_by, created_at, reason) values
 ('${id(85)}', '${id(21)}', 'new', 'qualified', '${id(83)}', 'Example evidence', 'strong', 'applied', '${id(1)}', '2025-01-05', 'Example reason'),
 ('${id(92)}', '${id(21)}', 'qualified', 'outreach_active', '${id(83)}', 'Example reply', 'weak', 'proposed', '${id(3)}', '2025-01-06', 'Example proposal');
insert into public.candidate_pool (id, source, source_key, source_seq, source_row, name, score_basis, status, created_by, updated_by, created_at, updated_at) values
 ('${id(86)}', 'Example pool', 'key-86', 1, '{}', 'Example candidate', 'Example qualification', 'pool', '${id(1)}', '${id(1)}', '2025-01-01', '2025-01-02');
insert into public.lead_contact_draft (id, lead_id, party_id, owner_id, subject, body, scheduled_for, time_zone, created_by, created_at) values
 ('${id(87)}', '${id(21)}', '${id(14)}', '${id(1)}', 'Example subject', 'Example body', '2025-04-01', 'America/Chicago', '${id(1)}', '2025-01-01');
insert into public.next_action (id, subject_type, subject_id, owner_id, description, status, created_by) values
 ('${id(88)}', 'lead', '${id(21)}', '${id(1)}', 'Example step', 'open', '${id(1)}'),
 ('${id(89)}', 'deal', '${id(30)}', '${id(1)}', 'Example deal step', 'open', '${id(1)}');
insert into ops.home_inbox_disposition (actor_id, item_id, disposition, source_version, material_version, updated_at) values
 ('${id(1)}', 'next_action:${id(89)}', 'settled', '1', 'm', '2026-10-04');
insert into public.deal_invoice_email (id, evidence_ref, from_address, deal_name, client_name, property_address, occurred_at, email_date, created_by, status,
 deal_id, prior_phase, phase_event_id, invoice_event_id, applied_at, applied_by, reason) values
 ('${id(90)}', 'local-mail:example-90', 'billing@example.test', 'Example clinic lease', 'Example Clinic Group', '100 Example Way',
 '2025-03-01T12:00:00Z', '2025-03-01', '${id(3)}', 'captured', null, null, null, null, null, null, null),
 ('${id(91)}', 'local-mail:example-91', 'billing@example.test', 'Example closed lease', 'Example Clinic Group', '100 Example Way',
 '2025-03-01T12:00:00Z', '2025-03-01', '${id(3)}', 'applied', '${id(34)}', 'negotiation', '${id(36)}', '${id(37)}', '2025-03-02T12:00Z', '${id(3)}', 'Example invoice');
insert into public.event (id, actor_id, verb, subject_type, subject_id, new_value, cause, occurred_at, sponsoring_human_slug)
 select ('00000000-0000-4000-8000-1' || right(id::text, 11))::uuid, '${id(3)}', 'record-deal-invoice', 'deal_invoice_email', id, jsonb_build_object('evidence_ref', evidence_ref, 'email_date', '2025-03-01'),
 'ingest_email', '2025-03-01T12:00:00Z', 'partner_one' from public.deal_invoice_email;
insert into ops.notification_preference (actor, device_opt_in, quiet_hours_start, quiet_hours_end, timezone, version) values
 ('${id(1)}', true, '22:00', '06:00', 'America/Chicago', 1);
insert into ops.home_waiting (actor_id, item_id, identity_kind, identity_id, reason, evidence, version, updated_at) values
 ('${id(1)}', 'next_action:${id(88)}', 'party', '${id(14)}', 'Example reply', '["Example evidence"]', 1, '2026-10-05');
insert into public.capture_session (id, nonce, device_id, actor_id, mode, started_at, consent_announced_at, session_token_hash, expires_at, state, state_at, post_call)
 values ('${id(95)}', 'nonce-95', 'phone-import', '${id(1)}', 'meeting', '2025-01-06', '2025-01-06', 'token-95', '2025-02-06', 'done', '2025-01-06', true);
insert into public.phone_call_session (id, owner_id, sha256, byte_count, duration_seconds, mime_type, started_at, consent_announced_at, projection)
 values ('${id(95)}', '${id(1)}', '${"7".repeat(64)}', 1000, 60, 'audio/mp4', '2025-01-06', '2025-01-06', '{"summary": "Example call summary", "decisions": [], "open_questions": []}');
insert into public.capture_post_call_candidate (session_id, idempotency_key, batch_hash, item_index, kind, deal_id, assignee_slug, action_description, evidence_quote, confidence)
 values ('${id(95)}', 'key-95', 'batch', 0, 'assigned_action', '${id(30)}', 'partner_one', 'Example action', 'Example quote', 0.9);
insert into ops.meeting values ('${id(110)}','Example planning meeting','${id(1)}','2023-01-01',null,null);
insert into ops.meeting_note values ('${id(111)}','${id(110)}',1,1,'Example planning note','${id(1)}','2023-01-01 01:00Z');
`;

const name = `copy_all_${randomUUID().replaceAll("-", "")}`;
const url = new URL(
	process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1/postgres",
);
url.pathname = `/${name}`;
const db = new pg.Client({
	connectionString: url.href,
	options: "-c search_path=next -c TimeZone=UTC",
});
const rows = async (sql: string) => (await db.query(sql)).rows;
const scripts = await Promise.all(order.map(([file]) => read(file)));

// Each copy runs in its own owner transaction and ends with its correction list.
// A copy that runs twice in the order lists, the second time, what still waits after the copies between.
const runAll = async () => {
	const listed = new Map<string, unknown[][]>();
	for (const [i, [file, input = ""]] of order.entries()) {
		await db.query(
			"begin; select set_config('engine.job', 'old_system', true)",
		);
		await db.query(input);
		const result = await db.query(scripts[i] ?? "");
		assert.ok(Array.isArray(result));
		await db.query("commit");
		listed.set(file, result.at(-1)?.rows.map(Object.values) ?? []);
	}
	return [...listed].flatMap(([file, list]) =>
		list.map((row) => [file, ...row]),
	);
};

// Every row of every table in the new schema, change history included.
const everything = async () => {
	const tables = await rows(
		"select table_name from information_schema.tables where table_schema = 'next' and table_type = 'BASE TABLE' order by 1",
	);
	const all: Record<string, unknown> = {};
	for (const { table_name } of tables)
		all[table_name] = (
			await rows(
				`select coalesce(jsonb_agg(t order by t::text), '[]') as rows from next."${table_name}" t`,
			)
		)[0]?.rows;
	return all;
};

let first: unknown[][];
before(async () => {
	assert.ok(process.env.TEST_SNAPSHOT, "Run npm run check");
	await asAdmin(
		`create database "${name}" template "${process.env.TEST_SNAPSHOT}"`,
	);
	await db.connect();
	const [schema, attribution] = await Promise.all([
		read("next.sql"),
		read("copy-attribution.sql"),
	]);
	await db.query(`create schema next; ${schema}; ${attribution}`);
	await db.query(`begin; ${OLD} commit;`);
	first = await runAll();
});
after(async () => {
	await db.end();
	await asAdmin(`drop database "${name}" with (force)`);
});

const counts = async () =>
	Object.fromEntries(
		await Promise.all(
			Object.keys(copied).map(async (table) => [
				table,
				(await rows(`select count(*)::int as n from ${table}`))[0]?.n,
			]),
		),
	);
// Each table a copy writes holds what the snapshot gave it, so no copy passes by copying nothing.
// biome-ignore format: one entry per copied table
const copied = { party: 8, party_email: 1, party_phone: 1, party_company: 1, party_role: 6, party_specialty: 1,
 specialty: 1, do_not_contact: 1, client: 2, national_account: 1, national_account_owner: 1, client_brand: 1, lead_lane: 1, market: 1, market_county: 1, territory: 1,
 territory_piece: 1, party_territory: 1, vendor_vertical: 1, vendor_loan_program: 1, deal: 2, deal_party: 4,
 deal_property: 1, deal_phase_change: 3, offer: 1, offer_claim: 1, claim_type: 1, party_link: 1, introduction: 1, property: 1, suite: 1, building_ownership: 1, lease: 1,
 lease_version: 1, lease_suite: 1, critical_date: 1, document: 2, document_extraction: 1, commission: 2,
 commission_payment: 1, invoice_email: 2, space_need: 2, activity: 5, activity_about: 5, lead_stage_move: 1, proposal: 2,
 candidate: 1, lead_contact_draft: 1, next_step: 2, user_preference: 1, home_mark: 2, imported_change: 3 };
// The party copy lists a copied record's leftover values on its first run only (#392).
// biome-ignore format: one row per correction
const leftover = [
 ["copy-parties.sql", id(10), "org_id", id(16), "a national account has no place in the new database yet"],
 ["copy-parties.sql", id(11), "city", "Example City", "no place in the new database"],
];
// biome-ignore format: one row per correction
const corrections = [
 ...leftover,
 ["copy-parties.sql", id(15), "party", "Example Removed", "deleted"],
 ["copy-markets.sql", id(22), "membership_details", '{"market": "example-bay", "source": "Example review", "office_presence": true, "service_coverage": null}', "no_typed_destination"],
 ["copy-markets.sql", "example-bay", "market_key", "example-bay", "no_alias_destination"],
 ["copy-markets.sql", "example-bay", "source", "Example review", "no_typed_destination"],
 ["copy-leases.sql", id(51), "evidence", '{"source": "stated", "status": "legacy_unverified"}', "no_typed_destination"],
 ["copy-deal-files.sql", id(50), "kind", "other", "kind_unclassified"],
 ["copy-deal-files.sql", id(52), "kind", "other", "kind_unclassified"],
 ["copy-calls.sql", id(95), "recording", "7".repeat(64), "recording_not_copied"],
 ["copy-meetings.sql", id(110), "activity", id(110), "about_nothing_copied"],
 ["copy-change-history.sql", id(31), "phase", "field_has_no_mapping"],
 ["copy-change-history.sql", id(35), "phase", "field_has_no_mapping"],
 ["copy-change-history.sql", id(36), "phase", "field_has_no_mapping"],
 ["copy-change-history.sql", id(37), "invoiced_on", "field_has_no_mapping"],
 ["copy-change-history.sql", id(93), "note", "field_has_no_mapping"],
 ["copy-change-history.sql", "00000000-0000-4000-8000-100000000090", null, "field_has_no_mapping"],
 ["copy-change-history.sql", "00000000-0000-4000-8000-100000000091", null, "field_has_no_mapping"],
];

test("every copy runs in order on one snapshot and lists only the expected corrections", async () => {
	assert.deepEqual(await counts(), copied);
	assert.deepEqual(
		await rows("select invoiced_on::text from commission_payment"),
		[{ invoiced_on: "2025-03-01" }],
		"the invoice email dated the payment today's row leaves undated",
	);
	assert.deepEqual(first, corrections);
});

test("running every copy again changes no row or change history and lists the same corrections", async () => {
	const before = await everything();
	const again = await runAll();
	assert.deepEqual(await everything(), before);
	assert.deepEqual(again, corrections.slice(leftover.length));
});
