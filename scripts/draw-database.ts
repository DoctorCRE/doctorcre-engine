import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { URL } from "node:url";
import { z } from "zod";

const cardinality = z.enum([
	"zero_or_one",
	"exactly_one",
	"zero_or_more",
	"one_or_more",
]);
const relation = z.object({
	table: z.string(),
	columns: z.array(z.string()).min(1),
	cardinality,
	parent_table: z.string(),
	parent_cardinality: cardinality,
});
const tbls = z.object({
	tables: z.array(z.object({ name: z.string(), type: z.string() })),
	viewpoints: z
		.array(
			z.object({
				id: z.string().regex(/^[a-z][a-z0-9-]*$/),
				name: z.string(),
				tables: z.array(z.string()).min(1),
			}),
		)
		.min(1),
	relations: z.array(relation),
});
type Relation = z.infer<typeof relation>;
type Area = z.infer<typeof tbls>["viewpoints"][number] & {
	relations: Relation[];
	neighbors: Map<Area, number>;
};

function areaGraph(schema: z.infer<typeof tbls>) {
	const areas: Area[] = schema.viewpoints.map((area) => ({
		...area,
		relations: [],
		neighbors: new Map(),
	}));
	const areaByTable = new Map<string, Area>();
	for (const area of areas) {
		for (const table of area.tables) {
			assert(!areaByTable.has(table), `${table} belongs to more than one area`);
			areaByTable.set(table, area);
		}
	}
	for (const table of schema.tables) {
		if (table.type === "BASE TABLE") {
			assert(
				areaByTable.has(table.name),
				`Assign ${table.name} to an area in .tbls.yml`,
			);
		}
	}
	for (const link of schema.relations) {
		const from = areaByTable.get(link.table);
		const to = areaByTable.get(link.parent_table);
		assert(
			from && to,
			`Missing area for ${link.table} or ${link.parent_table}`,
		);
		if (from === to) {
			from.relations.push(link);
		} else {
			const count = (from.neighbors.get(to) ?? 0) + 1;
			from.neighbors.set(to, count);
			to.neighbors.set(from, count);
		}
	}
	return areas;
}

function plainName(identifier: string) {
	return identifier
		.replace(/^next\./, "")
		.replaceAll("_", " ")
		.replace(/\bid\b/g, "ID");
}

function tableName(table: string) {
	const name = plainName(table);
	return name.charAt(0).toUpperCase() + name.slice(1);
}

const markers = {
	zero_or_one: ["|o", "o|"],
	exactly_one: ["||", "||"],
	zero_or_more: ["}o", "o{"],
	one_or_more: ["}|", "|{"],
} as const;

function areaPage(area: Area) {
	const boxes = area.tables.map((table) => `  "${tableName(table)}"`);
	const lines = area.relations.map((link) => {
		const [left] = markers[link.cardinality];
		const [, right] = markers[link.parent_cardinality];
		const label = link.columns.map(plainName).join(", ");
		return `  "${tableName(link.table)}" ${left}--${right} "${tableName(link.parent_table)}" : "${label}"`;
	});
	const tables = area.tables.map(
		(table) => `- [${tableName(table)}](${table}.md)`,
	);
	return [
		`# ${area.name}`,
		"",
		"```mermaid",
		"---",
		"config:",
		"  layout: elk",
		"  er:",
		"    nodeSpacing: 22",
		"    rankSpacing: 44",
		"---",
		"erDiagram",
		...boxes,
		...lines,
		"```",
		"",
		"## Tables",
		"",
		...tables,
		"",
		"See each table for its columns and links to other areas.",
		"",
	].join("\n");
}

function areaRanks(areas: Area[]) {
	// Putting neighbors in different ranks keeps the left-to-right drawing narrow.
	const ranks = new Map<Area, number>();
	for (const area of [...areas].sort(
		(a, b) => b.neighbors.size - a.neighbors.size,
	)) {
		const used = new Set(
			[...area.neighbors.keys()].map((neighbor) => ranks.get(neighbor)),
		);
		let rank = 0;
		while (used.has(rank)) rank++;
		ranks.set(area, rank);
	}
	return ranks;
}

const areaUrl =
	"https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables";

function masterDrawing(areas: Area[]) {
	const ranks = areaRanks(areas);
	const boxes = areas.map(({ id, name }) => `  a-${id}["${name}"]`);
	const lines = areas.flatMap((area) =>
		[...area.neighbors].flatMap(([other, count]) => {
			const from = ranks.get(area);
			const to = ranks.get(other);
			assert(from !== undefined && to !== undefined);
			return from < to ? [`  a-${area.id} ---|${count}| a-${other.id}`] : [];
		}),
	);
	const links = areas.map(
		({ id }) => `  click a-${id} href "${areaUrl}/viewpoint-${id}.md"`,
	);
	return [
		"```mermaid",
		"---",
		"config:",
		"  layout: dagre",
		"  flowchart:",
		"    htmlLabels: false",
		"    diagramPadding: 8",
		"    padding: 4",
		"    nodeSpacing: 10",
		"    rankSpacing: 15",
		"---",
		"flowchart LR",
		...boxes,
		...lines,
		...links,
		"```",
	].join("\n");
}

export function drawDatabase(input: unknown) {
	const areas = areaGraph(tbls.parse(input));
	return {
		master: masterDrawing(areas),
		pages: areas.map((area) => ({
			file: `viewpoint-${area.id}.md`,
			markdown: areaPage(area),
		})),
	};
}

if (import.meta.main) {
	const output = new URL("../docs/database/", import.meta.url);
	const { master, pages } = drawDatabase(JSON.parse(readFileSync(0, "utf8")));
	const readme = new URL("README.md", output);
	const before = readFileSync(readme, "utf8");
	const marker =
		/<!-- Begin master drawing -->\n.*?\n<!-- End master drawing -->/s;
	assert(marker.test(before), "Missing master drawing markers");
	writeFileSync(
		readme,
		before.replace(
			marker,
			() =>
				`<!-- Begin master drawing -->\n${master}\n<!-- End master drawing -->`,
		),
	);
	for (const { file, markdown } of pages) {
		writeFileSync(new URL(`tables/${file}`, output), markdown);
	}
}
