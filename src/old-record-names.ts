import { sql, type Transaction } from "kysely";
import type { DB } from "./next-database.d.ts";

type RecordLink = { text: string; url: string };
type OldRecordNames = ReadonlyMap<string, RecordLink>;

const unitLabel = String.raw`(?:\b(?:suite|ste|unit|bldg|building|room|space|level|floor|fl|lot|bay|apt|office)s?\b\.?\s*#?|#)`;
const unitNumber = String.raw`(?=[a-z-]*\d)[a-z0-9]+(?:-[a-z0-9]+)*`;
const unitList = String.raw`(?i:${unitLabel}\s*${unitNumber}(?:\s*(?:,|&|and)\s*(?:and\s*)?#?\s*${unitNumber})*)`;
const linkLike = String.raw`\S*[/@=]\S*`;
const codeShape = String.raw`[CLPTV]-(?:[A-Z]+-)?\d{3,4}`;
// Links, paths, emails, query strings and unit numbers such as "Suites C-101 and C-102" stay as written.
const oldRecordCode = new RegExp(
	String.raw`${linkLike}|${unitList}|(?<![\w-])(?<code>${codeShape})(?![\w-]|\.\w)`,
	"g",
);

const codesIn = (text: string) =>
	[...text.matchAll(oldRecordCode)].flatMap(({ groups, index }) =>
		groups?.code ? [{ code: groups.code, index }] : [],
	);

export async function readOldRecordNames(
	db: Transaction<DB>,
	texts: (string | null)[],
): Promise<OldRecordNames> {
	const codes = [
		...new Set(
			texts.flatMap((text) => codesIn(text ?? "").map(({ code }) => code)),
		),
	];
	if (codes.length === 0) return new Map();
	const rows = await db
		.selectFrom("outside_id as o")
		.innerJoin("party as p", "p.id", "o.party_id")
		.select(["o.value", "p.id", sql<string>`btrim(p.name)`.as("name")])
		.where("o.source", "=", "old_system_ref")
		.where("o.value", "in", codes)
		.where(sql`btrim(p.name)`, "<>", "")
		.execute();
	return new Map(
		rows.map(({ value, id, name }) => [
			value,
			{ text: name, url: `/relationships?node=party:${id}` },
		]),
	);
}

export function nameOldRecords(text: string, names: OldRecordNames) {
	let named = "";
	let end = 0;
	for (const { code, index } of codesIn(text)) {
		const before = text.slice(0, index).trimEnd();
		const unknown = /(?:^|[.!?:])$/.test(before)
			? "An old record"
			: "an old record";
		named += text.slice(end, index) + (names.get(code)?.text ?? unknown);
		end = index + code.length;
	}
	return named + text.slice(end);
}

export const recordLinks = (names: OldRecordNames) => [
	...new Map([...names.values()].map((link) => [link.url, link])).values(),
];
