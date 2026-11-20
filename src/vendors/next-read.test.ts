import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const SEED = `
select set_config('engine.user_id', '${id(901)}', true);
insert into party (id, kind, name, city) values
	('${id(901)}', 'person', 'Example Joe', null),
	('${id(902)}', 'person', 'Example Dell', null),
	('${id(101)}', 'company', 'Example Next Lender', 'Austin'),
	('${id(102)}', 'person', 'Example Copied Architect', 'Dallas'),
	('${id(103)}', 'person', 'Example Lender Rep', null),
	('${id(104)}', 'person', 'Example Introduced Client', null);
insert into app_user (id, slug) values ('${id(901)}', 'joe'), ('${id(902)}', 'dell');
insert into role (slug, label, category_of) values
	('vendor', 'Vendor', null), ('lender', 'Lender', 'vendor'), ('architect', 'Architect', 'vendor');
insert into stage (role, slug, label) values ('vendor', 'active', 'Active');
insert into phase (slug, label) values ('closed', 'Closed'), ('dead', 'Dead'), ('negotiation', 'Negotiating');
insert into party_role (party_id, role, stage, relationship_level, is_target, offers, seeking, refers_business, owner_user_id) values
	('${id(101)}', 'vendor', 'active', 2, true, 'Dental loans', 'Startups', true, '${id(901)}'),
	('${id(101)}', 'lender', null, null, false, null, null, null, null),
	('${id(102)}', 'vendor', null, 1, false, null, null, false, '${id(902)}'),
	('${id(102)}', 'architect', null, null, false, null, null, null, null);
update party_role set disposition = 'parked', disposition_reason = 'Example pause'
	where party_id = '${id(102)}' and role = 'vendor';
insert into vendor_vertical (party_id, vertical) values ('${id(101)}', 'Dental'), ('${id(101)}', 'Ortho');
insert into vendor_loan_program (party_id, loan_program) values ('${id(101)}', 'SBA 7a');
insert into territory (id, name) values ('${id(401)}', 'Central TX'), ('${id(402)}', 'North TX');
insert into party_territory (party_id, territory_id) values ('${id(101)}', '${id(401)}'), ('${id(102)}', '${id(402)}');
insert into party_company (person_id, company_id, title) values ('${id(103)}', '${id(101)}', 'Loan Officer');
insert into party_email (party_id, address, label, is_primary) values
	('${id(103)}', 'rep@example.test', 'work', true),
	('${id(102)}', 'arch@example.test', 'work', true);
insert into party_phone (party_id, number, label, is_primary) values
	('${id(103)}', '+15125550101', 'work', true),
	('${id(103)}', '+15125550102', 'mobile', false);
insert into outside_id (source, value, party_id) values
	('old_system', '${id(502)}', '${id(102)}'),
	('old_system_ref', 'V-102', '${id(102)}');
insert into deal (id, name, owner_user_id, created_at) values
	('${id(201)}', 'Example Closed Deal', '${id(901)}', '2024-01-10T12:00:00Z'),
	('${id(202)}', 'Example Dead Deal', '${id(901)}', '2025-02-10T12:00:00Z'),
	('${id(203)}', 'Example Open Deal', '${id(901)}', '2025-05-10T12:00:00Z'),
	('${id(204)}', 'Example Referred Deal', '${id(901)}', '2025-08-10T12:00:00Z');
insert into deal_phase_change (deal_id, happened_at, phase, reason) values
	('${id(201)}', '2024-06-01T12:00:00Z', 'closed', null),
	('${id(202)}', '2025-03-01T12:00:00Z', 'dead', 'Example lost'),
	('${id(203)}', '2025-06-01T12:00:00Z', 'negotiation', null);
insert into deal_party (deal_id, party_id, role, created_at) values
	('${id(201)}', '${id(101)}', 'lender', '2024-01-15T12:00:00Z'),
	('${id(202)}', '${id(101)}', 'lender', '2025-02-15T12:00:00Z'),
	('${id(203)}', '${id(101)}', 'lender', '2025-05-15T12:00:00Z');
insert into introduction (id, vendor_id, made_by, introduced_party_id, introduced_on, deal_id, note) values
	('${id(301)}', '${id(101)}', 'vendor', '${id(104)}', '2025-08-05', '${id(204)}', 'Example referral');
insert into party_link (id, kind, party_id, other_party_id, started_on, note) values
	('${id(302)}', 'can_introduce', '${id(101)}', '${id(104)}', '2025-09-01', 'Example intro lead');
insert into activity (id, kind, happened_at, summary) values
	('${id(601)}', 'call', now() - interval '2 days', 'Spoke about Q4 pipeline'),
	('${id(602)}', 'note', now() - interval '1 day', 'Example vendor note');
insert into activity_about (activity_id, party_id) values
	('${id(601)}', '${id(101)}'), ('${id(602)}', '${id(101)}');
`;

const door = doorTest();
before(async () => {
	await door.setup();
	await door.db.query(`set search_path = next, pg_temp; ${SEED}`);
});
after(() => door.cleanup());

const get = (path: string, schema: string | null = "next") =>
	door.request(
		{ user: "joe" },
		`vendors${path}`,
		{ method: "GET" },
		schema ? { DIRECTORY_READ_SCHEMA: schema } : {},
	);

