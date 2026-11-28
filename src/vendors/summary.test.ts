import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { VENDOR_RELATIONSHIPS } from "../leads/follow-up-reads.ts";
import { doorTest } from "../test-door.ts";

const uuid = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const JOE = uuid(1);
const DELL = uuid(2);

type Vendor = {
	level?: number;
	disposition?: "parked" | "avoid";
	owner?: string;
	categories?: string[];
	created_at?: string;
};

const vendor = (n: number, v: Vendor = {}) => `
	insert into party (id, kind, name, how_found)
		values ('${uuid(n)}', 'person', 'Example Vendor ${n}', 'referral');
	insert into party_role (party_id, role, relationship_level, disposition, disposition_reason, owner_user_id, created_at)
		values ('${uuid(n)}', 'vendor', ${v.level ?? "null"}, ${v.disposition ? `'${v.disposition}'` : "null"},
			${v.disposition ? "'Example ruling'" : "null"}, ${v.owner ? `'${v.owner}'` : "null"},
			'${v.created_at ?? new Date().toISOString()}');
	${(v.categories ?? []).map((c) => `insert into party_role (party_id, role) values ('${uuid(n)}', '${c}');`).join("")}`;

const recentTouch = (n: number) => `
	with contact as (insert into activity (kind, happened_at, summary)
		values ('call', now(), 'Example touch') returning id)
	insert into activity_about (activity_id, party_id) select id, '${uuid(n)}' from contact;`;

type Counts = {
	count: number;
	relationship: Record<string, number>;
	quiet: number;
};
type Body = {
	error?: string;
	all: Counts;
	no_category: Counts;
	categories: (Counts & { slug: string })[];
	proposals: { subject_type: string }[];
};

