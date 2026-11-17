import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const copy = await readSchema("copy-deals.sql");
const { db, setup, cleanup } = copyTest();
const rows = async (sql: string) => (await db.query(sql)).rows;
// A run starts clear of the temp tables an earlier run in the same transaction left.
const run = async (): Promise<pg.QueryResultRow[]> => {
	const result = await db.query(`discard temp; ${copy}`);
	assert.ok(Array.isArray(result));
	return result.at(-1)?.rows ?? [];
};
const deal = (n: number, type = "lease") => `insert into public.deal
 (id, client_id, name, deal_type, phase, owner, created_by, updated_by, created_at, updated_at)
 values ('${id(n)}', '${id(3)}', 'Example deal ${n}', '${type}', 'negotiation', 'partner_one', '${id(1)}', '${id(1)}', '2025-01-01', '2025-02-01');`;
let report: pg.QueryResultRow[];
before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'partner_one', 'human', 'Example User');
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User'), ('${id(2)}', 'company', 'Example Client'),
 ('${id(4)}', 'person', 'Example Agent'), ('${id(5)}', 'person', 'Example Other');
 insert into app_user (id, slug) values ('${id(1)}', 'user-${id(1)}');
 insert into how_found values ('referral', 'Example referral');
 update party set how_found = 'referral';
 insert into role (slug, label) values ('client', 'Example client');
 insert into party_role (party_id, role) values ('${id(2)}', 'client'), ('${id(5)}', 'client');
 insert into outside_id (source, value, party_id) values ('old_system', '${id(1)}', '${id(1)}'),
 ('old_system', '${id(2)}', '${id(2)}'), ('old_system', '${id(6)}', '${id(2)}'),
 ('old_system', '${id(4)}', '${id(4)}'), ('old_system', '${id(5)}', '${id(5)}');
 insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 1);
 insert into public.party (id, kind, name, created_by, updated_by) values ('${id(2)}', 'org', 'Example Client', '${id(1)}', '${id(1)}');
 insert into public.party (id, kind, name, created_by, updated_by) select v, 'person', 'Example contact', '${id(1)}', '${id(1)}' from unnest(array['${id(4)}'::uuid, '${id(5)}'::uuid, '${id(6)}'::uuid]) v;
 insert into public.client (id, party_id, created_by, updated_by) values ('${id(3)}', '${id(6)}', '${id(1)}', '${id(1)}');
 insert into public.deal_type_ref (slug, label, sort) select s, s, 1 from unnest(array['lease','purchase','sale_leaseback','build_to_suit','startup','relocation','expansion','renewal','additional_office','other']) s;
 insert into public.deal_phase (slug, label) values ('negotiation', 'Example negotiation'), ('closed', 'Example closed');
 insert into public.participant_role (slug, label) values ('listing_side', 'Example listing agent'), ('lead', 'Example owner'), ('landlord_side', 'Example landlord'), ('lender', 'Example lender'), ('attorney', 'Example attorney'), ('other_vendor', 'Example vendor'), ('support', 'Example support');
 insert into public.vendor_market (slug, name, kind, boundary, source, reviewed_by, reviewed_at) values ('example-market', 'Example Market', 'market', 'Example counties', 'Example review', '${id(1)}', '2025-01-01');
 ${["lease", "purchase", "sale_leaseback", "build_to_suit", "startup", "relocation", "expansion", "renewal", "additional_office", "other"].map((t, i) => deal(10 + i, t)).join("\n")}
 ${deal(20)} ${deal(21)}
 ${deal(22)} ${deal(23)} ${deal(24)} ${deal(25)} ${deal(26)} ${deal(27)} ${deal(28)}
 alter table public.deal disable trigger deal_touch;
 update public.deal set city = 'Missing Market' where id = '${id(20)}';
 update public.deal set won_value = 0 where id = '${id(21)}';
 update public.deal set owner = null where id in ('${id(22)}', '${id(23)}');
 update public.deal set phase = 'closed', invoiced_on = '2025-03-01' where id = '${id(23)}';
 update public.deal set outcome = 'lost' where id = '${id(28)}';
 update public.deal set city = 'Example Market', won_value = 1234 where id = '${id(10)}';
 insert into public.deal_participant (id, deal_id, actor_id, role, set_by) values ('${id(80)}', '${id(23)}', '${id(1)}', 'lead', '${id(1)}');
 insert into public.deal_participant (deal_id, party_id, role, set_by) values
 ('${id(10)}', '${id(4)}', 'landlord_side', '${id(1)}'), ('${id(24)}', '${id(4)}', 'listing_side', '${id(1)}'),
 ('${id(24)}', '${id(5)}', 'listing_side', '${id(1)}');
 insert into public.building (id, address, created_by, updated_by) values ('${id(90)}', '100 Example Way', '${id(1)}', '${id(1)}'), ('${id(91)}', '200 Example Way', '${id(1)}', '${id(1)}');
 update public.building set name = 'Example Building', class = 'A', sub_type = 'medical_dental', year_built = 1998, stories = 3,
 status = 'existing', status_source = 'Example county record' where id = '${id(90)}';
 update public.building set name = ' ', class = '', sub_type = ' ' where id = '${id(91)}';
 insert into public.space (id, building_id, created_by, updated_by) values ('${id(92)}', '${id(90)}', '${id(1)}', '${id(1)}'), ('${id(93)}', '${id(91)}', '${id(1)}', '${id(1)}');
 insert into public.premises (id, deal_id, label, created_by) values ('${id(94)}', '${id(10)}', 'Example', '${id(1)}'), ('${id(95)}', '${id(26)}', 'Example', '${id(1)}');
 insert into public.premises_space values ('${id(94)}', '${id(92)}'), ('${id(95)}', '${id(92)}'), ('${id(95)}', '${id(93)}');
 insert into public.negotiation_round (id, deal_id, round_no, side, proposed_on, created_at, created_by) values
 ('${id(100)}', '${id(10)}', 1, 'tenant', '2025-01-01', '2025-01-01', '${id(1)}'),
 ('${id(101)}', '${id(10)}', 1, 'landlord', '2025-01-01', '2025-01-01', '${id(1)}'),
 ('${id(102)}', '${id(25)}', 1, 'landlord', '2025-01-01', '2025-01-01', '${id(1)}'),
 ('${id(103)}', '${id(24)}', 1, 'landlord', '2025-01-01', '2025-01-01', '${id(1)}'),
 ('${id(105)}', '${id(10)}', 7, 'tenant', '2024-12-01', '2024-12-01', '${id(1)}'),
 ('${id(106)}', '${id(22)}', 1, 'tenant', '2025-01-01', '2025-01-01', '${id(1)}'),
 ('${id(104)}', '${id(26)}', 1, 'tenant', '2025-01-01', '2025-01-01', '${id(1)}');
 insert into public.event (id, subject_type, subject_id, field, new_value, occurred_at, actor_id, verb, cause) values
 ('${id(110)}', 'deal', '${id(10)}', 'phase', '{"phase":"negotiation"}', '2025-01-02', '${id(1)}', 'update-deal', 'human_stated'),
 ('${id(111)}', 'deal', '${id(10)}', 'phase', '{"phase":"closed"}', '2025-02-02', '${id(1)}', 'update-deal', 'human_stated');
 insert into public.negotiation_claim_type (slug, label, falsifiable, reversal_test, sort) values ('example', 'Example claim', true, 'Example evidence', 1);
 insert into public.negotiation_claim (id, round_id, claim_type, created_by) values ('${id(120)}', '${id(100)}', 'example', '${id(1)}'), ('${id(121)}', '${id(102)}', 'example', '${id(1)}');
 update public.negotiation_round set rate_amount = 2, rate_basis = 'usd_sf_mo', term_months = 60, ti_amount = 20, ti_basis = 'usd_sf', free_rent_months = 2, note = 'Example original terms' where id = '${id(100)}';
 commit;`);
	await db.query(`begin; create temp table copy_market_county (market_slug text not null, county_fips text not null) on commit drop;
