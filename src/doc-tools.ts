import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { isCalendarDate } from "./calendar-date.ts";
import type { JsonObject } from "./database.d.ts";
import { findDocRecords, readDocRecord, type Source } from "./doc-reads.ts";
import { nextTransaction } from "./next-connection.ts";
import type { DB } from "./next-database.d.ts";
import { isArguments } from "./save-door.ts";
import { isUuid } from "./uuid.ts";

const kind = z.enum(["deal", "lead", "client"]);
const text = z
	.string()
	.trim()
	.min(1)
	.max(4000)
	.refine((value) => value.isWellFormed() && !value.includes("\0"));
const source = z.string().max(48);
const findInput = z.strictObject({
	query: text,
	kind: z.enum(["all", ...kind.options]),
});
const proposalFields = {
	kind: z.enum(["note", "next_step"]),
	text: text.optional(),
	what: text.optional(),
	due_on: z
		.string()
		.refine((date) => isCalendarDate(date) && !date.startsWith("0000"))
		.nullable()
		.optional(),
};
const proposalInput = z.strictObject({ ...proposalFields, source });
const replyInput = z.strictObject({
	kind: z.enum(["answer", "clarification", "refusal"]),
	text,
	sources: z.array(z.unknown()).max(40),
	proposal: z.unknown().optional(),
});

export type DocClaimState = {
	reads: number;
	sources: Record<string, Source>;
	choices?: Source[];
	failed?: true;
};
const keyFor = (ref: Source["ref"]) => `${ref.kind}:${ref.id}`;

function getSource(state: DocClaimState, value: unknown) {
	const ref = isArguments(value) && value.ref;
	const key =
		isArguments(ref) && kind.safeParse(ref.kind).success && isUuid(ref.id)
			? `${ref.kind}:${ref.id}`
			: value;
	return typeof key === "string" && Object.hasOwn(state.sources, key)
		? state.sources[key]
		: undefined;
}

function saveProposal(payload: unknown, state: DocClaimState): JsonObject {
	const parsed = z
		.strictObject({
			...proposalFields,
			source: source.optional(),
			target: z.unknown().optional(),
		})
		.safeParse(payload);
	if (!parsed.success) throw new Error("Invalid save proposal");
	const { kind, source: key, target: ref, text, what, due_on } = parsed.data;
	const target = getSource(state, key ?? ref);
	if (!target || state.choices)
		throw new Error("Choose an authorized source first");
	if (kind === "note" && text && what === undefined && due_on === undefined)
		return { kind, target, text };
	if (
		kind === "next_step" &&
		what &&
		due_on !== undefined &&
		text === undefined
	)
		return { kind, target, what, due_on };
	throw new Error("Invalid save proposal");
}

export function validateDocAnswer(payload: unknown, state: DocClaimState) {
	if (state.failed) throw new Error("A Doc read failed");
	if (state.choices)
		return {
			kind: "clarification",
			text: "Which of these records did you mean?",
			sources: state.choices,
			proposal: null,
		};
	const parsed = replyInput.safeParse(payload);
	if (!parsed.success) throw new Error("Invalid Doc answer");
	const { kind, text, sources, proposal } = parsed.data;
	const cited = new Set<Source>();
	if (kind !== "refusal") {
		for (const value of sources) {
			const record = getSource(state, value);
			if (!record) throw new Error("Doc cited an unread record");
			cited.add(record);
		}
	}
	if (kind === "answer" && !cited.size)
		throw new Error("Doc answer has no sources");
	return {
		kind,
		text,
		sources: [...cited],
		proposal:
			kind === "answer" && proposal != null
				? saveProposal(proposal, state)
				: null,
	};
}

const content = (value: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

export function registerDocTools(
	server: McpServer,
	{
		connection,
		partner,
		state,
		timeout,
	}: {
		connection: string;
		partner: string;
		state: DocClaimState;
		timeout: number;
	},
) {
	function read(run: (db: Transaction<DB>) => Promise<unknown>) {
		if (state.failed) throw new Error("A Doc read failed");
		if (state.choices) throw new Error("Choose a record to continue");
		if (state.reads >= 4) throw new Error("Doc read limit exceeded");
		state.reads++;
		return nextTransaction(connection, "read", async (db) => {
			await sql`select set_config('statement_timeout', ${String(timeout)}, true)`.execute(
				db,
			);
			return content(await run(db));
		}).catch(() => {
			state.failed = true;
			throw new Error("A Doc read failed");
		});
	}

	server.registerTool(
		"find",
		{
			description:
				"Find deals, leads, and clients by name or ID. Use the returned source keys.",
			inputSchema: findInput,
		},
		({ query, kind }) =>
			read(async (db) => {
				const matches = await findDocRecords(db, query, kind);
				const labelKey = (label: string) => label.trim().toLowerCase();
				const exact = matches.filter(
					({ label }) => labelKey(label) === labelKey(query),
				);
				const choices = exact.length ? exact : matches;
				if (
					choices.length > 1 &&
					new Set(choices.map(({ label }) => labelKey(label))).size === 1
				) {
					state.choices = choices.map(({ city, ...record }) => ({
						...record,
						label: city ? `${record.label} (${city})` : record.label,
					}));
					return validateDocAnswer(null, state);
				}
				return matches.map(({ city, ...record }) => {
					const source = keyFor(record.ref);
					state.sources[source] = record;
					return { ...record, city, source };
				});
			}),
	);
	server.registerTool(
		"read",
		{
			description: "Read facts for a source returned by find in this turn.",
			inputSchema: z.strictObject({ source }),
		},
		({ source }) =>
			read(async (db) => {
				const record = getSource(state, source);
				const result = record ? await readDocRecord(db, record, partner) : null;
				if (!result) delete state.sources[source];
				return result;
			}),
	);
	server.registerTool(
		"propose_save",
		{
			description:
				"Propose a note or next step on a source from this turn for partner confirmation.",
			inputSchema: proposalInput,
		},
		(args) => content(saveProposal(args, state)),
	);
	server.registerTool(
		"validate_answer",
		{
			description:
				"Validate an answer or clarification against sources returned in this turn.",
			inputSchema: replyInput,
		},
		(args) => content(validateDocAnswer(args, state)),
	);
}
