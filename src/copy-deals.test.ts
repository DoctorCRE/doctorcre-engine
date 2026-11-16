import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { URL } from "node:url";
import pg from "pg";
import { asAdmin } from "../scripts/test-database.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const schema = await readFile(
	new URL("../schema/next.sql", import.meta.url),
	"utf8",
);
const attribution = await readFile(
	new URL("../schema/copy-attribution.sql", import.meta.url),
	"utf8",
);
const copy = await readFile(
	new URL("../schema/copy-deals.sql", import.meta.url),
	"utf8",
);
const name = `copy_deals_${randomUUID().replaceAll("-", "")}`;
const url = new URL(
	process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1/postgres",
);
url.pathname = `/${name}`;
const db = new pg.Client({
	connectionString: url.href,
	options: "-c search_path=next -c TimeZone=UTC",
});
const rows = async (sql: string) => (await db.query(sql)).rows;
const run = async (): Promise<pg.QueryResultRow[]> => {
	const result = await db.query(copy);
	assert.ok(Array.isArray(result));
	return result.at(-1)?.rows ?? [];
};
const deal = (n: number, type = "lease") => `insert into public.deal
 (id, client_id, name, deal_type, phase, owner, created_by, updated_by, created_at, updated_at)
 values ('${id(n)}', '${id(3)}', 'Example deal ${n}', '${type}', 'negotiation', 'partner_one', '${id(1)}', '${id(1)}', '2025-01-01', '2025-02-01');`;
let report: pg.QueryResultRow[];
before(async () => {
	assert.ok(process.env.TEST_SNAPSHOT, "Run npm run check");
	await asAdmin(
		`create database "${name}" template "${process.env.TEST_SNAPSHOT}"`,
	);
	await db.connect();
	await db.query(`create schema next; ${schema}; ${attribution}`);
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'partner_one', 'human', 'Example User');
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User'), ('${id(2)}', 'company', 'Example Client'),
 ('${id(4)}', 'person', 'Example Agent'), ('${id(5)}', 'person', 'Example Other');
 insert into app_user values ('${id(1)}');
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
 insert into market (id, name) values ('${id(7)}', 'Example Market');
 ${["lease", "purchase", "sale_leaseback", "build_to_suit", "startup", "relocation", "expansion", "renewal", "additional_office", "other"].map((t, i) => deal(10 + i, t)).join("\n")}
 ${deal(20)} ${deal(21)}
 ${deal(22)} ${deal(23)} ${deal(24)} ${deal(25)} ${deal(26)} ${deal(27)}
 alter table public.deal disable trigger deal_touch;
 update public.deal set city = 'Missing Market' where id = '${id(20)}';
 update public.deal set won_value = 0 where id = '${id(21)}';
 update public.deal set owner = null where id in ('${id(22)}', '${id(23)}');
 update public.deal set phase = 'closed' where id = '${id(23)}';
 update public.deal set city = 'Example Market', won_value = 1234 where id = '${id(10)}';
 insert into public.deal_participant (id, deal_id, actor_id, role, set_by) values ('${id(80)}', '${id(23)}', '${id(1)}', 'lead', '${id(1)}');
 insert into public.deal_participant (deal_id, party_id, role, set_by) values
 ('${id(10)}', '${id(4)}', 'landlord_side', '${id(1)}'), ('${id(24)}', '${id(4)}', 'listing_side', '${id(1)}'),
 ('${id(24)}', '${id(5)}', 'listing_side', '${id(1)}');
 insert into public.building (id, address, created_by, updated_by) values ('${id(90)}', '100 Example Way', '${id(1)}', '${id(1)}'), ('${id(91)}', '200 Example Way', '${id(1)}', '${id(1)}');
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
 commit;`);
	await db.query("begin");
	report = await run();
	await db.query("commit");
});
after(async () => {
	await db.end();
	await asAdmin(`drop database "${name}" with (force)`);
});

test("types split into kind and reason, with startup renamed and other left unfiled", async () => {
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
		{ kind: null, reason: null },
	]);
	assert.ok(
		report.some((r) => r.old_id === id(19) && r.reason === "unfiled_deal_type"),
	);
});
test("deals preserve identity, times, owner, market and value, and client links use the old-id map", async () => {
	// biome-ignore format: one row per imported deal
	assert.deepEqual((await rows(`select name, owner_user_id, market_id, closed_value, created_at::text, changed_at::text, changed_by_user_id from deal where id = '${id(10)}'`)).map(Object.values), [
 ["Example deal 10", id(1), id(7), "1234.00", "2025-01-01 00:00:00+00", "2025-02-01 00:00:00+00", id(1)],
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
test("phase events retain evidence dates and actors; missing history never invents a date", async () => {
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
			`select phase from deal_phase_change where deal_id = '${id(11)}'`,
		),
		[],
	);
	assert.ok(
		report.some((r) => r.old_id === id(11) && r.reason === "no_phase_history"),
	);
});
test("rounds derive unique candidates, number across sides by creation then id, and never invent status", async () => {
	const rounds = report.filter((r) => r.field === "negotiation_round");
	assert.deepEqual(
		rounds.map((r) => [r.old_id, r.reason]),
		[
			[100, "unknown_offer_status"],
			[101, "unknown_offer_status"],
			[102, "no_property"],
			[102, "no_sender_candidate"],
			[103, "no_property"],
			[103, "several_sender_candidates"],
			[104, "several_properties"],
			[105, "unknown_offer_status"],
			[106, "deal_not_copied"],
		].map(([n, reason]) => [id(Number(n)), reason]),
	);
	assert.deepEqual(
		rounds
			.filter((r) => r.reason === "unknown_offer_status")
			.map((r) => JSON.parse(r.value)),
		[
			{ side: "tenant", round_no: 1, new_round: 2 },
			{ side: "landlord", round_no: 1, new_round: 3 },
			{ side: "tenant", round_no: 7, new_round: 1 },
		],
	);
	assert.deepEqual(await rows("select * from offer"), []);
});
test("a repeat is idempotent and restores stamps after import", async () => {
	const original = await rows("select * from deal order by id");
	await db.query("begin");
	await run();
	await db.query("commit");
	assert.deepEqual(await rows("select * from deal order by id"), original);
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
			"ended_participant_history",
			"deal_not_copied",
			"unknown_phase",
			"dead_without_reason",
			"same_time_phase_changes",
			"existing_phase_conflict",
			"current_phase_differs",
			"lost_without_dated_reason",
		])
			assert.ok(
				refused.some((r) => r.reason === reason),
				reason,
			);
		assert.equal(
			(
				await rows(
					`select phase from deal_phase_change where deal_id = '${id(12)}'`,
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
			2,
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

test("a client without its required role is listed", async () => {
	await db.query("begin");
	try {
		await db.query(
			`update public.client set party_id = '${id(4)}' where id = '${id(3)}'`,
		);
		assert.ok(
			(await run()).some((row) => row.reason === "client_role_not_available"),
		);
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