test("vendors list and drawer read next schema with track record, last touch, owner and legacy IDs", async () => {
	const listRes = await get("?contract=vendor-directory.v1");
	assert.equal(listRes.status, 200);
	const list = (await listRes.json()) as {
		total: number;
		rows: Record<string, unknown>[];
		facets: {
			categories: { slug: string }[];
			territories: { slug: string }[];
		};
	};
	assert.equal(list.total, 2);
	const [copied, nextOnly] = list.rows;
	assert.ok(copied && nextOnly);
	// Copied vendor keeps V-102 ref and next owner (Dell).
	assert.equal(copied.id, id(102));
	assert.equal(copied.ref, "V-102");
	assert.equal(copied.owner_label, "Example Dell");
	assert.equal(copied.owned_by_viewer, false);
	assert.equal(copied.recorded_disposition, "parked");
	assert.equal(copied.recorded_disposition_workable, false);

	// Next-only vendor uses its next ID as ref and shows live track record and last touch.
	assert.equal(nextOnly.id, id(101));
	assert.equal(nextOnly.ref, id(101));
	assert.equal(nextOnly.party_kind, "org");
	assert.equal(nextOnly.owner_label, "Example Joe");
	assert.equal(nextOnly.owned_by_viewer, true);
	assert.equal(nextOnly.vertical, "Dental, Ortho");
	assert.equal(nextOnly.territory, "Central TX");
	assert.ok(typeof nextOnly.last_touch === "string");
	assert.partialDeepStrictEqual(nextOnly.relationship, {
		coverage_verified_at: null,
		override: null,
		deals_worked: 3,
		deals_referred: 1,
		won: 1,
		lost: 1,
		win_rate: 0.5,
		computed_tier: "Established",
		last_contact_note: "Spoke about Q4 pipeline",
	});
	assert.deepEqual(
		list.facets.categories.map((c) => c.slug),
		["architect", "lender"],
	);
	assert.deepEqual(
		list.facets.territories.map((t) => t.slug),
		["Central TX", "North TX"],
	);

	// Filters work against next owner, category, disposition, territory, and ref/name search.
	const mine = (await (
		await get("?contract=vendor-directory.v1&scope=mine")
	).json()) as { rows: { id: string }[] };
	assert.deepEqual(
		mine.rows.map((r) => r.id),
		[id(101)],
	);
	const byRef = (await (
		await get("?contract=vendor-directory.v1&q=V-102&owner=dell")
	).json()) as { rows: { id: string }[] };
	assert.deepEqual(
		byRef.rows.map((r) => r.id),
		[id(102)],
	);

	// Drawer opens next-only vendor with people, loan programs, notes, and introductions.
	const detailRes = await get(`/${id(101)}?contract=vendor-directory.v2`);
	assert.equal(detailRes.status, 200);
	const detail = (await detailRes.json()) as {
		record: Record<string, unknown>;
	};
	assert.equal(detail.record.id, id(101));
	assert.equal(detail.record.ref, id(101));
	assert.equal(detail.record.intro_notes, "Example vendor note");
	assert.deepEqual(detail.record.loan_programs, ["SBA 7a"]);
	const rel = detail.record.relationship as {
		recent_entries: { id: string; kind: string; summary: string }[];
		introductions: {
			id: string;
			kind: string;
			from_name: string;
			to_name: string;
		}[];
	};
	assert.deepEqual(
		rel.recent_entries.map((e) => [e.id, e.kind, e.summary]),
		[
			[id(602), "note", "Example vendor note"],
			[id(601), "call", "Spoke about Q4 pipeline"],
		],
	);
	assert.deepEqual(
		rel.introductions.map((i) => [i.id, i.kind, i.from_name, i.to_name]),
		[
			[
				id(302),
				"can_introduce",
				"Example Next Lender",
				"Example Introduced Client",
			],
			[
				id(301),
				"introduced",
				"Example Next Lender",
				"Example Introduced Client",
			],
		],
	);
	assert.partialDeepStrictEqual(detail.record.people, [
		{
			company: { id: id(101), name: "Example Next Lender" },
			contact: {
				id: id(103),
				name: "Example Lender Rep",
				email: "rep@example.test",
				phone: "+15125550101",
				cell: "+15125550102",
			},
			office: null,
			research: {
				status: "not_researched",
				finding_id: null,
				observed_at: null,
				expires_on: null,
			},
		},
	]);

	// Drawer opens copied vendor by legacy outside_id and preserves requested ID + copied ref.
	const legacyOpenRes = await get(`/${id(502)}?contract=vendor-directory.v2`);
	assert.equal(legacyOpenRes.status, 200);
	const legacyOpen = (await legacyOpenRes.json()) as {
		record: Record<string, unknown>;
	};
	assert.equal(legacyOpen.record.id, id(502));
	assert.equal(legacyOpen.record.ref, "V-102");
	assert.equal(legacyOpen.record.owner_label, "Example Dell");

	// Missing or non-vendor UUID returns 404 RECORD_NOT_FOUND.
	assert.equal(
		(await get(`/${id(104)}?contract=vendor-directory.v2`)).status,
		404,
	);
	// Without DIRECTORY_READ_SCHEMA=next, the route reads public (engine_reader lacks public select).
	const publicRes = await get("?contract=vendor-directory.v1", null);
	assert.deepEqual(
		[publicRes.status, await publicRes.json()],
		[503, { error: "DEPENDENCY_NOT_PROVISIONED", dependency: "read_access" }],
	);
});
