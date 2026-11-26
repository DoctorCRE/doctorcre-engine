import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [joe, dell, lender, architect, oldVendor, closed, lost, open] = [
	id(901),
	id(902),
	id(101),
	id(102),
	id(502),
	id(201),
	id(202),
	id(203),
] as const;

const door = doorTest();
before(async () => {
	await door.setup();
	await door.db.query(`
		set search_path = next, pg_temp;
		select set_config('engine.user_id', '${joe}', true);
		insert into party (id, kind, name) values
			('${joe}', 'person', 'Example Joe'), ('${dell}', 'person', 'Example Dell'),
			('${lender}', 'company', 'Example Lender'), ('${architect}', 'person', 'Example Architect');
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell');
		insert into role (slug, label, category_of) values ('vendor', 'Vendor', null), ('lender', 'Lender', 'vendor');
		insert into party_role (party_id, role, owner_user_id) values
			('${lender}', 'vendor', '${joe}'), ('${architect}', 'vendor', '${dell}');
		insert into party_role (party_id, role) values ('${lender}', 'lender');
		insert into outside_id (source, value, party_id) values
			('old_system', '${oldVendor}', '${architect}'), ('old_system_ref', 'V-102', '${architect}');

		insert into phase (slug, label) values ('closed', 'Closed'), ('dead', 'Dead'), ('negotiation', 'Negotiating');
		insert into deal (id, name, owner_user_id, created_at) values
			('${closed}', 'Example Closed Deal', '${joe}', now() - interval '2 years'),
			('${lost}', 'Example Lost Deal', '${joe}', now() - interval '2 years'),
			('${open}', 'Example Open Deal', '${joe}', now() - interval '2 years');
		insert into deal_phase_change (deal_id, happened_at, phase, reason) values
			('${closed}', now() - interval '1 day', 'closed', null),
			('${lost}', now() - interval '1 day', 'dead', 'Example lost'),
			('${open}', now(), 'negotiation', null);
		insert into deal_party (deal_id, party_id, role, created_at)
		select id, '${lender}', 'lender', now() - interval '1 week' from deal;
		insert into introduction (vendor_id, made_by, introduced_party_id, introduced_on, deal_id, note) values
			('${lender}', 'vendor', '${architect}', current_date - 1, '${open}', 'Example referral'),
			('${architect}', 'vendor', '${lender}', null, '${open}', 'Example undated referral');

		insert into activity (id, kind, happened_at, summary) values
			('${id(601)}', 'call', now() - interval '2 days', 'Example call'),
			('${id(602)}', 'note', now() - interval '1 day', 'Example call prep'),
			('${id(603)}', 'note', now() - interval '1 day', 'Example lender note'),
			(md5('old_system:vendor:${oldVendor}:intro_notes')::uuid, 'note',
				now() - interval '2 days', 'Example copied intro');
		insert into activity_about (activity_id, party_id) values
			('${id(601)}', '${lender}'), ('${id(602)}', '${architect}'), ('${id(603)}', '${lender}'),
			(md5('old_system:vendor:${oldVendor}:intro_notes')::uuid, '${architect}');

		select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
		set constraints all immediate;
		alter table deal_party disable trigger stamp_change;
		insert into deal_party (deal_id, party_id, role, created_at, changed_at, changed_by_user_id)
		values ('${open}', '${architect}', 'vendor', now(), now(), '${joe}');
		alter table deal_party enable trigger stamp_change;
	`);
});
after(() => door.cleanup());

const get = (path: string, switched = true) =>
	door.request(
		{ user: "joe" },
		`vendors${path}`,
		{ method: "GET" },
		switched ? { DIRECTORY_READ_SCHEMA: "next" } : {},
	);

async function list(query: string) {
	const response = await get(`?contract=vendor-directory.v1&${query}`);
	assert.equal(response.status, 200);
	return response.json();
}

async function drawer(ref: string) {
	const response = await get(`/${ref}?contract=vendor-directory.v2`);
	assert.equal(response.status, 200, ref);
	const body = await response.json();
	assert.ok(body && typeof body === "object" && "record" in body);
	return body.record;
}

test("vendor lists keep two vendors, current owners, refs, and live counts", async () => {
	assert.partialDeepStrictEqual(await list("q=Example"), {
		total: 2,
		rows: [
			{
				id: architect,
				ref: "V-102",
				owner_label: "Example Dell",
				owned_by_viewer: false,
			},
			{
				id: lender,
				ref: lender,
				owner_label: "Example Joe",
				owned_by_viewer: true,
				relationship: {
					coverage_verified_at: null,
					override: null,
					deals_worked: 3,
					deals_referred: 1,
					won: 1,
					lost: 1,
					win_rate: 0.5,
					last_contact_note: "Example call",
				},
			},
		],
	});
});

test("copied vendors open directly by UUID or typed ref", async () => {
	for (const [ref, expectedId] of [
		[oldVendor, oldVendor],
		[architect, architect],
		["V-102", architect],
	] as const) {
		assert.partialDeepStrictEqual(await drawer(ref), {
			id: expectedId,
			party_id: architect,
			ref: "V-102",
			owner_label: "Example Dell",
		});
	}
});

