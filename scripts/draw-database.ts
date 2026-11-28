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
	parent_columns: z.array(z.string()).min(1),
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
	external: Map<string, Area>;
	neighbors: Map<Area, number>;
};

function areaGraph(schema: z.infer<typeof tbls>) {
	const areas: Area[] = schema.viewpoints.map((area) => ({
		...area,
		relations: [],
		external: new Map(),
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
			from.relations.push(link);
			to.relations.push(link);
			from.external.set(link.parent_table, to);
			to.external.set(link.table, from);
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

function areaPage(area: Area) {
	const diagrams = area.tables.flatMap((table) => {
		const neighbors = new Set<string>();
		for (const link of area.relations) {
			const other =
				link.table === table
					? link.parent_table
					: link.parent_table === table
						? link.table
						: undefined;
			if (!other) continue;
			const external = area.external.get(other);
			neighbors.add(external ? `${external.name} (area)` : tableName(other));
		}
		const nodes = [...neighbors].sort((a, b) => a.localeCompare(b, "en"));
		const groups = Array.from(
			{ length: Math.max(1, Math.ceil(nodes.length / 8)) },
			(_, index) => nodes.slice(index * 8, index * 8 + 8),
		);
		return [
			`### ${tableName(table)}`,
			"",
			...groups.flatMap((group) => [
				"```mermaid",
				"---",
				"config:",
				"  layout: elk",
				"  flowchart:",
				"    htmlLabels: false",
				"---",
				"flowchart LR",
				`  center["${tableName(table)}"]`,
				...group.flatMap((node, index) =>
					node === tableName(table)
						? ["  center --- center"]
						: [`  n${index}["${node}"]`, `  center --- n${index}`],
				),
				"```",
				"",
			]),
		];
	});
	const links = area.relations.map((link) => {
		const source = link.table.replace(/^next\./, "");
		const target = link.parent_table.replace(/^next\./, "");
		const columns = (values: string[]) =>
			values.map((value) => `\`${value}\``).join(", ");
		return `| [${source}](${link.table}.md) (${columns(link.columns)}) | [${target}](${link.parent_table}.md) (${columns(link.parent_columns)}) |`;
	});
	const connections = [...area.neighbors]
		.sort(([a], [b]) => a.name.localeCompare(b.name, "en"))
		.map(
			([other, count]) =>
				`[${other.name}](viewpoint-${other.id}.md) (${count})`,
		);
	return [
		`# ${area.name}`,
		"",
		"Each line shows a connection. The foreign keys below name the exact columns.",
		"",
		...diagrams,
		...(links.length
			? [
					"## Foreign keys",
					"",
					"| From table and columns | To table and columns |",
					"| --- | --- |",
					...links,
					"",
				]
			: []),
		...(connections.length
			? [
					"## Connects to",
					"",
					"Numbers count foreign keys between the two areas.",
					"",
					connections.join(" · "),
					"",
				]
			: []),
		"## Tables",
		"",
		...area.tables.map((table) => `- [${tableName(table)}](${table}.md)`),
		"",
		...(area.tables.includes("next.lead_source_sender")
			? ["Lead source sender is standalone intake configuration.", ""]
			: []),
	].join("\n");
}

const areaUrl =
	"https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables";

function masterDrawing(areas: Area[]) {
	return areas
		.flatMap((area, index) => {
			const neighbors = areas
				.slice(index + 1)
				.filter((other) => area.neighbors.has(other));
			if (!neighbors.length && area.neighbors.size) return [];
			return [
				`### ${area.name}`,
				"",
				"```mermaid",
				"---",
				"config:",
				"  layout: elk",
				"  flowchart:",
				"    htmlLabels: false",
				"---",
				"flowchart LR",
				`  a-${area.id}["${area.name}"]`,
				...neighbors.flatMap((other) => [
					`  a-${other.id}["${other.name}"]`,
					`  a-${area.id} ---|${area.neighbors.get(other)}| a-${other.id}`,
				]),
				...[area, ...neighbors].map(
					({ id }) => `  click a-${id} href "${areaUrl}/viewpoint-${id}.md"`,
				),
				"```",
				"",
			];
		})
		.join("\n");
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