insert into copy_market_county values ('example-market', '01001');`);
	await db.query(await readSchema("copy-markets.sql"));
	await db.query("commit; begin");
	report = await run();
	await db.query("commit");
	assert.deepEqual(
		await rows(
			"select relname from pg_class where relnamespace = pg_my_temp_schema()",
		),
		[],
		"no copier temp table outlives its transaction",
	);
});
after(cleanup);

test("types split into kind and reason, with startup renamed and other kept as a kind", async () => {
	const result = await rows(
		`select kind, reason from deal where id between '${id(10)}' and '${id(19)}' order by id`,
	);
	assert.deepEqual(result, [
		...["lease", "purchase", "sale_leaseback", "build_to_suit"].map((kind) => ({
			kind,
			reason: null,
		})),
		...["start_up", "relocation", "expansion", null, "additional_office"].map(
			(reason) => ({ kind: null, reason }),
		),
		{ kind: "other", reason: null },
	]);
	assert.ok(
		!report.some((r) => r.field === "deal_type" && r.value === "other"),
	);
});
test("deals preserve identity, times, owner, market and value, and client links use the old-id map", async () => {
	// biome-ignore format: one row per imported deal
	assert.deepEqual((await rows(`select name, owner_user_id, market_id, closed_value, created_at::text, changed_at::text, changed_by_user_id from deal where id = '${id(10)}'`)).map(Object.values), [
 ["Example deal 10", id(1), "a21dfc2b-f197-e0af-15a5-9603db608073", "1234.00", "2025-01-01 00:00:00+00", "2025-02-01 00:00:00+00", id(1)],
 ]);
	assert.deepEqual(
		await rows(
			`select party_id, role from deal_party where deal_id = '${id(10)}' order by role`,
		),
		[
			{ party_id: id(2), role: "client" },
			{ party_id: id(4), role: "property_owner" },
		],
	);
	assert.deepEqual(
		await rows(`select deal_id from outside_id where value = '${id(10)}'`),
		[{ deal_id: id(10) }],
	);
	assert.equal(
		(await rows(`select owner_user_id from deal where id = '${id(23)}'`))[0]
			?.owner_user_id,
		id(1),
	);
	for (const [n, reason] of [
		[20, "unknown_market"],
		[21, "nonpositive_value"],
		[22, "no_deal_owner"],
	] as const)
		assert.ok(
			report.some((r) => r.old_id === id(n) && r.reason === reason),
			reason,
		);
});
test("phase events retain evidence dates and actors; without them the current phase holds from the last change", async () => {
	assert.deepEqual(
		await rows(
			`select phase, happened_at::text, changed_by_user_id from deal_phase_change where deal_id = '${id(10)}' order by happened_at`,
		),
		["negotiation", "closed"].map((phase, i) => ({
			phase,
			happened_at: i ? "2025-02-02 00:00:00+00" : "2025-01-02 00:00:00+00",
			changed_by_user_id: id(1),
		})),
	);
	assert.deepEqual(
		await rows(
			`select phase, happened_at::text, changed_by_job from deal_phase_change where deal_id = '${id(11)}'`,
		),
		[
			{
				phase: "negotiation",
				happened_at: "2025-02-01 00:00:00+00",
				changed_by_job: "old_system",
			},
		],
	);
	assert.ok(
		report.some((r) => r.old_id === id(11) && r.reason === "no_phase_history"),
	);
	assert.deepEqual(
		await rows(
			`select phase from deal_phase_change where deal_id = '${id(28)}'`,
		),
		[],
		"a lost deal without events gets no phase",
	);
	assert.ok(
		report.some(
			(r) => r.old_id === id(28) && r.reason === "lost_without_dated_reason",
		),
	);
});
test("an invoiced deal keeps today's invoiced date without a commission", async () => {
	assert.deepEqual(
		await rows("select deal_id, invoiced_on::text from deal_invoiced"),
		[{ deal_id: id(23), invoiced_on: "2025-03-01" }],
	);
});
test("rounds derive unique candidates, number across sides by creation then id, and retain unknown imported status", async () => {
	const rounds = report.filter((r) => r.field === "negotiation_round");
	assert.deepEqual(
		rounds.map((r) => [r.old_id, r.reason]),
		[
			[102, "no_property"],
			[102, "no_sender_candidate"],
			[103, "no_property"],
			[103, "several_sender_candidates"],
			[104, "several_properties"],
			[106, "deal_not_copied"],
		].map(([n, reason]) => [id(Number(n)), reason]),
	);
	assert.deepEqual(
		await rows(
			"select id, round, status, answers_round, from_party_id, from_role, import_record ->> 'side' as side, import_record ->> 'round_no' as old_round from offer order by round",
		),
		[
			[105, 1, 2, "client", "tenant", "7"],
			[100, 2, 2, "client", "tenant", "1"],
			[101, 3, 4, "property_owner", "landlord", "1"],
		].map(([n, round, party, role, side, old_round]) => ({
			id: id(Number(n)),
			round,
			status: "unknown",
			answers_round: null,
			from_party_id: id(Number(party)),
			from_role: role,
			side,
			old_round,
		})),
	);
	assert.deepEqual(
		await rows(
			"select deal_id, property_id from deal_property order by deal_id, property_id",
		),
		[
			{ deal_id: id(10), property_id: id(90) },
			{ deal_id: id(26), property_id: id(90) },
			{ deal_id: id(26), property_id: id(91) },
		],
	);
	assert.deepEqual(
		await rows(
			`select rent_per_sf_yr, term_months, ti_per_sf, free_rent_months from offer where id = '${id(100)}'`,
		),
		[
			{
				rent_per_sf_yr: "24.00",
				term_months: 60,
				ti_per_sf: "20.00",
				free_rent_months: "2.0",
			},
		],
	);
	assert.deepEqual(
		report
			.filter((r) => r.field === "negotiation_claim")
			.map((r) => [r.old_id, r.reason]),
		[[id(121), "round_not_copied"]],
	);
	assert.deepEqual(
		await rows(`select import_record from offer where id = '${id(100)}'`),
		await rows(
			`select to_jsonb(r) as import_record from public.negotiation_round r where id = '${id(100)}'`,
		),
	);
});
test("a property keeps its building's name, class, type, year built and stories, a blank one stays unknown, and only its construction status is listed", async () => {
	assert.deepEqual(
		await rows(
			"select id, name, building_class, building_type, year_built, stories from property order by id",
		),
		[
			{
				id: id(90),
				name: "Example Building",
				building_class: "A",
				building_type: "medical_dental",
				year_built: 1998,
				stories: 3,
			},
			{
				id: id(91),
				name: null,
				building_class: null,
				building_type: null,
				year_built: null,
				stories: null,
			},
		],
	);
	assert.deepEqual(
		report
			.filter((r) => r.reason === "unmapped_building_fields")
			.map((r) => [r.old_id, r.value]),
		[
			[
				id(90),
				'{"status": "existing", "status_source": "Example county record"}',
			],
		],
	);
});

test("a repeat is idempotent and restores stamps after import", async () => {
	const original = await rows("select * from deal order by id");
	const properties = await rows("select * from property order by id");
	const offers = await rows("select * from offer order by id");
	const claims = await rows(
		"select * from offer_claim order by offer_id, claim_type",
	);
	await db.query("begin");
	assert.deepEqual(await run(), report, "a rerun lists the same corrections");
	await db.query("commit");
	assert.deepEqual(await rows("select * from deal order by id"), original);
	assert.deepEqual(
		await rows("select * from property order by id"),
		properties,
	);
	assert.deepEqual(await rows("select * from offer order by id"), offers);
	assert.deepEqual(
		await rows("select * from offer_claim order by offer_id, claim_type"),
		claims,
	);
	await db.query(
		`begin; select set_config('engine.user_id', '${id(1)}', true); update deal set name = 'Example renamed' where id = '${id(10)}'`,
	);
	assert.equal(
		(
			await rows(`select changed_by_user_id from deal where id = '${id(10)}'`)
		)[0]?.changed_by_user_id,
		id(1),
	);
	await db.query("rollback");
});

test("a rerun lists a market or value the copied deal still lacks, even once the old deal has it", async () => {
	await db.query("begin");
	try {
		await db.query(`select set_config('engine.job', 'old_system', true);
 insert into market (name) values ('Missing Market');
 update public.deal set won_value = 500 where id = '${id(21)}';`);
		const listed = await run();
		for (const [n, reason] of [
			[20, "unknown_market"],
			[21, "nonpositive_value"],
		] as const)
			assert.ok(
				listed.some((r) => r.old_id === id(n) && r.reason === reason),
				reason,
			);
	} finally {
		await db.query("rollback");
	}
});

test("unmappable links and phase history are listed instead of lost", async () => {
	await db.query("begin");
	try {
		await db.query(`select set_config('engine.job', 'old_system', true);
 update public.deal set outcome = 'lost' where id in ('${id(11)}', '${id(12)}');
 insert into public.event (subject_type, subject_id, field, new_value, occurred_at, actor_id, verb, cause, human_quote) values
 ('deal', '${id(12)}', 'outcome', '{"outcome":"lost"}', '2025-07-01', '${id(1)}', 'update-deal', 'human_stated', 'Example client stopped');
 update public.client set party_id = '${id(5)}' where id = '${id(3)}';
 insert into public.deal_participant (deal_id, party_id, role, set_by) values ('${id(10)}', '${id(5)}', 'support', '${id(1)}');
 delete from outside_id where value = '${id(4)}';
   insert into public.deal_vendor_assignment (deal_id, party_id, role, company_party_id, contact_party_id, updated_by)
   values ('${id(10)}', '${id(5)}', 'lender', '${id(5)}', '${id(5)}', '${id(1)}');
   insert into public.deal_participant (deal_id, party_id, role, set_by, to_at) values ('${id(10)}', '${id(4)}', 'landlord_side', '${id(1)}', '2025-03-01');
   insert into public.event (subject_type, subject_id, field, new_value, occurred_at, actor_id, verb, cause) values
   ('deal', '${id(10)}', 'phase', '{"phase":"missing"}', '2025-04-01', '${id(1)}', 'update-deal', 'human_stated'),
   ('deal', '${id(10)}', 'phase', '{"phase":"dead"}', '2025-05-01', '${id(1)}', 'update-deal', 'human_stated'),
   ('deal', '${id(10)}', 'phase', '{"phase":"closed"}', '2025-06-01', '${id(1)}', 'update-deal', 'human_stated'),
   ('deal', '${id(10)}', 'phase', '{"phase":"negotiation"}', '2025-06-01', '${id(1)}', 'update-deal', 'human_stated');
   update public.event set new_value = '{"phase":"closed"}' where id = '${id(110)}';`);
		const refused = await run();
		for (const reason of [
			"party_not_copied",
			"role_not_available",
			"deal_not_copied",
			"unknown_phase",
			"dead_without_reason",
			"same_time_phase_changes",
			"existing_phase_conflict",
			"current_phase_differs",
			"lost_without_dated_reason",
			"deal_has_another_client",
		])
			assert.ok(
				refused.some((r) => r.reason === reason),
				reason,
			);
		assert.equal(
			(
				await rows(
					`select phase from deal_phase_change where deal_id = '${id(12)}' order by happened_at desc`,
				)
			)[0]?.phase,
			"dead",
		);
		assert.equal(
			(
				await rows(
					`select count(*)::int as n from deal_party where deal_id = '${id(10)}' and party_id = '${id(5)}'`,
				)
			)[0]?.n,
			1,
		);
		assert.deepEqual(
			await rows(
				"select slug from role where slug in ('lender', 'attorney', 'other_vendor')",
			),
			[],
		);
	} finally {
		await db.query("rollback");
	}
});

test("shared attribution carries agent and mail sponsorship onto deals, clients and phase changes", async () => {
	await db.query("begin");
	try {
		await db.query(`
   insert into public.actor (id, slug, kind, display_name) values ('${id(200)}', 'codex', 'automation', 'Example agent'), ('${id(201)}', 'example-mail', 'automation', 'Example mail');
   ${deal(30)} ${deal(31)}
   update public.deal set updated_by = '${id(200)}' where id = '${id(30)}';
   update public.deal set updated_by = '${id(201)}' where id = '${id(31)}';
   insert into public.event (actor_id, verb, subject_type, subject_id, field, cause, occurred_at, new_value, sponsoring_human_slug) values
   ('${id(200)}', 'example', 'deal', '${id(30)}', 'phase', 'human_stated', '2025-02-01', '{"phase":"negotiation"}', null),
   ('${id(201)}', 'example', 'deal', '${id(31)}', 'phase', 'system', '2025-02-01', '{"phase":"negotiation"}', null),
   ('${id(200)}', 'example', 'deal', '${id(30)}', 'phase', 'human_stated', '2025-03-01', '{"phase":"negotiation"}', 'partner_one'),
   ('${id(201)}', 'example', 'deal', '${id(31)}', 'phase', 'ingest_email', '2025-03-01', '{"phase":"negotiation"}', 'partner_one');
   update public.deal set owner = 'partner_one' where id in ('${id(30)}', '${id(31)}');`);
		await run();
		for (const table of ["deal", "deal_party", "deal_phase_change"]) {
			const key = table === "deal" ? "id" : "deal_id";
			assert.deepEqual(
				(
					await rows(
						`select changed_by_user_id, changed_by_job, changed_for_user_id from ${table} where ${key} in ('${id(30)}', '${id(31)}') ${table === "deal_phase_change" ? "and happened_at = '2025-03-01'" : ""} order by ${key}`,
					)
				).map(Object.values),
				[
					[null, "agent", id(1)],
					[null, "mail_capture", id(1)],
				],
				table,
			);
		}
		assert.deepEqual(
			(
				await rows(
					`select changed_by_job, changed_for_user_id from deal_phase_change where deal_id in ('${id(30)}', '${id(31)}') and happened_at = '2025-02-01' order by deal_id`,
				)
			).map(Object.values),
			[
				["agent", null],
				["old_system", null],
			],
		);
	} finally {
		await db.query("rollback");
	}
});

test("a client without its required role is listed once", async () => {
	await db.query("begin");
	try {
		await db.query(
			`update public.client set party_id = '${id(4)}' where id = '${id(3)}'`,
		);
		const reasons = (await run()).map((row) => row.reason);
		assert.ok(reasons.includes("client_role_not_available"));
		assert.ok(!reasons.includes("deal_has_another_client"));
	} finally {
		await db.query("rollback");
	}
});

test("participant and vendor links keep their deal event's sponsoring user", async () => {
	await db.query("begin");
	try {
		await db.query(`select set_config('engine.job', 'old_system', true);
 insert into public.actor (id, slug, kind, display_name) values ('${id(200)}', 'codex', 'automation', 'Example agent');
 ${deal(30)} ${deal(31)}
 insert into role (slug, label, category_of) values ('lender', 'Example lender', 'vendor');
 insert into public.deal_participant (deal_id, party_id, role, set_by) values ('${id(30)}', '${id(4)}', 'support', '${id(200)}');
 insert into public.deal_vendor_assignment (deal_id, party_id, role, company_party_id, contact_party_id, updated_by)
 values ('${id(31)}', '${id(5)}', 'lender', '${id(5)}', '${id(5)}', '${id(200)}');
 insert into public.event (actor_id, verb, subject_type, subject_id, field, cause, occurred_at, sponsoring_human_slug) values
 ('${id(200)}', 'example', 'deal', '${id(30)}', 'participant', 'human_stated', '2025-03-01', 'partner_one'),
 ('${id(200)}', 'example', 'deal', '${id(31)}', 'vendor_assignment', 'human_stated', '2025-03-01', 'partner_one'),
 ('${id(200)}', 'example', 'deal', '${id(31)}', 'phase', 'human_stated', '2025-03-02', null);`);
		await run();
		assert.deepEqual(
			(
				await rows(`select role, changed_by_user_id, changed_by_job, changed_for_user_id from deal_party
 where deal_id in ('${id(30)}', '${id(31)}') and role in ('support', 'lender') order by deal_id`)
			).map(Object.values),
			[
				["support", null, "agent", id(1)],
				["lender", null, "agent", id(1)],
			],
		);
	} finally {
		await db.query("rollback");
	}
});

test("a renewal without a source lease keeps its old type in the needs-a-user report", async () => {
	assert.deepEqual(
		await rows(
			`select reason, renews_lease_id from deal where id = '${id(17)}'`,
		),
		[{ reason: null, renews_lease_id: null }],
	);
	assert.ok(
		report.some(
			(row) =>
				row.old_id === id(17) &&
				row.field === "deal_type" &&
				row.value === "renewal" &&
				row.reason === "renewal_without_lease",
		),
	);
});

const refused = async (sql: string, code: string) => {
	await db.query("savepoint refused");
	try {
		await assert.rejects(db.query(sql), { code });
	} finally {
		await db.query("rollback to refused");
	}
};

test("only an owner import may create unknown status; users and jobs cannot supply provenance", async () => {
	await db.query("begin; select set_config('engine.job', 'agent', true)");
	try {
		const insert = (status: string, provenance = "") =>
			`insert into offer (deal_id, property_id, round, from_party_id, from_role, offered_at, status ${provenance ? ", import_source, import_id, import_record" : ""}) values ('${id(10)}', '${id(90)}', 20, '${id(2)}', 'client', now(), '${status}' ${provenance})`;
		await refused(insert("unknown"), "23514");
		await refused(insert("unknown", ", 'old_system', null, '{}'"), "23514");
		await refused(
			insert("unknown", ", 'old_system', 'example', null"),
			"23514",
		);
		await refused(
			insert("unknown", `, 'old_system', '${id(100)}', '{}'`),
			"23505",
		);
		for (const source of ["", "OldSystem", "with-dash", "1source"])
			await refused(
				insert("unknown", `, '${source}', 'example', '{}'`),
				"23514",
			);
		for (const value of ["", " leading", "trailing "])
			await refused(
				insert("unknown", `, 'old_system', '${value}', '{}'`),
				"23514",
			);
		for (const actor of [
			`select set_config('engine.user_id', '${id(1)}', true), set_config('engine.job', '', true)`,
			"select set_config('engine.user_id', '', true), set_config('engine.job', 'old_system', true)",
		]) {
			await db.query(actor);
			await db.query("set local role engine");
			await refused(insert("unknown"), "23514");
			await refused(
				insert("unknown", ", 'old_system', 'example', '{}'"),
				"42501",
			);
			await db.query(insert("open"));
			await refused(
				`update offer set status = 'unknown' where round = 20`,
				"23514",
			);
			await refused(
				`update offer set import_source = 'example' where id = '${id(100)}'`,
				"42501",
			);
			await db.query("reset role");
			await db.query("delete from offer where round = 20");
		}
	} finally {
		await db.query("rollback");
	}
});

test("unknown can resolve to every real status, with normal acceptance and supersession rules", async () => {
	for (const status of [
		"open",
		"countered",
		"accepted",
		"rejected",
		"withdrawn",
		"superseded",
	]) {
		await db.query(
			"begin; select set_config('engine.job', 'agent', true); set constraints all immediate; set local role engine",
		);
		try {
			if (status === "superseded") {
				await refused(
					`update offer set status = 'superseded' where id = '${id(105)}'`,
					"23514",
				);
				await db.query(
					`update offer set status = 'accepted' where id = '${id(101)}'`,
				);
			}
			await db.query(
				`update offer set status = '${status}' where id = '${id(105)}'`,
			);
			await db.query("set constraints all immediate");
			assert.equal(
				(await rows(`select status from offer where id = '${id(105)}'`))[0]
					?.status,
				status,
			);
			await refused(
				`update offer set status = 'unknown' where id = '${id(105)}'`,
				"23514",
			);
			if (status === "accepted")
				await refused(
					`update offer set status = 'accepted' where id = '${id(100)}'`,
					"23505",
				);
		} finally {
			await db.query("rollback");
		}
	}
});

test("building survivors keep full addresses and copied rows keep source authors and times", async () => {
	await db.query("begin; select set_config('engine.job', 'old_system', true)");
	try {
		await db.query(`delete from offer_claim; delete from offer; delete from deal_property; delete from property;
 update public.building set city = 'Example City', state = 'TX', zip = '75000' where id = '${id(90)}';
 update public.building set merged_into = '${id(90)}' where id = '${id(91)}';
 delete from public.premises_space where premises_id = '${id(95)}' and space_id = '${id(92)}';`);
		await run();
		assert.deepEqual(await rows("select id, address from property"), [
			{ id: id(90), address: "100 Example Way, Example City, TX, 75000" },
		]);
		assert.equal((await rows("select count(*)::int as n from offer"))[0]?.n, 4);
		assert.deepEqual(
			await rows(
				`select o.changed_by_user_id, o.changed_at = r.updated_at as same_time from offer o join public.negotiation_round r on r.id = o.id where o.id = '${id(100)}'`,
			),
			[{ changed_by_user_id: id(1), same_time: true }],
		);
		assert.deepEqual(
			await rows(
				`select n.changed_by_user_id, n.changed_at = b.updated_at as same_time from property n join public.building b on b.id = n.id`,
			),
			[{ changed_by_user_id: id(1), same_time: true }],
		);
		assert.deepEqual(
			await rows(
				`select n.changed_by_user_id, n.created_at = p.created_at as same_time from deal_property n join public.premises p on p.deal_id = n.deal_id order by n.deal_id`,
			),
			[
				{ changed_by_user_id: id(1), same_time: true },
				{ changed_by_user_id: id(1), same_time: true },
			],
		);
		const result = await rows(
			`select everything_about_deal('${id(10)}') as deal`,
		);
		assert.ok(result[0]);
		for (const offer of result[0].deal.offers)
			for (const key of ["import_source", "import_id", "import_record"])
				assert.equal(key in offer, false);
	} finally {
		await db.query("rollback");
	}
});

test("round collisions, ambiguous roles and untyped terms are listed without aborting the copy", async () => {
	await db.query("begin; select set_config('engine.job', 'old_system', true)");
	try {
		await db.query(`insert into offer (id, deal_id, property_id, round, from_party_id, from_role, offered_at) values ('${id(200)}', '${id(10)}', '${id(90)}', 4, '${id(2)}', 'client', now());
 insert into public.negotiation_round (id, deal_id, round_no, side, proposed_on, created_at, created_by, rate_amount, rate_basis, ti_amount, ti_basis) values ('${id(107)}', '${id(10)}', 8, 'tenant', '2025-03-01', '2025-03-01', '${id(1)}', 1000, 'usd_mo_gross', 10000, 'usd_total');`);
		await db.query("savepoint copy_attempt");
		let result = await run();
		assert.ok(
			result.some(
				(r) => r.old_id === id(107) && r.reason === "round_number_unavailable",
			),
		);
		await db.query(
			`rollback to copy_attempt; delete from offer where id = '${id(200)}'`,
		);
		result = await run();
		assert.deepEqual(
			result
				.filter((r) => r.old_id === id(107))
				.map((r) => [r.field, r.reason]),
			[
				["rate_amount", "no_typed_destination"],
				["ti_amount", "no_typed_destination"],
			],
		);
		assert.equal(
			(
				await rows(
					`select import_record ->> 'ti_amount' as ti from offer where id = '${id(107)}'`,
				)
			)[0]?.ti,
			"10000.00",
		);
		await db.query(`rollback to copy_attempt; insert into public.deal_participant (deal_id, party_id, role, set_by) values ('${id(10)}', '${id(4)}', 'listing_side', '${id(1)}');
 insert into public.negotiation_round (id, deal_id, round_no, side, proposed_on, created_at, created_by) values ('${id(108)}', '${id(10)}', 8, 'landlord', '2025-04-01', '2025-04-01', '${id(1)}');`);
		result = await run();
		assert.ok(
			result.some(
				(r) => r.old_id === id(108) && r.reason === "several_sender_roles",
			),
		);
		assert.ok(!result.some((r) => r.old_id === id(101)));
		assert.equal(
			(
				await rows(
					`select count(*)::int as n from offer where id = '${id(108)}'`,
				)
			)[0]?.n,
			0,
		);
	} finally {
		await db.query("rollback");
	}
});

test("merge loops terminate and list each affected building once, only for copied deals", async () => {
	await db.query("begin");
	try {
		await db.query(`update public.building set merged_into = '${id(91)}' where id = '${id(90)}';
 update public.building set merged_into = '${id(90)}' where id = '${id(91)}';
 insert into public.building (id, address, created_by, updated_by, merged_into) values ('${id(89)}', '300 Example Way', '${id(1)}', '${id(1)}', '${id(89)}');
 insert into public.space (id, building_id, created_by, updated_by) values ('${id(98)}', '${id(89)}', '${id(1)}', '${id(1)}');
 insert into public.premises (id, deal_id, label, created_by) values ('${id(96)}', '${id(10)}', 'Example duplicate', '${id(1)}'), ('${id(97)}', '${id(22)}', 'Example refused', '${id(1)}');
 insert into public.premises_space values ('${id(96)}', '${id(92)}'), ('${id(97)}', '${id(98)}');`);
		const chain = copy.match(
			/create temp table building_map on commit drop as\n(with recursive chain as \([\s\S]*?\n\))/,
		)?.[1];
		assert.ok(chain);
		// Three starts and two merge steps exhaust these loops; a sixth row means a revisit.
		assert.equal(
			(await rows(`${chain} select old_id, id from chain limit 6`)).length,
			5,
		);
		assert.deepEqual(
			(await run())
				.filter((r) => r.reason === "building_merge_unresolved")
				.map((r) => r.old_id),
			[id(90), id(91)],
		);
	} finally {
		await db.query("rollback");
	}
});

test("an existing offer id is listed without aborting unrelated imports", async () => {
	await db.query("begin; select set_config('engine.job', 'old_system', true)");
	try {
		await db.query(`insert into offer (id, deal_id, property_id, round, from_party_id, from_role, offered_at) values ('${id(107)}', '${id(10)}', '${id(90)}', 20, '${id(2)}', 'client', now());
 insert into public.negotiation_round (id, deal_id, round_no, side, proposed_on, created_at, created_by) values ('${id(107)}', '${id(10)}', 8, 'tenant', '2025-03-01', '2025-03-01', '${id(1)}'), ('${id(108)}', '${id(10)}', 9, 'tenant', '2025-04-01', '2025-04-01', '${id(1)}');`);
		assert.deepEqual(
			(await run()).filter((r) => r.old_id === id(107)).map((r) => r.reason),
			["offer_id_unavailable"],
		);
		assert.deepEqual(
			await rows(
				`select round, import_source from offer where id = '${id(107)}'`,
			),
			[{ round: 20, import_source: null }],
		);
		assert.equal(
			(await rows(`select import_id from offer where id = '${id(108)}'`))[0]
				?.import_id,
			id(108),
		);
	} finally {
		await db.query("rollback");
	}
});

test("offer notes stay visible, a known submarket condition copies and any other is listed, and proposed dates use Chicago in every session zone", async () => {
	await db.query(
		"begin; select set_config('engine.job', 'old_system', true); set local TimeZone = 'Asia/Tokyo'",
	);
	try {
		await db.query(`insert into public.submarket_condition (slug, label, tightness, note, sort) values ('example', 'Example condition', 0, 'Example source', 1), ('tight', 'Tight', 1, 'Example source', 2);
 insert into public.negotiation_round (id, deal_id, round_no, side, proposed_on, created_at, created_by, escalator, options_note, opex_note, note, submarket_condition) values ('${id(107)}', '${id(10)}', 8, 'tenant', '2025-03-01', '2025-03-01', '${id(1)}', '3% yearly', 'One renewal', 'Expenses capped', 'Example general note', 'example'), ('${id(108)}', '${id(10)}', 9, 'tenant', '2025-07-01', '2025-07-01', '${id(1)}', null, null, null, null, 'tight');`);
		assert.deepEqual(
			(await run())
				.filter((r) => [id(107), id(108)].includes(r.old_id))
				.map((r) => [r.old_id, r.field, r.value, r.reason]),
			[[id(107), "submarket_condition", "example", "no_typed_destination"]],
		);
		await db.query("set local TimeZone = 'UTC'");
		assert.deepEqual(
			await rows(
				`select other_terms, submarket_condition, offered_at::text from offer where id in ('${id(107)}', '${id(108)}') order by id`,
			),
			[
				{
					other_terms:
						"Escalator: 3% yearly\nOptions: One renewal\nOperating costs: Expenses capped\nNote: Example general note",
					submarket_condition: null,
					offered_at: "2025-03-01 06:00:00+00",
				},
				{
					other_terms: null,
					submarket_condition: "tight",
					offered_at: "2025-07-01 05:00:00+00",
				},
			],
		);
		const result = await rows(
			`select everything_about_deal('${id(10)}') -> 'offers' as offers`,
		);
		assert.ok(result[0]);
		assert.ok(
			result[0].offers.some(
				(o: { id: string; other_terms: string | null }) =>
					o.id === id(107) && o.other_terms?.includes("Expenses capped"),
			),
		);
	} finally {
		await db.query("rollback");
	}
});

test("claims keep source words, authors and dates, convert only per-square-foot floors, and list unresolved facts", async () => {
	await db.query("begin; select set_config('engine.job', 'old_system', true)");
	try {
		await db.query(`insert into public.negotiation_claim_type (slug, label, falsifiable, reversal_test, sort, derived)
 select slug, 'Example ' || slug, false, 'Example test', 10 + n, slug = 'deadline'
 from unnest(array['annual', 'monthly', 'gross_month', 'gross_year', 'total', 'sf_total', 'inferred', 'blank', 'overflow', 'deadline']) with ordinality t(slug, n);
 insert into public.negotiation_claim (id, round_id, claim_type, stated_floor, stated_floor_basis, quote, note, source, created_by, created_at) values
 ('${id(300)}', '${id(100)}', 'annual', 31, 'usd_sf_yr', 'Example stated floor', 'Example note', 'stated', '${id(1)}', '2025-03-01'),
 ('${id(301)}', '${id(100)}', 'monthly', 2.75, 'usd_sf_mo', null, null, 'stated', '${id(1)}', '2025-03-02');
 insert into public.negotiation_claim (id, round_id, claim_type, stated_floor, stated_floor_basis, created_by)
 select ('00000000-0000-4000-8000-' || lpad((302 + n)::text, 12, '0'))::uuid, '${id(100)}', slug, 100, basis, '${id(1)}'
 from (values (0, 'gross_month', 'usd_mo_gross'), (1, 'gross_year', 'usd_yr_gross'), (2, 'total', 'usd_total'), (3, 'sf_total', 'usd_sf_total')) t(n, slug, basis);
 insert into public.negotiation_claim (id, round_id, claim_type, quote, source, created_by, stated_floor, stated_floor_basis) values
 ('${id(306)}', '${id(100)}', 'inferred', 'Example inference', 'inferred', '${id(1)}', null, null),
 ('${id(307)}', '${id(100)}', 'blank', '  ', 'stated', '${id(1)}', null, null),
 ('${id(308)}', '${id(100)}', 'overflow', null, 'stated', '${id(1)}', 99999999, 'usd_sf_mo');`);
		const result = await run();
		assert.deepEqual(
			await rows(
				`select claim_type, floor_rent_per_sf_yr, quote, note, created_at::text, changed_at::text, changed_by_user_id from offer_claim where claim_type in ('annual', 'monthly') order by claim_type`,
			),
			[
				{
					claim_type: "annual",
					floor_rent_per_sf_yr: "31.00",
					quote: "Example stated floor",
					note: "Example note",
					created_at: "2025-03-01 00:00:00+00",
					changed_at: "2025-03-01 00:00:00+00",
					changed_by_user_id: id(1),
				},
				{
					claim_type: "monthly",
					floor_rent_per_sf_yr: "33.00",
					quote: null,
					note: null,
					created_at: "2025-03-02 00:00:00+00",
					changed_at: "2025-03-02 00:00:00+00",
					changed_by_user_id: id(1),
				},
			],
		);
		assert.deepEqual(
			result
				.filter((r) => r.field === "negotiation_claim" && r.old_id >= id(300))
				.map((r) => [r.old_id, r.reason]),
			[
				...Array.from({ length: 4 }, (_, i) => [
					id(302 + i),
					"unsupported_floor_basis",
				]),
				[id(306), "unsupported_claim_source"],
				[id(307), "blank_claim_text"],
				[id(308), "floor_out_of_range"],
			],
		);
		assert.deepEqual(
			await rows("select slug from claim_type where slug = 'deadline'"),
			[],
		);
		assert.equal(
			(await rows("select label from claim_type where slug = 'annual'"))[0]
				?.label,
			"Example annual",
		);
		assert.equal(
			(await rows("select count(*)::int as n from offer_claim"))[0]?.n,
			3,
		);
		assert.ok(
			result
				.filter((r) => r.field === "negotiation_claim")
				.every((r) => JSON.parse(r.value).round_id),
		);
	} finally {
		await db.query("rollback");
	}
});

test("claim conflicts stay listed, later claims can copy, and imported offers resolve through their source map", async () => {
	await db.query("begin; select set_config('engine.job', 'old_system', true)");
	try {
		await db.query(`insert into public.actor (id, slug, kind, display_name) values ('${id(200)}', 'codex', 'automation', 'Example agent');
 insert into public.negotiation_claim (id, round_id, claim_type, created_by, created_at) values ('${id(310)}', '${id(101)}', 'example', '${id(200)}', '2025-04-01');
 insert into public.event (actor_id, verb, subject_type, subject_id, cause, sponsoring_human_slug, occurred_at) values ('${id(200)}', 'example', 'negotiation_claim', '${id(310)}', 'human_stated', 'partner_one', '2025-04-01');
 update public.negotiation_claim set quote = 'Example changed words' where id = '${id(120)}';`);
		const result = await run();
		assert.ok(
			result.some(
				(r) => r.old_id === id(120) && r.reason === "existing_claim_conflict",
			),
		);
		assert.equal(
			(
				await rows(
					`select quote from offer_claim where offer_id = '${id(100)}'`,
				)
			)[0]?.quote,
			null,
		);
		assert.deepEqual(
			await rows(
				`select changed_by_user_id, changed_by_job, changed_for_user_id from offer_claim where offer_id = '${id(101)}'`,
			),
			[
				{
					changed_by_user_id: null,
					changed_by_job: "agent",
					changed_for_user_id: id(1),
				},
			],
		);
		await refused(
			`insert into offer_claim (offer_id, claim_type) values ('${id(101)}', 'example')`,
			"23505",
		);
	} finally {
		await db.query("rollback");
	}
});

test("claims use import identity rather than an unrelated offer with the old round id", async () => {
	await db.query("begin; select set_config('engine.job', 'old_system', true)");
	try {
		await db.query(`insert into public.negotiation_round (id, deal_id, round_no, side, proposed_on, created_at, created_by)
 values ('${id(320)}', '${id(10)}', 9, 'tenant', '2025-04-01', '2025-04-01', '${id(1)}');
 insert into public.negotiation_claim (id, round_id, claim_type, created_by) values ('${id(321)}', '${id(320)}', 'example', '${id(1)}');
 insert into offer (id, deal_id, property_id, round, from_party_id, from_role, offered_at)
 values ('${id(320)}', '${id(10)}', '${id(90)}', 20, '${id(2)}', 'client', now());`);
		assert.ok(
			(await run()).some(
				(r) => r.old_id === id(321) && r.reason === "round_not_copied",
			),
		);
		assert.deepEqual(
			await rows(`select * from offer_claim where offer_id = '${id(320)}'`),
			[],
		);
	} finally {
		await db.query("rollback");
	}
	await db.query("begin; select set_config('engine.job', 'old_system', true)");
	try {
		await db.query(`insert into public.negotiation_claim (id, round_id, claim_type, created_by) values ('${id(322)}', '${id(101)}', 'example', '${id(1)}');
 delete from offer where id = '${id(101)}';
 insert into offer (id, deal_id, property_id, round, from_party_id, from_role, offered_at, import_source, import_id, import_record)
 values ('${id(323)}', '${id(10)}', '${id(90)}', 3, '${id(4)}', 'property_owner', now(), 'old_system', '${id(101)}', '{}');`);
		await run();
		assert.deepEqual(
			await rows(
				`select offer_id from offer_claim where offer_id = '${id(323)}'`,
			),
			[{ offer_id: id(323) }],
		);
	} finally {
		await db.query("rollback");
	}
});

test("claims with uncopied authors or sponsors and blank notes wait for review", async () => {
	await db.query("begin; select set_config('engine.job', 'old_system', true)");
	try {
		await db.query(`insert into public.actor (id, slug, kind, display_name) values ('${id(330)}', 'partner_two', 'human', 'Example missing user'), ('${id(331)}', 'codex', 'automation', 'Example agent');
 insert into public.negotiation_claim (id, round_id, claim_type, created_by, note) values
 ('${id(332)}', '${id(101)}', 'example', '${id(330)}', null),
 ('${id(333)}', '${id(105)}', 'example', '${id(331)}', ' ');
 insert into public.event (actor_id, verb, subject_type, subject_id, cause, sponsoring_human_slug, occurred_at) values ('${id(331)}', 'example', 'negotiation_claim', '${id(333)}', 'human_stated', 'partner_two', '2025-04-01');`);
		const result = await run();
		assert.deepEqual(
			result
				.filter((r) => [id(332), id(333)].includes(r.old_id))
				.map((r) => [r.old_id, r.reason]),
			[
				[id(332), "claim_author_not_copied"],
				[id(333), "blank_claim_text"],
				[id(333), "claim_sponsor_not_copied"],
			],
		);
		assert.deepEqual(
			await rows(
				`select * from offer_claim where offer_id in ('${id(101)}', '${id(105)}')`,
			),
			[],
		);
	} finally {
		await db.query("rollback");
	}
});

test("parking reasons, trimmed notes, parking stamps and explicit attention flags copy without invented history", async () => {
	await db.query("begin");
	try {
		await db.query(`
 ${[400, 401, 402, 403, 404, 405, 406].map((n) => deal(n)).join("\n")}
 update public.deal set operating_state = 'parked', parking_reason = v.reason,
 parking_note = v.note, parked_at = '2025-01-15', parked_by = '${id(1)}', attention = v.attention
 from (values
 ('${id(400)}'::uuid, 'client_paused', E' \tExample pause\n ', true),
 ('${id(401)}'::uuid, 'prospect_never_active', null, false),
 ('${id(402)}'::uuid, 'other', E' \t\n ', true),
 ('${id(403)}'::uuid, 'other', 'Example other reason', false)) v(id, reason, note, attention)
 where public.deal.id = v.id;
 insert into public.actor (id, slug, kind, display_name) values ('${id(200)}', 'codex', 'automation', 'Example agent');
 update public.deal set parked_by = '${id(200)}' where id = '${id(403)}';
 update public.deal set attention = true where id = '${id(404)}';
 update public.deal set owner = null where id = '${id(406)}';`);
		const first = await run();
		const noPhaseHistory = (n: number) => ({
			old_id: id(n),
			field: "phase",
			value: "negotiation",
			reason: "no_phase_history",
		});
		assert.deepEqual(
			await rows(
				`select id, parking_reason, parking_note, needs_attention, parked_at::text, parked_by_user_id
 from deal where id >= '${id(400)}' order by id`,
			),
			[
				{
					id: id(400),
					parking_reason: "client_paused",
					parking_note: "Example pause",
					needs_attention: true,
					parked_at: "2025-01-15 00:00:00+00",
					parked_by_user_id: id(1),
				},
				{
					id: id(401),
					parking_reason: "prospect_never_active",
					parking_note: null,
					needs_attention: false,
					parked_at: "2025-01-15 00:00:00+00",
					parked_by_user_id: id(1),
				},
				{
					id: id(402),
					parking_reason: "other",
					parking_note: null,
					needs_attention: true,
					parked_at: "2025-01-15 00:00:00+00",
					parked_by_user_id: id(1),
				},
				{
					id: id(403),
					parking_reason: "other",
					parking_note: "Example other reason",
					needs_attention: false,
					parked_at: "2025-01-15 00:00:00+00",
					parked_by_user_id: null,
				},
				{
					id: id(404),
					parking_reason: null,
					parking_note: null,
					needs_attention: true,
					parked_at: null,
					parked_by_user_id: null,
				},
				{
					id: id(405),
					parking_reason: null,
					parking_note: null,
					needs_attention: false,
					parked_at: null,
					parked_by_user_id: null,
				},
			],
		);
		assert.deepEqual(
			first.filter((r) => r.old_id >= id(400)),
			[
				...[400, 401, 402].map(noPhaseHistory),
				{
					old_id: id(403),
					field: "parked_by",
					value: id(200),
					reason: "parker_not_a_user",
				},
				...[403, 404, 405].map(noPhaseHistory),
				{
					old_id: id(406),
					field: "deal",
					value: id(406),
					reason: "no_deal_owner",
				},
				noPhaseHistory(406),
			],
		);
		assert.deepEqual(
			await rows(
				`select deal_id, phase, happened_at::text from deal_phase_change where deal_id >= '${id(400)}' order by deal_id`,
			),
			[400, 401, 402, 403, 404, 405].map((n) => ({
				deal_id: id(n),
				phase: "negotiation",
				happened_at: "2025-02-01 00:00:00+00",
			})),
			"only the current phase, never a change from parking",
		);
		assert.deepEqual(
			await rows(
				`select * from imported_change where table_name = 'deal' and record ->> 'id' >= '${id(400)}'`,
			),
			[],
		);
		assert.deepEqual(
			await rows(`select n.id from deal n join public.deal d on d.id = n.id
 where n.id >= '${id(400)}' and (n.created_at, n.changed_at, n.changed_by_user_id)
 is distinct from (d.created_at, d.updated_at, d.updated_by)`),
			[],
		);
		const copied = await rows(
			`select * from deal where id >= '${id(400)}' order by id`,
		);
		assert.deepEqual(
			(await run()).filter((r) => r.old_id >= id(400)),
			first.filter((r) => r.old_id >= id(400)),
		);
		assert.deepEqual(
			await rows(`select * from deal where id >= '${id(400)}' order by id`),
			copied,
		);
		await refused(
			`update deal set parking_reason = null, parking_note = null where id = '${id(400)}'`,
			"23514",
		);
		await refused(
			`update deal set needs_attention = false where id = '${id(404)}'`,
			"23514",
		);
	} finally {
		await db.query("rollback");
	}
});

test("a verified market agent joins the deal and a name-only agent waits for review", async () => {
	await db.query("begin");
	try {
		await db.query(`
 ${[410, 411, 412, 413].map((n) => deal(n)).join("\n")}
 insert into public.actor (id, slug, kind, display_name) values ('${id(200)}', 'codex', 'automation', 'Example agent');
 insert into public.event (actor_id, verb, subject_type, subject_id, field, cause, occurred_at, sponsoring_human_slug) values
 ('${id(200)}', 'example', 'deal', '${id(410)}', 'market_agent', 'human_stated', '2025-03-01', 'partner_one'),
 ('${id(200)}', 'example', 'deal', '${id(410)}', 'phase', 'human_stated', '2025-03-02', null);
 update public.deal set owner = null where id = '${id(413)}';
 insert into public.party (id, kind, name, created_by, updated_by) values ('${id(7)}', 'person', 'Example uncopied agent', '${id(1)}', '${id(1)}');
 insert into public.deal_market_assignment (deal_id, agent_name, agent_party_id, market, source, set_by, set_at) values
 ('${id(410)}', 'Example Agent', '${id(4)}', 'Example Market', 'Example source', '${id(200)}', '2025-03-01'),
 ('${id(411)}', 'Example Agent', null, 'Example Market', 'Example source', '${id(1)}', '2025-03-01'),
 ('${id(412)}', 'Example uncopied agent', '${id(7)}', null, 'Example source', '${id(1)}', '2025-03-01'),
 ('${id(413)}', 'Example Agent', '${id(4)}', null, 'Example source', '${id(1)}', '2025-03-01');`);
		const first = await run();
		const agents = `select deal_id, party_id, created_at::text, changed_at::text, changed_by_user_id, changed_by_job, changed_for_user_id
 from deal_party where role = 'market_agent' order by deal_id`;
		assert.deepEqual((await rows(agents)).map(Object.values), [
			[
				id(410),
				id(4),
				"2025-03-01 00:00:00+00",
				"2025-03-01 00:00:00+00",
				null,
				"agent",
				id(1),
			],
		]);
		const listed = (r: pg.QueryResultRow[]) =>
			r.filter((row) => row.old_id >= id(410) && row.field !== "phase");
		assert.deepEqual(listed(first), [
			{
				old_id: id(411),
				field: "market_agent",
				value: "Example Agent",
				reason: "agent_not_verified",
			},
			{
				old_id: id(412),
				field: "deal_party",
				value: `${id(412)} ${id(7)} market_agent`,
				reason: "party_not_copied",
			},
			{
				old_id: id(413),
				field: "deal",
				value: id(413),
				reason: "no_deal_owner",
			},
			{
				old_id: id(413),
				field: "deal_party",
				value: `${id(413)} ${id(4)} market_agent`,
				reason: "deal_not_copied",
			},
		]);
		const copied = await rows(agents);
		assert.deepEqual(listed(await run()), listed(first));
		assert.deepEqual(await rows(agents), copied);
	} finally {
		await db.query("rollback");
	}
});

test("a lane that disagrees with the account links is listed, and one awaiting brand dates is unresolved", async () => {
	await db.query("begin");
	try {
		// biome-ignore format: one row per location
		await db.query(`select set_config('engine.job', 'old_system', true);
 insert into party (id, kind, name, how_found) values ('${id(30)}', 'company', 'Example Location', 'referral'),
 ('${id(31)}', 'company', 'Example Brand', null), ('${id(32)}', 'company', 'Example Unreviewed Location', 'referral'),
 ('${id(33)}', 'person', 'Example Franchisee', 'referral'), ('${id(34)}', 'company', 'Example Late Location', 'referral'),
 ('${id(35)}', 'company', 'Example Local Client', 'referral');
 insert into role (slug, label) values ('national_account', 'Example account');
 insert into party_role (party_id, role) select v, 'client' from unnest(array['${id(30)}', '${id(32)}', '${id(33)}', '${id(34)}', '${id(35)}']::uuid[]) v;
 insert into party_role (party_id, role) values ('${id(31)}', 'national_account');
 insert into national_account (party_id) values ('${id(31)}');
 insert into client (party_id) values ('${id(30)}'), ('${id(34)}');
 insert into client_brand (location_id, brand_id, started_on) values ('${id(30)}', '${id(31)}', '2020-01-01'), ('${id(34)}', '${id(31)}', '2025-01-01');
 insert into outside_id (source, value, party_id) values ('old_system', '${id(40)}', '${id(30)}'), ('old_system', '${id(41)}', '${id(31)}'),
 ('old_system', '${id(42)}', '${id(32)}'), ('old_system', '${id(43)}', '${id(33)}'), ('old_system', '${id(44)}', '${id(34)}'),
 ('old_system', '${id(45)}', '${id(35)}');
 insert into public.party (id, kind, name, org_id, created_by, updated_by) values ('${id(41)}', 'org', 'Example Brand', null, '${id(1)}', '${id(1)}'),
 ('${id(40)}', 'org', 'Example Location', '${id(41)}', '${id(1)}', '${id(1)}'), ('${id(42)}', 'org', 'Example Unreviewed Location', '${id(41)}', '${id(1)}', '${id(1)}'),
 ('${id(43)}', 'person', 'Example Franchisee', '${id(41)}', '${id(1)}', '${id(1)}'), ('${id(44)}', 'org', 'Example Late Location', '${id(41)}', '${id(1)}', '${id(1)}'),
 ('${id(45)}', 'org', 'Example Local Client', null, '${id(1)}', '${id(1)}');
 insert into public.client (id, party_id, created_by, updated_by) values ('${id(50)}', '${id(40)}', '${id(1)}', '${id(1)}'),
 ('${id(52)}', '${id(42)}', '${id(1)}', '${id(1)}'), ('${id(53)}', '${id(43)}', '${id(1)}', '${id(1)}'),
 ('${id(54)}', '${id(44)}', '${id(1)}', '${id(1)}'), ('${id(55)}', '${id(45)}', '${id(1)}', '${id(1)}');
 insert into public.deal_lane (slug, label, sort) values ('territory', 'Example territory', 10), ('national', 'Example national', 20);
 ${[420, 421, 422, 423, 424, 425, 426].map((n) => deal(n)).join("\n")}
 update public.deal d set client_id = v.client_id, lane = v.lane from (values
 ('${id(420)}'::uuid, '${id(50)}'::uuid, 'national'), ('${id(421)}', '${id(50)}', 'territory'),
 ('${id(422)}', '${id(52)}', 'national'), ('${id(423)}', '${id(53)}', 'national'),
 ('${id(424)}', '${id(54)}', 'national'), ('${id(425)}', '${id(50)}', null), ('${id(426)}', '${id(55)}', 'territory')) v(id, client_id, lane)
 where d.id = v.id;`);
		const lanes = (r: pg.QueryResultRow[]) =>
			r.filter((row) => row.field === "lane");
		const listed = (n: number, value: string, reason: string) => ({
			old_id: id(n),
			field: "lane",
			value,
			reason,
		});
		const first = await run();
		assert.deepEqual(lanes(first), [
			listed(421, "territory", "lane_disagrees_with_account"),
			listed(422, "national", "brand_dates_not_reviewed"),
			listed(423, "national", "lane_disagrees_with_account"),
			listed(424, "national", "lane_disagrees_with_account"),
		]);
		assert.deepEqual(lanes(await run()), lanes(first));
	} finally {
		await db.query("rollback");
	}
});

test("deal outside ids normalize sources and keys, report collisions, and stay unchanged on rerun", async () => {
	await db.query("begin");
	try {
		await db.query(`select set_config('engine.job', 'old_system', true);
 ${deal(420)}
 insert into public.record_source (entity_type, entity_id, source_system, external_key) values
 ('deal', '${id(420)}', 'Example Deals', 'D-New Copy'),
 ('deal', '${id(10)}', ' Example.Deals! ', E' \tD-Example-1\n'),
 ('deal', '${id(10)}', 'example-deals', 'D-Example-1'),
 ('deal', '${id(10)}', 'Example Deals', 'D-Example-2'),
 ('deal', '${id(11)}', 'Example Deals', 'D-Conflict'),
 ('deal', '${id(12)}', 'example.deals', ' D-Conflict '),
 ('deal', '${id(13)}', 'Example Deals', 'D-Held'),
 ('deal', '${id(14)}', 'Example Deals', 'D-Party'),
 ('deal', '${id(10)}', 'Old System', 'D-Reserved'),
 ('deal', '${id(10)}', 'old-system-ref', 'D-Reserved'),
 ('deal', '${id(10)}', 'dup.candidate', 'D-Hint'),
 ('deal', '${id(10)}', '2025 import', 'D-Invalid'),
 ('deal', '${id(10)}', '!!!', 'D-Invalid'),
 ('deal', '${id(10)}', 'Example Deals', E' \t\n'),
 ('deal', '${id(22)}', 'Example Deals', 'D-Missing'),
 ('deal', '${id(999)}', 'Example Deals', 'D-Orphan'),
 ('activity', '${id(10)}', 'Example Activity', 'A-Skipped');
 insert into outside_id (source, value, deal_id) values ('example_deals', 'D-Held', '${id(15)}');
 insert into outside_id (source, value, party_id) values ('example_deals', 'D-Party', '${id(2)}');`);
		const first = await run();
		assert.deepEqual(
			await rows(
				"select source, value, deal_id, party_id from outside_id where source = 'example_deals' order by value",
			),
			[
				{
					source: "example_deals",
					value: "D-Example-1",
					deal_id: id(10),
					party_id: null,
				},
				{
					source: "example_deals",
					value: "D-Example-2",
					deal_id: id(10),
					party_id: null,
				},
				{
					source: "example_deals",
					value: "D-Held",
					deal_id: id(15),
					party_id: null,
				},
				{
					source: "example_deals",
					value: "D-New Copy",
					deal_id: id(420),
					party_id: null,
				},
				{
					source: "example_deals",
					value: "D-Party",
					deal_id: null,
					party_id: id(2),
				},
			],
		);
		assert.deepEqual(
			first
				.filter((r) => r.field === "record_source")
				.map((r) => [r.old_id, r.value, r.reason])
				.sort(),
			[
				[id(10), "!!! D-Invalid", "not an outside id"],
				[id(10), "2025 import D-Invalid", "not an outside id"],
				[id(10), "Example Deals  \t\n", "not an outside id"],
				[id(10), "Old System D-Reserved", "a source the copy keeps for itself"],
				[id(10), "dup.candidate D-Hint", "a hint of a duplicate, not an id"],
				[
					id(10),
					"old-system-ref D-Reserved",
					"a source the copy keeps for itself",
				],
				[
					id(11),
					"Example Deals D-Conflict",
					"several deals claim this outside id",
				],
				[
					id(12),
					"example.deals  D-Conflict ",
					"several deals claim this outside id",
				],
				[
					id(13),
					"Example Deals D-Held",
					"another record holds this outside id",
				],
				[
					id(14),
					"Example Deals D-Party",
					"another record holds this outside id",
				],
				[id(22), "Example Deals D-Missing", "its record is not copied"],
				[id(999), "Example Deals D-Orphan", "its record is not copied"],
			].sort(),
		);
		assert.deepEqual(
			await rows("select * from outside_id where source = 'example_activity'"),
			[],
		);
		const ids = await rows("select * from outside_id order by source, value");
		const history = await rows("select * from change order by id");
		assert.deepEqual(await run(), first);
		assert.deepEqual(
			await rows("select * from outside_id order by source, value"),
			ids,
		);
		assert.deepEqual(await rows("select * from change order by id"), history);
	} finally {
		await db.query("rollback");
	}
});

test("an importer-made owner followed by an agent handoff copies both periods", async () => {
	await db.query("begin");
	try {
		await db.query(`insert into public.actor (id, slug, kind, display_name) values
 ('${id(750)}', 'example_import', 'system', 'Example importer'),
 ('${id(751)}', 'codex', 'automation', 'Example agent');
 insert into public.deal_participant (id, deal_id, actor_id, role, from_at, to_at, set_by) values
 ('${id(752)}', '${id(10)}', '${id(1)}', 'lead', '2024-01-01', '2024-02-01', '${id(750)}'),
 ('${id(753)}', '${id(10)}', '${id(1)}', 'lead', '2024-02-01', '2024-03-01', '${id(751)}');`);
		const first = await run();
		assert.deepEqual(
			first.filter((r) => r.old_id >= id(750)),
			[],
		);
		const periods = `select id, user_id, started_at::text, ended_at::text
 from imported_deal_owner order by id`;
		const expected = [
			{
				id: id(752),
				user_id: id(1),
				started_at: null,
				ended_at: "2024-02-01 00:00:00+00",
			},
			{
				id: id(753),
				user_id: id(1),
				started_at: "2024-02-01 00:00:00+00",
				ended_at: "2024-03-01 00:00:00+00",
			},
		];
		assert.deepEqual(await rows(periods), expected);
		assert.deepEqual(await run(), first);
		assert.deepEqual(await rows(periods), expected);
	} finally {
		await db.query("rollback");
	}
});

test("a refused non-user earlier owner does not knock out an overlapping valid owner period", async () => {
	await db.query("begin");
	try {
		await db.query(`insert into public.actor (id, slug, kind, display_name) values
 ('${id(4)}', 'example_nonuser', 'human', 'Example nonuser');
 insert into public.deal_participant (id, deal_id, actor_id, role, from_at, to_at, set_by) values
 ('${id(760)}', '${id(10)}', '${id(4)}', 'lead', '2024-01-01', '2024-03-01', '${id(1)}'),
 ('${id(761)}', '${id(10)}', '${id(1)}', 'lead', '2024-02-01', '2024-04-01', '${id(1)}');`);
		const result = await run();
		assert.deepEqual(
			await rows(
				"select id, deal_id, user_id, started_at::text, ended_at::text from imported_deal_owner order by id",
			),
			[
				{
					id: id(761),
					deal_id: id(10),
					user_id: id(1),
					started_at: "2024-02-01 00:00:00+00",
					ended_at: "2024-04-01 00:00:00+00",
				},
			],
		);
		assert.deepEqual(
			result
				.filter((r) => r.old_id === id(760) || r.old_id === id(761))
				.map((r) => [r.old_id, r.reason]),
			[[id(760), "owner_not_a_user"]],
		);
	} finally {
		await db.query("rollback");
	}
});

test("earlier people follow merges and owners keep only supported starts, with stable reruns", async () => {
	await db.query("begin");
	try {
		await db.query(`insert into public.actor (id, slug, kind, display_name) values ('${id(700)}', 'example_import', 'system', 'Example import');
 insert into public.deal_participant (id, deal_id, party_id, actor_id, role, from_at, to_at, set_by) values
 ('${id(701)}', '${id(10)}', '${id(6)}', null, 'support', '2024-01-01', '2024-02-01', '${id(1)}'),
 ('${id(702)}', '${id(10)}', '${id(4)}', null, 'listing_side', '2024-02-01', '2024-03-01', '${id(1)}'),
 ('${id(703)}', '${id(10)}', null, '${id(1)}', 'support', '2024-03-01', '2024-04-01', '${id(1)}'),
 ('${id(704)}', '${id(10)}', null, '${id(1)}', 'lead', '2024-01-01', '2024-02-01', '${id(700)}'),
 ('${id(705)}', '${id(10)}', null, '${id(1)}', 'lead', '2024-02-01', '2024-03-01', '${id(1)}');`);
		const changes = await rows("select count(*) from imported_change");
		const first = await run();
		assert.deepEqual(
			first.filter((r) => r.old_id >= id(700)),
			[],
		);
		const parties = await rows(
			`select id, party_id, role, started_at::text, ended_at::text from imported_deal_party order by id`,
		);
		assert.deepEqual(parties, [
			{
				id: id(701),
				party_id: id(2),
				role: "support",
				started_at: "2024-01-01 00:00:00+00",
				ended_at: "2024-02-01 00:00:00+00",
			},
			{
				id: id(702),
				party_id: id(4),
				role: "listing_agent",
				started_at: "2024-02-01 00:00:00+00",
				ended_at: "2024-03-01 00:00:00+00",
			},
			{
				id: id(703),
				party_id: id(1),
				role: "support",
				started_at: "2024-03-01 00:00:00+00",
				ended_at: "2024-04-01 00:00:00+00",
			},
		]);
		assert.deepEqual(
			await rows(
				"select id, user_id, started_at::text, ended_at::text from imported_deal_owner order by id",
			),
			[
				{
					id: id(704),
					user_id: id(1),
					started_at: null,
					ended_at: "2024-02-01 00:00:00+00",
				},
				{
					id: id(705),
					user_id: id(1),
					started_at: "2024-02-01 00:00:00+00",
					ended_at: "2024-03-01 00:00:00+00",
				},
			],
		);
		const snapshot = await rows(
			"select to_jsonb(p) as row from imported_deal_party p union all select to_jsonb(o) from imported_deal_owner o",
		);
		const history = await rows("select count(*) from change");
		assert.deepEqual(await run(), first);
		assert.deepEqual(
			await rows(
				"select to_jsonb(p) as row from imported_deal_party p union all select to_jsonb(o) from imported_deal_owner o",
			),
			snapshot,
		);
		assert.deepEqual(await rows("select count(*) from change"), history);
		assert.deepEqual(
			await rows("select count(*) from imported_change"),
			changes,
		);
	} finally {
		await db.query("rollback");
	}
});

for (const [label, fixtureSql, reason] of [
	[
		"overlapping people after a merge",
		`insert into public.deal_participant (id, deal_id, party_id, role, from_at, to_at, set_by) values
 ('${id(710)}', '${id(10)}', '${id(2)}', 'support', '2024-01-01', '2024-03-01', '${id(1)}'),
 ('${id(711)}', '${id(10)}', '${id(6)}', 'support', '2024-02-01', '2024-04-01', '${id(1)}')`,
		"overlapping_source_periods",
	],
	[
		"overlapping owners",
		`insert into public.deal_participant (id, deal_id, actor_id, role, from_at, to_at, set_by) values
 ('${id(710)}', '${id(10)}', '${id(1)}', 'lead', '2024-01-01', '2024-03-01', '${id(1)}'),
 ('${id(711)}', '${id(10)}', '${id(1)}', 'lead', '2024-02-01', '2024-04-01', '${id(1)}')`,
		"overlapping_source_periods",
	],
	["an invalid period", "", "period_ends_before_it_starts"],
	[
		"a missing person",
		`delete from outside_id where value = '${id(4)}'`,
		"party_not_copied",
	],
	[
		"an uncopied deal",
		`update public.deal_participant set deal_id = '${id(22)}' where id = '${id(710)}'`,
		"deal_not_copied",
	],
	[
		"an unavailable vendor category",
		`update public.deal_participant set role = 'lender' where id = '${id(710)}'`,
		"role_not_available",
	],
	[
		"an owner who is not a user",
		`insert into public.actor (id, slug, kind, display_name) values ('${id(4)}', 'example_nonuser', 'human', 'Example nonuser'); update public.deal_participant set role = 'lead', party_id = null, actor_id = '${id(4)}' where id = '${id(710)}'`,
		"owner_not_a_user",
	],
	[
		"a current membership before the earlier one ended",
		`update public.deal_participant set role = 'landlord_side', from_at = '2024-01-01', to_at = '2099-01-01' where id = '${id(710)}'`,
		"deal_party_rejoins_after_leaving",
	],
] as const) {
	test(`earlier membership copy lists ${label} without aborting the copy`, async () => {
		await db.query(
			"begin; select set_config('engine.job', 'old_system', true)",
		);
		try {
			if (!label.startsWith("overlapping"))
				await db.query(`insert into public.deal_participant (id, deal_id, party_id, role, from_at, to_at, set_by) values
 ('${id(710)}', '${id(10)}', '${id(4)}', 'support', '2024-03-01', '2024-02-01', '${id(1)}')`);
			if (fixtureSql) await db.query(fixtureSql);
			const first = await run();
			assert.ok(
				first.some((r) => r.old_id === id(710) && r.reason === reason),
				JSON.stringify(first.filter((r) => r.old_id >= id(710))),
			);
			assert.deepEqual(
				await rows(
					"select id from imported_deal_party union all select id from imported_deal_owner",
				),
				[],
			);
			assert.deepEqual(await run(), first);
		} finally {
			await db.query("rollback");
		}
	});
}

test("unknown starts overlap and existing period collisions are listed without rewriting history", async () => {
	await db.query("begin; select set_config('engine.job', 'old_system', true)");
	try {
		await db.query(`insert into public.actor (id, slug, kind, display_name) values ('${id(700)}', 'example_import', 'system', 'Example import');
 insert into public.deal_participant (id, deal_id, party_id, role, from_at, to_at, set_by) values
 ('${id(720)}', '${id(10)}', '${id(4)}', 'support', '2024-01-01', '2024-02-01', '${id(700)}'),
 ('${id(721)}', '${id(10)}', '${id(4)}', 'support', '2024-03-01', '2024-04-01', '${id(700)}');`);
		assert.deepEqual(
			(await run())
				.filter((r) => r.old_id >= id(720))
				.map((r) => [r.old_id, r.reason]),
			[
				[id(720), "overlapping_source_periods"],
				[id(721), "overlapping_source_periods"],
			],
		);
		await db.query(`delete from public.deal_participant where id = '${id(721)}';
 insert into imported_deal_party (id, deal_id, party_id, role, started_at, ended_at) values
 ('${id(722)}', '${id(10)}', '${id(4)}', 'support', '2024-01-01', '2024-02-01');`);
		assert.ok(
			(await run()).some(
				(r) =>
					r.old_id === id(720) &&
					r.reason === "imported_deal_party_once_at_a_time",
			),
		);
		await db.query(
			`update public.deal_participant set id = '${id(722)}' where id = '${id(720)}'`,
		);
		assert.ok(
			(await run()).some(
				(r) => r.old_id === id(722) && r.reason === "existing_period_conflict",
			),
		);
		assert.equal(
			(await rows("select count(*) from imported_deal_party"))[0]?.count,
			"1",
		);
	} finally {
		await db.query("rollback");
	}
});

test("a later current membership conflicting with copied history is listed and skipped", async () => {
	await db.query("begin; select set_config('engine.job', 'old_system', true)");
	try {
		await db.query(`insert into imported_deal_party (id, deal_id, party_id, role, started_at, ended_at) values
 ('${id(730)}', '${id(10)}', '${id(4)}', 'support', '2024-01-01', '2024-03-01');
 insert into public.deal_participant (id, deal_id, party_id, role, from_at, set_by) values
 ('${id(731)}', '${id(10)}', '${id(4)}', 'support', '2024-02-01', '${id(1)}');`);
		assert.deepEqual(
			(await run()).filter((r) => r.old_id === id(731)),
			[
				{
					old_id: id(731),
					field: "deal_party",
					value: `${id(10)} ${id(4)} support`,
					reason: "current_membership_overlaps_history",
				},
			],
		);
		await db.query(`insert into role (slug, label) values ('lender', 'Example lender');
 update imported_deal_party set role = 'lender' where id = '${id(730)}';
 update public.deal_participant set role = 'lender' where id = '${id(731)}';`);
		assert.deepEqual(
			(await run()).filter((r) => r.old_id === id(731)),
			[
				{
					old_id: id(731),
					field: "deal_party",
					value: `${id(10)} ${id(4)} lender`,
					reason: "role_not_available",
				},
			],
		);
		assert.deepEqual(
			await rows(
				`select from deal_party where deal_id = '${id(10)}' and party_id = '${id(4)}' and role = 'support'`,
			),
			[],
		);
	} finally {
		await db.query("rollback");
	}
});

test("earlier owners colliding with existing history or an id in the other history table are listed", async () => {
	await db.query("begin; select set_config('engine.job', 'old_system', true)");
	try {
		await db.query(`insert into public.deal_participant (id, deal_id, actor_id, role, from_at, to_at, set_by) values
 ('${id(740)}', '${id(10)}', '${id(1)}', 'lead', '2024-01-01', '2024-03-01', '${id(1)}');
 insert into imported_deal_owner (id, deal_id, user_id, started_at, ended_at) values
 ('${id(741)}', '${id(10)}', '${id(1)}', '2024-02-01', '2024-04-01');`);
		assert.ok(
			(await run()).some(
				(r) =>
					r.old_id === id(740) &&
					r.reason === "imported_deal_owner_one_at_a_time",
			),
		);
		await db.query(`insert into imported_deal_party (id, deal_id, party_id, role, started_at, ended_at) values
 ('${id(740)}', '${id(10)}', '${id(4)}', 'support', '2024-01-01', '2024-03-01');`);
		assert.ok(
			(await run()).some(
				(r) => r.old_id === id(740) && r.reason === "existing_period_conflict",
			),
		);
		assert.deepEqual(await rows("select id from imported_deal_owner"), [
			{ id: id(741) },
		]);
	} finally {
		await db.query("rollback");
	}
});
