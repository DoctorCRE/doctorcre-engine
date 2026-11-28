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
		parent_columns: ["id"],
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

test("area pages group connections and list distinct foreign keys", () => {
	const { pages } = drawDatabase({ tables, viewpoints, relations });
	const deals = pages.find(
		({ file }) => file === "viewpoint-deals.md",
	)?.markdown;
	assert(deals);
	assert.match(
		deals,
		/\| \[deal_phase_change\]\(next\.deal_phase_change\.md\) \(`phase`\) \| \[phase\]\(next\.phase\.md\) \(`id`\) \|/,
	);
	assert.match(deals, /\(`previous_phase`\)/);
	assert.match(deals, /n\d+\["People \(area\)"\]/);
	assert.equal((deals.match(/center --- n\d+/g) ?? []).length, 4);
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

test("self-references appear as a connection", () => {
	const { pages } = drawDatabase({
		tables,
		viewpoints,
		relations: [foreignKey("deal", "deal", "previous_deal_id")],
	});
	assert.match(pages[0]?.markdown ?? "", /center --- center/);
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
			target_columns: string[];
		}>(`select src.relname as source, dst.relname as target,
			array(select a.attname from unnest(c.conkey) with ordinality k(attnum, ord)
			join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum order by k.ord)::text[] as columns,
			array(select a.attname from unnest(c.confkey) with ordinality k(attnum, ord)
			join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum order by k.ord)::text[] as target_columns
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
		const columns = (values: string[]) =>
			values.map((value) => `\`${value}\``).join(", ");
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
				const lines = pages.get(area.id);
				assert(lines);
				const row = `| [${fk.source}](next.${fk.source}.md) (${columns(fk.columns)}) | [${fk.target}](next.${fk.target}.md) (${columns(fk.target_columns)}) |`;
				const cells = (line: string) =>
					line
						.split("|")
						.map((cell) => cell.trim())
						.join("|");
				const index = lines.findIndex((line) => cells(line) === cells(row));
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
				!lines.some((line) => line.startsWith("| [")),
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
