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

// A blank Mermaid title reserves space for GitHub's expand and copy controls.
const controlsSpacer = 'title: "\\u00a0"';

function areaPage(area: Area) {
	const boxes = area.tables.map((table) => `  "${tableName(table)}"`);
	const lines = area.relations.map((link) => {
		const [left] = markers[link.cardinality];
		const [, right] = markers[link.parent_cardinality];
		const label = link.columns.map(plainName).join(", ");
		// Nonbreaking spaces keep ELK's self-link labels left of the cardinality markers.
		const padding = link.table === link.parent_table ? "#160;".repeat(4) : "";
		return `  "${tableName(link.table)}" ${left}--${right} "${tableName(link.parent_table)}" : "${label}${padding}"`;
	});
	const tables = area.tables.map(
		(table) => `- [${tableName(table)}](${table}.md)`,
	);
	const connections =
		area.id === "deals"
			? [...area.neighbors]
					.sort(([a], [b]) => a.name.localeCompare(b.name, "en"))
					.map(
						([other, count]) =>
							`[${other.name}](viewpoint-${other.id}.md) (${count})`,
					)
			: [];
	const reserveControls = area.id === "people";
	return [
		`# ${area.name}`,
		"",
		"```mermaid",
		"---",
		...(reserveControls ? [controlsSpacer] : []),
		"config:",
		"  layout: elk",
		"  er:",
		...(reserveControls ? ["    titleTopMargin: 56"] : []),
		"    nodeSpacing: 22",
		"    rankSpacing: 44",
		"---",
		"erDiagram",
		...boxes,
		...lines,
		"```",
		...(connections.length
			? [
					"",
					"## Connects to",
					"",
					"Numbers count foreign keys between the two areas.",
					"",
					connections.join(" · "),
				]
			: []),
		"",
		"## Tables",
		"",
		...tables,
		"",
		"See each table for its columns and links to other areas.",
		"",
	].join("\n");
}

const areaGroups = [
	[
		"People and clients",
		["people", "relationships", "clients", "vendors-territories", "leads"],
	],
	[
		"Deals and property",
		[
			"deals",
			"imported-deals",
			"property",
			"leases",
			"offers",
			"tours",
			"website",
		],
	],
	[
		"Mail and activity",
		["email", "documents", "activity", "home-calendar", "doc"],
	],
	[
		"Marketing and billing",
		[
			"marketing-posts",
			"marketing-categories",
			"marketing-review",
			"social-accounts",
			"invoices",
			"commissions",
		],
	],
	["Users and records", ["users-jobs", "changes-preferences"]],
] as const;

const areaUrl =
	"https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables";

function masterDrawing(areas: Area[]) {
	const remaining = new Map(areas.map((area) => [area.id, area]));
	const groups: { name: string; areas: Area[] }[] = areaGroups.map(
		([name, ids]) => ({
			name,
			areas: ids.flatMap((id) => {
				const area = remaining.get(id);
				remaining.delete(id);
				return area ? [area] : [];
			}),
		}),
	);
	groups.push({ name: "Other areas", areas: [...remaining.values()] });
	const ordered = groups.flatMap((group) => group.areas);
	const omitted = new Set(
		ordered.filter((area) => area.neighbors.size > (areas.length - 1) / 2),
	);
	const boxes = groups.flatMap(({ name, areas }, index) =>
		areas.length > 0
			? [
					`  subgraph group${index}[" "]`,
					`    heading-group${index}["${name}"]:::heading`,
					...areas.map(({ id, name }) => `    a-${id}["${name}"]`),
					"  end",
				]
			: [],
	);
	const lines = ordered.flatMap((area, index) =>
		omitted.has(area)
			? []
			: ordered.slice(index + 1).flatMap((other) => {
					const count = area.neighbors.get(other);
					return count && !omitted.has(other)
						? [`  a-${area.id} ---|${count}| a-${other.id}`]
						: [];
				}),
	);
	const links = areas.map(
		({ id }) => `  click a-${id} href "${areaUrl}/viewpoint-${id}.md"`,
	);
	// ELK routes through subgraph titles, so give each heading a node it can route around.
	const headingOrder = groups.flatMap(({ areas: [first] }, index) =>
		first ? [`  heading-group${index} ~~~ a-${first.id}`] : [],
	);
	const omittedNames = [...omitted]
		.filter(({ id }) => id !== "users-jobs")
		.map(({ name }) => name);
	const notes = [];
	const users = [...omitted].find(({ id }) => id === "users-jobs");
	if (users) {
		notes.push(
			"",
			`The Users and jobs area connects to ${users.neighbors.size} other areas, mostly through audit fields. Some links record ownership, such as who owns a Doc conversation.`,
		);
	}
	if (omittedNames.length) {
		const names = new Intl.ListFormat("en", { type: "conjunction" }).format(
			omittedNames,
		);
		notes.push("", `The same rule omits lines to ${names}.`);
	}
	const deals = [...omitted].find(({ id }) => id === "deals");
	if (deals) {
		const keyIds = ["imported-deals", "offers", "leases"];
		const keyConnections = [...deals.neighbors]
			.filter(([area]) => keyIds.includes(area.id))
			.sort(([a], [b]) => keyIds.indexOf(a.id) - keyIds.indexOf(b.id))
			.map(([area, count]) => `${area.name} (${count})`);
		if (keyConnections.length) {
			const names = new Intl.ListFormat("en", { type: "conjunction" }).format(
				keyConnections,
			);
			notes.push(
				"",
				`Deals connects to ${names}. See [Deals](tables/viewpoint-deals.md#connects-to) for all its connections.`,
			);
		}
	}
	return [
		"```mermaid",
		"---",
		controlsSpacer,
		"config:",
		"  layout: elk",
		"  flowchart:",
		"    titleTopMargin: 56",
		"    htmlLabels: false",
		"    diagramPadding: 8",
		"    nodeSpacing: 25",
		"    rankSpacing: 35",
		"---",
		"flowchart TB",
		...boxes,
		...lines,
		...links,
		...headingOrder,
		"  classDef heading fill:none,stroke:none,font-weight:bold",
		"```",
		...notes,
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
