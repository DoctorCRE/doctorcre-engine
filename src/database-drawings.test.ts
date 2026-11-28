import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { URL } from "node:url";
import { drawDatabase } from "../scripts/draw-database.ts";
import { copyTest } from "./test-copy.ts";

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
	assert.doesNotMatch(diagram, /next\.|FOREIGN KEY/);
	assert.match(
		diagram,
		/"Deal" \}o--\|\| "People \(area\)" : "owner ID to Party"/,
	);
	const people = pages.find(
		({ file }) => file === "viewpoint-people.md",
	)?.markdown;
	assert.match(
		people ?? "",
		/"Deals \(area\)" \}o--\|\| "Party" : "Deal: owner ID"/,
	);
});

test("the master counts cross-area foreign keys in both directions with one line per pair", () => {
	const { master } = drawDatabase({ tables, viewpoints, relations });
	assert.match(master, /a-jobs\["Jobs"\]/);
	assert.match(master, /click a-jobs href "[^"]+\/viewpoint-jobs\.md"/);
	assert.deepEqual(master.match(/^ {2}.+ ---\|.+$/gm), [
		"  a-deals ---|3| a-people",
	]);
});

test("the master includes widely shared links and keeps all area boxes", () => {
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
	assert.equal(master.match(/^ {2}.+ ---\|.+$/gm)?.length, relations.length);
});

test("the area page links to every neighbor", () => {
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
	const { pages } = drawDatabase({ tables, viewpoints, relations });
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

test("committed drawings include every schema foreign key and area count", async () => {
	const { db, setup, cleanup } = copyTest();
	await setup();
	try {
		const { rows } = await db.query<{
			source: string;
			target: string;
			columns: string[];
		}>(`select src.relname as source, dst.relname as target,
			array(select a.attname from unnest(c.conkey) with ordinality k(attnum, ord)
			join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum order by k.ord)::text[] as columns
			from pg_constraint c join pg_class src on src.oid = c.conrelid
			join pg_class dst on dst.oid = c.confrelid join pg_namespace n on n.oid = src.relnamespace
			where c.contype = 'f' and n.nspname = 'next'`);
		const config = readFileSync(
			new URL("../docs/database/.tbls.yml", import.meta.url),
			"utf8",
		);
		const areas = [
			...config.matchAll(
				/ {2}- id: ([^\n]+)\n {4}name: ([^\n]+)[\s\S]*? {4}tables:\n((?: {6}- next\.[^\n]+\n)+)/g,
			),
		].map((match) => ({
			id: match[1],
			name: match[2],
			tables: [...(match[3] ?? "").matchAll(/next\.([^\n]+)/g)].map(
				(m) => m[1],
			),
		}));
		const owner = (table: string) => {
			const area = areas.find((candidate) => candidate.tables.includes(table));
			assert(area, `Missing area for ${table}`);
			return area;
		};
		const name = (value: string) => {
			const plain = value.replaceAll("_", " ").replace(/\bid\b/g, "ID");
			return plain.charAt(0).toUpperCase() + plain.slice(1);
		};
		const columns = (values: string[]) =>
			values
				.map((value) => value.replaceAll("_", " ").replace(/\bid\b/g, "ID"))
				.join(", ");
		const pages = new Map(
			areas.map((area) => [
				area.id,
				readFileSync(
					new URL(
						`../docs/database/tables/viewpoint-${area.id}.md`,
						import.meta.url,
					),
					"utf8",
				).split("\n"),
			]),
		);
		const counts = new Map<string, number>();
		for (const fk of rows) {
			const from = owner(fk.source),
				to = owner(fk.target);
			for (const area of new Set([from, to])) {
				const source = area === from ? name(fk.source) : `${from.name} (area)`;
				const target = area === to ? name(fk.target) : `${to.name} (area)`;
				const label =
					area !== from
						? `${name(fk.source)}: ${columns(fk.columns)}`
						: area !== to
							? `${columns(fk.columns)} to ${name(fk.target)}`
							: columns(fk.columns);
				const lines = pages.get(area.id);
				assert(lines);
				if (from !== to) {
					const neighbor = area === from ? to : from;
					const table = area === from ? fk.target : fk.source;
					const start = lines.indexOf(`  "${neighbor.name} (area)" {`);
					const end = lines.indexOf("  }", start);
					assert(
						start >= 0 &&
							end > start &&
							lines.slice(start, end).includes(`    string ${table}`),
						`Missing ${table} in ${neighbor.id} box on ${area.id}`,
					);
				}
				const index = lines.findIndex(
					(line) =>
						line.includes(`"${source}"`) &&
						line.includes(`"${target}"`) &&
						(line.endsWith(`: "${label}"`) ||
							line.endsWith(`: "${label}${"#160;".repeat(4)}"`)) &&
						line.includes("--"),
				);
				assert(
					index >= 0,
					`Missing ${fk.source} (${fk.columns}) -> ${fk.target} in ${area.id}`,
				);
				lines.splice(index, 1);
			}
			if (from !== to) {
				const key = [from.id, to.id].sort().join("|");
				counts.set(key, (counts.get(key) ?? 0) + 1);
			}
		}
		for (const [area, lines] of pages) {
			assert(
				!lines.some((line) => /^ {2}".+" [|o{}-]+--[|o{}-]+ "/.test(line)),
				`Unexpected link in ${area}`,
			);
		}
		const overview = readFileSync(
			new URL("../docs/database/README.md", import.meta.url),
			"utf8",
		);
		const actual = new Map(
			[...overview.matchAll(/^ {2}a-([^ ]+) ---\|(\d+)\| a-([^\n]+)$/gm)].map(
				(m) => [[m[1], m[3]].sort().join("|"), Number(m[2])],
			),
		);
		assert.deepEqual(actual, counts);
	} finally {
		await cleanup();
	}
});
