import assert from "node:assert/strict";
import { test } from "node:test";
import { drawDatabase } from "../../scripts/draw-database.ts";

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
		"  a-deals ---|3| a-people",
	]);
});

test("the drawings require an area for every table, including tables with no foreign keys", () => {
	assert.throws(
		() =>
			drawDatabase({ tables, viewpoints: viewpoints.slice(0, 2), relations }),
		/Assign next\.job to an area/,
	);
});