async function summaryDoor(t: TestContext, seed: string) {
	const door = doorTest();
	await door.setup();
	t.after(door.cleanup);
	await door.db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${JOE}', 'person', 'Example Partner'), ('${DELL}', 'person', 'Example Other Partner');
		insert into app_user (id, slug) values ('${JOE}', 'joe'), ('${DELL}', 'dell');
		insert into how_found (slug, label) values ('referral', 'Referral');
		insert into role (slug, label, category_of) values ('vendor', 'Vendor', null),
			('lender', 'Lender', 'vendor'), ('attorney', 'Attorney', 'vendor'), ('cpa', 'CPA', 'vendor');
		select set_config('engine.job', '', true), set_config('engine.user_id', '${JOE}', true);
		${seed}
		commit;`);
	const get = async (path: string) => {
		const response = await door.request(
			{ user: "joe" },
			path,
			{
				method: "GET",
			},
			{ DIRECTORY_READ_SCHEMA: "next" },
		);
		return {
			status: response.status,
			body: (await response.json()) as Body,
		};
	};
	return get;
}

function inCategory(body: Body, slug: string) {
	const found = body.categories.find((c) => c.slug === slug);
	assert.ok(found, slug);
	return found;
}

const counts = (
	count: number,
	quiet: number,
	words: Partial<Record<string, number>>,
) => ({
	count,
	relationship: {
		core: 0,
		established: 0,
		building: 0,
		prospective: 0,
		not_rated: 0,
		parked: 0,
		avoid: 0,
		...words,
	},
	quiet,
	markets: [],
	elsewhere: 0,
	no_territory: count,
});

test("each category tile counts its vendors by relationship word", async (t) => {
	const get = await summaryDoor(
		t,
		[
			vendor(10, { level: 3, categories: ["lender", "attorney"] }),
			vendor(11, { level: 2, categories: ["lender"] }),
			vendor(12, { level: 1, categories: ["lender"] }),
			vendor(13, { level: 0, categories: ["attorney"] }),
			vendor(14, { categories: ["attorney"] }),
			vendor(15, { level: 3, disposition: "parked", categories: ["lender"] }),
			vendor(16, { level: 2, disposition: "avoid" }),
		].join(""),
	);
	const { status, body } = await get("vendors/summary");
	assert.equal(status, 200);
	assert.deepEqual(body, {
		all: counts(7, 0, {
			core: 1,
			established: 1,
			building: 1,
			prospective: 1,
			not_rated: 1,
			parked: 1,
			avoid: 1,
		}),
		no_category: counts(1, 0, { avoid: 1 }),
		categories: [
			{
				slug: "attorney",
				label: "Attorney",
				...counts(3, 0, { core: 1, prospective: 1, not_rated: 1 }),
			},
			{ slug: "cpa", label: "CPA", ...counts(0, 0, {}) },
			{
				slug: "lender",
				label: "Lender",
				...counts(4, 0, { core: 1, established: 1, building: 1, parked: 1 }),
			},
		],
	});
});

test("every relationship word counts its vendors", async (t) => {
	const get = await summaryDoor(
		t,
		VENDOR_RELATIONSHIPS.map((r, i) =>
			vendor(
				10 + i,
				"ruling" in r
					? { disposition: r.word }
					: r.level === null
						? {}
						: { level: r.level },
			),
		).join(""),
	);
	const { all } = (await get("vendors/summary")).body;
	assert.equal(all.count, VENDOR_RELATIONSHIPS.length);
	assert.deepEqual(
		all.relationship,
		Object.fromEntries(VENDOR_RELATIONSHIPS.map(({ word }) => [word, 1])),
	);
});

test("quiet counts the same vendors as quiet follow-ups", async (t) => {
	const old = "2020-01-01T12:00:00Z";
	const get = await summaryDoor(
		t,
		[
			vendor(10, { created_at: old, categories: ["lender"] }),
			vendor(11, { created_at: old, categories: ["lender"] }),
			recentTouch(11),
			vendor(12, { created_at: old, categories: ["lender"] }),
			`insert into next_step (party_id, what) values ('${uuid(12)}', 'Example step');`,
			vendor(13, { created_at: old, disposition: "parked" }),
			vendor(14, { created_at: old }),
			`insert into do_not_contact (party_id, reason) values ('${uuid(14)}', 'Example request');`,
			vendor(15, { created_at: old }),
			vendor(16),
		].join(""),
	);
	const summary = await get("vendors/summary");
	const quiet = await get("quiet-follow-ups");
	assert.equal(quiet.status, 200);
	const quietVendors = quiet.body.proposals.filter(
		(p) => p.subject_type === "vendor",
	);
	assert.equal(quietVendors.length, 2);
	assert.equal(summary.body.all.quiet, quietVendors.length);
	assert.equal(inCategory(summary.body, "lender").quiet, 1);
	assert.equal(summary.body.no_category.quiet, 1);
});

test("a partner's summary counts only that partner's vendors", async (t) => {
	const get = await summaryDoor(
		t,
		[
			vendor(10, { level: 1, owner: JOE, categories: ["cpa"] }),
			vendor(11, { level: 2, owner: DELL, categories: ["cpa"] }),
			vendor(12, { level: 2, categories: ["cpa"] }),
		].join(""),
	);
	const cpa = async (owner: string) =>
		inCategory((await get(`vendors/summary?owner=${owner}`)).body, "cpa");
	assert.equal((await cpa("joe")).relationship.building, 1);
	assert.equal((await cpa("joe")).count, 1);
	assert.equal((await cpa("dell")).relationship.established, 1);
	assert.equal((await cpa("dell")).count, 1);
	assert.equal((await cpa("all")).count, 3);
	const refused = await get("vendors/summary?owner=someone");
	assert.equal(refused.status, 400);
	assert.equal(refused.body.error, "value_not_in_declared_vocabulary");
});

test("market counts follow current territories, owners, and categories", async (t) => {
	const west = { id: uuid(31), name: "Example West" };
	const east = { id: uuid(32), name: "Example East" };
	const get = await summaryDoor(
		t,
		[
			vendor(10, { owner: JOE, categories: ["lender", "attorney"] }),
			vendor(11, { owner: DELL, categories: ["lender"] }),
			vendor(12, { owner: JOE, categories: ["lender"] }),
			vendor(13),
			`insert into market (id, name) values ('${west.id}', '${west.name}'), ('${east.id}', '${east.name}');
		insert into market_county (market_id, county_fips) values ('${west.id}', '01001'), ('${east.id}', '01003');
		insert into territory (id, name) values ('${uuid(41)}', 'Example State'), ('${uuid(42)}', 'Example West'),
			('${uuid(43)}', 'Example Typed Territory'), ('${uuid(44)}', 'Example East');
		insert into territory_piece (territory_id, state_fips, market_id) values
			('${uuid(41)}', '01', null), ('${uuid(42)}', null, '${west.id}'),
			('${uuid(44)}', null, '${east.id}');
		insert into party_territory (party_id, territory_id, started_on, ended_on) values
			('${uuid(10)}', '${uuid(41)}', null, null), ('${uuid(10)}', '${uuid(42)}', null, null),
			('${uuid(11)}', '${uuid(42)}', null, null), ('${uuid(12)}', '${uuid(43)}', null, null),
			('${uuid(12)}', '${uuid(44)}', '2001-01-01', '2001-02-01'),
			('${uuid(13)}', '${uuid(42)}', '2001-01-01', '2001-02-01');`,
		].join(""),
	);
	const { body } = await get("vendors/summary");
	assert.partialDeepStrictEqual(body.all, {
		markets: [
			{ ...east, count: 1 },
			{ ...west, count: 2 },
		],
		elsewhere: 1,
		no_territory: 1,
	});
	assert.partialDeepStrictEqual(inCategory(body, "lender"), {
		markets: [
			{ ...east, count: 1 },
			{ ...west, count: 2 },
		],
		elsewhere: 1,
		no_territory: 0,
	});
	assert.partialDeepStrictEqual(inCategory(body, "attorney"), {
		markets: [
			{ ...east, count: 1 },
			{ ...west, count: 1 },
		],
	});
	assert.partialDeepStrictEqual(body.no_category, {
		markets: [],
		elsewhere: 0,
		no_territory: 1,
	});
	const dell = (await get("vendors/summary?owner=dell")).body;
	assert.partialDeepStrictEqual(dell.all, {
		markets: [{ ...west, count: 1 }],
		elsewhere: 0,
		no_territory: 0,
	});
	for (const contract of ["", "&contract=vendor-directory.v1"]) {
		const list = await get(`vendors?markets=true${contract}`);
		assert.equal(list.status, 200, contract || "bare market read");
		assert.partialDeepStrictEqual(list.body, {
			page_size: 4,
			page_count: 1,
			rows: [
				{ id: uuid(10), markets: [east, west] },
				{ id: uuid(11), markets: [west] },
				{ id: uuid(12), territory: "Example Typed Territory", markets: [] },
				{ id: uuid(13), territory: null, markets: [] },
			],
		});
	}
});
