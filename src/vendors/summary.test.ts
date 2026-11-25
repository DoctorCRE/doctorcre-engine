import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
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

type Tile = {
	vendors: number;
	quiet: number;
	relationships: Record<string, number>;
};
type Body = {
	error?: string;
	all_vendors: Tile;
	categories: (Tile & { slug: string })[];
	no_category: Tile;
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
		const response = await door.request({ user: "joe" }, path, {
			method: "GET",
		});
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

const tile = (
	vendors: number,
	quiet: number,
	words: Partial<Record<string, number>>,
) => ({
	vendors,
	quiet,
	relationships: {
		core: 0,
		established: 0,
		building: 0,
		prospective: 0,
		not_rated: 0,
		parked: 0,
		avoid: 0,
		...words,
	},
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
	const { status, body } = await get("vendor-summary");
	assert.equal(status, 200);
	assert.deepEqual(body, {
		schema_version: "vendor-summary.v1",
		owner: "all",
		quiet_days: 90,
		all_vendors: tile(7, 0, {
			core: 1,
			established: 1,
			building: 1,
			prospective: 1,
			not_rated: 1,
			parked: 1,
			avoid: 1,
		}),
		categories: [
			{
				slug: "attorney",
				label: "Attorney",
				...tile(3, 0, { core: 1, prospective: 1, not_rated: 1 }),
			},
			{ slug: "cpa", label: "CPA", ...tile(0, 0, {}) },
			{
				slug: "lender",
				label: "Lender",
				...tile(4, 0, { core: 1, established: 1, building: 1, parked: 1 }),
			},
		],
		no_category: tile(1, 0, { avoid: 1 }),
	});
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
	const summary = await get("vendor-summary");
	const quiet = await get("quiet-follow-ups");
	assert.equal(quiet.status, 200);
	const quietVendors = quiet.body.proposals.filter(
		(p) => p.subject_type === "vendor",
	);
	assert.equal(quietVendors.length, 2);
	assert.equal(summary.body.all_vendors.quiet, quietVendors.length);
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
		inCategory((await get(`vendor-summary?owner=${owner}`)).body, "cpa");
	assert.equal((await cpa("joe")).relationships.building, 1);
	assert.equal((await cpa("joe")).vendors, 1);
	assert.equal((await cpa("dell")).relationships.established, 1);
	assert.equal((await cpa("dell")).vendors, 1);
	assert.equal((await cpa("all")).vendors, 3);
	const refused = await get("vendor-summary?owner=someone");
	assert.equal(refused.status, 400);
	assert.equal(refused.body.error, "value_not_in_declared_vocabulary");
});