test("a long-running deal only gives credit from when the vendor joins", async () => {
	const {
		rows: [expected],
	} = await door.db.query<{ joined: string }>(
		"select to_jsonb(created_at at time zone 'UTC')#>>'{}' as joined from deal_party where party_id = $1 and deal_id = $2",
		[lender, closed],
	);
	assert.ok(expected);
	assert.partialDeepStrictEqual(await drawer(lender), {
		id: lender,
		relationship: {
			computed_tier: "Trial",
			first_worked_at: `${expected.joined}+00:00`,
		},
	});
});

test("a phase move does not replace the date of the vendor's last deal", async () => {
	const {
		rows: [expected],
	} = await door.db.query<{ introduced_on: string }>(
		"select introduced_on::text from introduction where vendor_id = $1",
		[lender],
	);
	assert.ok(expected);
	assert.partialDeepStrictEqual(await list("sort=last_deal_desc"), {
		rows: [
			{ id: lender, last_deal_at: `${expected.introduced_on}T00:00:00+00:00` },
			{ id: architect },
		],
	});
});

test("copied vendor work and undated introductions count with unknown dates", async () => {
	assert.partialDeepStrictEqual(await list("q=V-102"), {
		rows: [
			{
				id: architect,
				last_deal_at: null,
				relationship: {
					first_worked_at: null,
					deals_worked: 1,
					deals_referred: 1,
				},
			},
		],
	});
});

test("ordinary notes stay in Conversations and cannot replace a copied Intro note", async () => {
	assert.partialDeepStrictEqual(await drawer(oldVendor), {
		intro_notes: "Example copied intro",
		relationship: {
			recent_entries: [{ id: id(602), summary: "Example call prep" }],
		},
	});
	assert.partialDeepStrictEqual(await drawer(lender), {
		intro_notes: null,
		relationship: {
			recent_entries: [{ id: id(603), summary: "Example lender note" }],
		},
	});
});

test("unswitched vendors still use the public route and reject typed refs", async () => {
	const response = await get("?contract=vendor-directory.v1", false);
	assert.deepEqual(
		[response.status, await response.json()],
		[503, { error: "DEPENDENCY_NOT_PROVISIONED", dependency: "read_access" }],
	);
	assert.equal((await get("/V-102", false)).status, 404);
});

test("a vendor's details show the ruling and owner of its vendor role, not of its category", async () => {
	const builder = id(104);
	await door.db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into role (slug, label, category_of) values ('contractor', 'Contractor', 'vendor');
		insert into party (id, kind, name) values ('${builder}', 'person', 'Made-up Builder');
		insert into party_role (party_id, role) values ('${builder}', 'contractor');
		insert into party_role (party_id, role, disposition, disposition_reason, owner_user_id)
			values ('${builder}', 'vendor', 'avoid', 'Made-up reason', '${dell}');
		insert into outside_id (source, value, party_id) values ('old_system', '${builder}', '${builder}');
		commit;`);
	assert.partialDeepStrictEqual(await drawer(builder), {
		recorded_category: "contractor",
		recorded_disposition: "avoid",
		recorded_disposition_label: "Avoid",
		recorded_disposition_workable: false,
		owner_label: "Example Dell",
	});
});

async function summaryQuiet(owner: string, category?: string) {
	const response = await door.request(
		{ user: "joe" },
		`vendors/summary?owner=${owner}`,
		{ method: "GET" },
		{ DIRECTORY_READ_SCHEMA: "next" },
	);
	assert.equal(response.status, 200);
	const body = (await response.json()) as {
		all: { quiet: number };
		categories: { slug: string; quiet: number }[];
	};
	return category === undefined
		? body.all.quiet
		: body.categories.find((c) => c.slug === category)?.quiet;
}

test("the vendor list narrows to the vendors Quiet follow-ups proposes", async () => {
	const [quietLender, quietOther] = [id(105), id(106)];
	await door.db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${quietLender}', 'person', 'Made-up Quiet Lender'), ('${quietOther}', 'person', 'Made-up Quiet Vendor');
		insert into party_role (party_id, role, owner_user_id, created_at) values
			('${quietLender}', 'vendor', '${joe}', now() - interval '200 days'),
			('${quietOther}', 'vendor', '${joe}', now() - interval '200 days');
		insert into party_role (party_id, role) values ('${quietLender}', 'lender');
		commit;`);
	assert.partialDeepStrictEqual(await list("quiet=true&category=lender"), {
		query: { quiet: true },
		total: 1,
		rows: [{ id: quietLender }],
	});
	for (const [query, owner, category] of [
		["quiet=true", "all", undefined],
		["quiet=true&category=lender", "all", "lender"],
		["quiet=true&owner=joe", "joe", undefined],
		["quiet=true&owner=dell", "dell", undefined],
	] as const) {
		const { total } = (await list(query)) as { total: number };
		assert.equal(total, await summaryQuiet(owner, category), query);
	}
	assert.equal(((await list("quiet=true")) as { total: number }).total, 2);
	const { query } = (await list("q=Made-up")) as { query: object };
	assert.equal("quiet" in query, false);
});
