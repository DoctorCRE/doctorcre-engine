import assert from "node:assert/strict";
import { test } from "node:test";
import { drawDatabase } from "../scripts/draw-database.ts";

const tables = ["deal", "deal_phase_change", "phase", "party", "job"].map(
	(name) => ({ name: `next.${name}`, type: "BASE TABLE" }),
);

const viewpoints = [
	{
		id: "deals",
		name: "Deals",
		tables: ["next.deal", "next.deal_phase_change", "next.phase"],
	},
	{ id: "people", name: "People", tables: ["next.party"] },
	{ id: "jobs", name: "Jobs", tables: ["next.job"] },
];

function foreignKey(table: string, parent: string, ...columns: string[]) {
	return {
		table: `next.${table}`,
		columns,
		cardinality: "zero_or_more",
		parent_table: `next.${parent}`,
		parent_cardinality: "exactly_one",
	};
}

const relations = [
	foreignKey("deal_phase_change", "phase", "phase"),
	foreignKey("deal_phase_change", "phase", "previous_phase"),
	foreignKey("deal_phase_change", "party", "changed_by"),
	foreignKey("deal", "party", "owner_id"),
	foreignKey("party", "deal", "first_deal_id"),
];

test("area pages show plain names and distinct foreign key labels", () => {
	const { pages } = drawDatabase({ tables, viewpoints, relations });
	const deals = pages.find(
		({ file }) => file === "viewpoint-deals.md",
	)?.markdown;
	assert(deals);
	assert.match(deals, /^# Deals\n/);
	assert.match(deals, /"Deal phase change" \}o--\|\| "Phase" : "phase"/);
	assert.match(
		deals,
		/"Deal phase change" \}o--\|\| "Phase" : "previous phase"/,
	);
	assert.match(deals, /\[Deal phase change\]\(next\.deal_phase_change\.md\)/);
	const diagram = deals.split("```")[1];
	assert(diagram);
	assert.doesNotMatch(diagram, /next\.|FOREIGN KEY|Party/);
});

test("the master counts cross-area foreign keys in both directions with one line per pair", () => {
	const { master } = drawDatabase({ tables, viewpoints, relations });
	assert.match(master, /a-jobs\["Jobs"\]/);
	assert.match(master, /click a-jobs href "[^"]+\/viewpoint-jobs\.md"/);
	assert.deepEqual(master.match(/^ {2}.+ ---\|.+$/gm), [
		"  a-people ---|3| a-deals",
	]);
});

test("the master omits widely shared links and keeps all area boxes", () => {
	const names = [
		"users-jobs",
		"people",
		"deals",
		"doc",
		"invoices",
		"activity",
		"offers",
	];
	const tables = names.map((name) => ({
		name: `next.${name}`,
		type: "BASE TABLE",
	}));
	const viewpoints = names.map((id) => ({
		id,
		name: id,
		tables: [`next.${id}`],
	}));
	const relations = [
		...names
			.slice(1)
			.map((name) => foreignKey(name, "users-jobs", "changed_by")),
		...names.slice(2).map((name) => foreignKey(name, "people", "owner_id")),
		foreignKey("deals", "doc", "conversation_id"),
	];
	const { master } = drawDatabase({ tables, viewpoints, relations });
	assert.match(master, /a-users-jobs\["users-jobs"\]/);
	assert.match(master, /a-people\["people"\]/);
	assert.match(
		master,
		/Users and jobs area connects to 6 other areas, mostly through audit fields/,
	);
	assert.match(master, /The same rule omits lines to people\./);
	assert.deepEqual(master.match(/^ {2}.+ ---\|.+$/gm), [
		"  a-deals ---|1| a-doc",
	]);
});

test("the master names key Deals connections and the area page links to every neighbor", () => {
	const viewpoints = [
		["deals", "Deals"],
		["imported-deals", "Imported deals"],
		["offers", "Offers"],
		["leases", "Leases"],
		["people", "People"],
	].map(([id, name]) => ({ id, name, tables: [`next.${id}`] }));
	const tables = viewpoints.flatMap(({ tables }) =>
		tables.map((name) => ({ name, type: "BASE TABLE" })),
	);
	const relations = [
		...["imported-deals", "offers", "leases", "people"].map((id) =>
			foreignKey(id, "deals", "deal_id"),
		),
		foreignKey("deals", "offers", "accepted_offer_id"),
	];
	const { master, pages } = drawDatabase({ tables, viewpoints, relations });
	assert.match(
		master,
		/Deals connects to Imported deals \(1\), Offers \(2\), and Leases \(1\)\./,
	);
	const deals = pages.find(
		({ file }) => file === "viewpoint-deals.md",
	)?.markdown;
	assert(deals);
	assert.match(deals, /## Connects to/);
	assert.match(deals, /\[Offers\]\(viewpoint-offers\.md\) \(2\)/);
	assert.match(deals, /\[People\]\(viewpoint-people\.md\) \(1\)/);
});

test("self-reference labels leave room for their cardinality markers", () => {
	const { pages } = drawDatabase({
		tables,
		viewpoints,
		relations: [foreignKey("deal", "deal", "previous_deal_id")],
	});
	assert.match(
		pages[0]?.markdown ?? "",
		/"Deal" \}o--\|\| "Deal" : "previous deal ID(?:#160;){4}"/,
	);
});

test("the drawings require an area for every table, including tables with no foreign keys", () => {
	assert.throws(
		() =>
			drawDatabase({ tables, viewpoints: viewpoints.slice(0, 2), relations }),
		/Assign next\.job to an area/,
	);
});
