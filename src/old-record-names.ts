import { sql, type Transaction } from "kysely";
import type { DB } from "./next-database.d.ts";

type RecordLink = { text: string; url: string };
type OldRecordNames = ReadonlyMap<string, RecordLink>;

const oldRecordCode = /\b[CLPV]-(?:[A-Z][A-Z0-9]*-)*\d+\b/g;
// A suite or unit number such as "Suite C-101" has the same shape.
const unitLabel = /(?:\b(?:suite|ste|unit|bldg|building|room)\.?|#)\s*#?\s*$/i;

const codesIn = (text: string) =>
	[...text.matchAll(oldRecordCode)].filter(
		({ index }) => !unitLabel.test(text.slice(Math.max(0, index - 16), index)),
	);

export async function readOldRecordNames(
	db: Transaction<DB>,
	texts: (string | null)[],
): Promise<OldRecordNames> {
	const codes = [
		...new Set(texts.flatMap((text) => codesIn(text ?? "").map(([c]) => c))),
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
	for (const { 0: code, index } of codesIn(text)) {
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
