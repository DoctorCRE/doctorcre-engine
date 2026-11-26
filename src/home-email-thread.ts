import { createHash } from "node:crypto";
import { type Expression, sql, type Transaction } from "kysely";
import { filingScope } from "./activity/filing-evidence.ts";
import { isoMillis } from "./answer.ts";
import type { DB } from "./next-database.d.ts";

export function senderLabel(
	email: "e" | "title_email",
	fallbackToAddress = true,
) {
	return sql<
		string | null
	>`coalesce(nullif(btrim(${sql.ref(`${email}.sender_name`)}), ''),
		(select min(party.name) from party_email
			join party on party.id = party_email.party_id
			where party_email.address = ${sql.ref(`${email}.sender`)}
			having count(*) = 1),
		${fallbackToAddress ? sql.ref(`${email}.sender`) : null}::text)`;
}

export function sourceInMailbox(
	source: Expression<string | null>,
	userId: string | Expression<string>,
	{ requireMailbox = false } = {},
) {
	return sql<boolean>`coalesce((select bool_or(user_id = ${userId}::uuid)
		from email_mailbox where activity_id = ${source}), ${!requireMailbox})`;
}

export const mailGroup = sql<
	string | null
>`coalesce('conversation:' || e.conversation_id, 'email:' || e.activity_id)`;

// Suggestions share a source when they come from one email thread, else one call or meeting.
export function decisionSource(
	proposal: string,
	mail: Expression<string | null> = sql`(select ${mailGroup} from email e
		where e.activity_id = ${sql.ref(`${proposal}.activity_id`)})`,
) {
	const column = (name: string) => sql.ref(`${proposal}.${name}`);
	return sql<string>`coalesce(${mail}, ${column("activity_id")}::text, ${column("id")}::text)`;
}

// Suggestions on one source are one decision when they file it the same way or set one person's next step for one owner.
export function decisionKey(proposal: string) {
	const column = (name: string) => sql.ref(`${proposal}.${name}`);
	return sql<string>`case
		when ${column("kind")} in ('file_to_deal', 'possible_new_deal') and ${filingScope(proposal)} is null
			then ${column("kind")} || ':' || coalesce(${column("deal_id")}::text, '')
		when ${column("kind")} = 'next_step' and ${column("party_id")} is not null
			then 'next_step:' || ${column("party_id")} || ':' || coalesce(${column("owner_party_id")}::text, '')
		else ${column("id")}::text end`;
}

// Every screen shows a decision once, as its newest pending suggestion.
export function decisionPosition(
	proposal: string,
	source: Expression<string | null>,
) {
	const column = (name: string) => sql.ref(`${proposal}.${name}`);
	return sql<number>`row_number() over (
		partition by ${source}, ${decisionKey(proposal)}
		order by (${column("status")} = 'pending') desc, ${column("created_at")} desc, ${column("id")})`;
}

type Sender = { sender: string; sender_name: string | null };

type ThreadRow = Sender & {
	activity_id: string;
	happened_at: string;
	exact_happened_at: string;
	summary: DB["activity"]["summary"];
} & Pick<
		DB["email"],
		"message_id" | "subject" | "body" | "authored" | "history"
	>;

const quotePrefix = /^\s*>[> \t]*/;
const from = /^\*?From:\*? *[^* ]/i;
const replyHeader = [
	from,
	/^\*?(?:Sent|Date):\*? *[^* ]/i,
	/^\*?To:/i,
	/^\*?Subject:\*? *[^* ]/i,
];
const inviteHeading =
	/^(?:Microsoft Teams meeting|Join Microsoft Teams Meeting|Join Zoom Meeting)$/i;
const teamsJoin =
	/^Join (?:the meeting now|Microsoft Teams Meeting|on your computer):? <?https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^ <>]+>?$/i;
const zoomJoin =
	/^Join Zoom Meeting:? <?https:\/\/(?:[\w-]+\.)?zoom\.us\/j\/\d+(?:\?[^ <>]+)?>?$/i;
const inviteDetail =
	/^(?:Join the meeting now|Meeting ID: \d+(?: \d+)*|Passcode: [\w-]+)$/i;

const replyOpener =
	/\bOn[ \t]+(?=[^<>\r\n]{0,48}\d)[^<>]{1,240}?(?:<[^<>]{1,160}>)?\s*\bwrote:/i;
const replyOpenerEnd = new RegExp(`${replyOpener.source}$`, "i");
const forwarded =
	/\bBegin forwarded message:|(?<!-)-{2,} *(?:original|forwarded) message *-{2,}/i;
const headerField =
	/(?<![^\s.…>])\*{0,2}(From|Sent|Date|To|Cc|Bcc|Subject)(?::\*{0,2}|\*{1,2}:)(?=\s|$)/gi;
const phone = /(?:\+?1[ .-]*)?(?:\(\d{3}\)|\d{3})[ .-]*\d{3}[ .-]*\d{4}/;
const address = /[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/;
const website = /(?:https?:\/\/|www\.)[^\s<>]+/i;
const contactValue = new RegExp(
	`(?:mailto:)?${address.source}|${website.source}|${phone.source}`,
	"gi",
);
const contactLabel =
	/\b(?:direct|main|office|phone|cell|mobile|fax|tel(?:ephone)?|e-?mail|web|[cftmpoe])\b/gi;
const signatureDetail =
	/^(?:(?:[A-Z]{2} )?(?:license|lic\.|dre|bre|nmls)[ :#]+[\w-]*\d[\w-]*|(?:(?:general|regional|office|transaction|leasing|commercial|managing|associate|executive|chief|operating|vice|senior) ){0,4}(?:dentist|director|manager|broker|president|partner|associate|coordinator|officer)|(?:[\w-]+\.)+(?:com|org|net|co|io)|\d+ [\w. ]+ (?:st\.?|street|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?|blvd\.?)\.?|[\w. ]+, [A-Z]{2} \d{5}(?:-\d{4})?)$/i;
const legalFooter =
	/(?:^|(?<=[.!?])[ \t]+)this\s+(?:e-?mail|message|communication)(?:\s+and\s+(?:any|its)\s+attachments)?\s+(?:may\s+contain|contains?)\s+(?:confidential(?:\s+and\s+(?:legally\s+)?privileged)?|(?:legally\s+)?privileged(?:\s+and\s+confidential)?)\s+information\.(?=\s|$)|(?:^|(?<=[.!?])[ \t]+)if\s+you\s+(?:received\s+it\s+in\s+error|(?:have\s+)?received\s+this\s+(?:e-?mail|message)\s+in\s+error|are\s+not\s+the\s+intended\s+recipient),?\s+please\s+(?:delete\s+it|notify\s+the\s+sender(?:\s+and\s+delete\s+(?:it|this\s+message))?)\.(?=\s|$)/gim;
const deviceFooter = /^sent from my (?:iphone|ipad|android|mobile device)$/i;
const imageFooter = /^\[cid:[^\]]+\](?:\s*<https?:\/\/[^>]+>)?$/i;
const signOff =
	/^(?:best|(?:(?:best|kind|warm) )?regards|thanks(?: so much| again)?|thank you|many thanks|sincerely|cheers)[,.!]?$/i;

type MailLine = {
	text: string;
	key: string;
	quoted: boolean;
};

function mailLines(body: string) {
	return body.split(/\r\n?|\n/).map((text): MailLine => {
		const key = text.replace(quotePrefix, "").trim().replace(/\s+/g, " ");
		return { text, key, quoted: quotePrefix.test(text) };
	});
}

function historyLines(lines: MailLine[], earlier: Set<string>) {
	const history = new Set<MailLine>();
	let inReply = false;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (!line) break;
		const matches = earlier.has(line.key);
		if (matches && (line.quoted || inReply)) {
			history.add(line);
			continue;
		}
		inReply = false;

		if (!from.test(line.key)) continue;
		const header = lines.slice(index, index + replyHeader.length);
		const quotedBody = lines[index + replyHeader.length];
		if (
			header.length === replyHeader.length &&
			header.every((field, offset) => replyHeader[offset]?.test(field.key)) &&
			quotedBody &&
			earlier.has(quotedBody.key)
		) {
			for (const field of header) history.add(field);
			inReply = true;
			index += header.length - 1;
		}
	}
	return history;
}

type RecurringLine = {
	messages: number;
	preceding: Map<string, RecurringLine>;
};

function recurringLines(group: MailLine[][]) {
	const endings = new Map<string, RecurringLine>();
	for (const lines of group) {
		let preceding = endings;
		for (const line of lines.toReversed()) {
			if (line.quoted) break;
			let suffix = preceding.get(line.key);
			if (!suffix) {
				suffix = { messages: 0, preceding: new Map() };
				preceding.set(line.key, suffix);
			}
			suffix.messages++;
			preceding = suffix.preceding;
		}
	}
	return group.map((lines) => {
		let preceding = endings;
		let length = 0;
		for (const line of lines.toReversed()) {
			const suffix = preceding.get(line.key);
			if (line.quoted || !suffix || suffix.messages < 3) break;
			length++;
			preceding = suffix.preceding;
		}
		return lines.slice(lines.length - length);
	});
}

function headerStart(body: string, limit = body.length) {
	const fields = [...body.matchAll(headerField)];
	const header = fields.findIndex((field, index) => {
		if (field.index >= limit) return false;
		if (/^(?:cc|bcc)$/i.test(field[1] ?? "")) return false;
		const labels = new Set<string>();
		for (const [offset, next] of fields.slice(index, index + 7).entries()) {
			if (next.index - field.index > 3500) break;
			const raw = next[1]?.toLowerCase() ?? "";
			const label = raw === "sent" ? "date" : raw;
			if (labels.has(label)) break;
			const value = body
				.slice(next.index + next[0].length, fields[index + offset + 1]?.index)
				.trim();
			if ((label === "from" || label === "subject") && !value) break;
			labels.add(label);
			if (
				labels.has("from") &&
				labels.has("to") &&
				labels.has("subject") &&
				labels.has("date")
			)
				return true;
		}
		return false;
	});
	return fields[header]?.index ?? body.length;
}

function leadingDivider(body: string, boundary: number) {
	if (boundary >= body.length) return boundary;
	const quoted = body
		.slice(0, boundary)
		.search(/(?:^|(?<=[\r\n]))[ \t]*>[> \t]*$/);
	const start = quoted >= 0 ? quoted : boundary;
	const divider = body
		.slice(0, start)
		.search(
			/(?:(?<!_)_{8,}|(?:^|(?<=[\r\n]))[ \t]*[-_=*]{3,}[ \t]*[\r\n])\s*$/,
		);
	return divider >= 0 ? divider : start;
}

function historyStart(body: string) {
	const start = Math.min(
		body.length,
		...[body.search(replyOpener), body.search(forwarded)].filter(
			(at) => at >= 0,
		),
	);
	return leadingDivider(body, Math.min(headerStart(body, start), start));
}

function splitStoredAuthored(authored: string, history: string) {
	const start = leadingDivider(authored, headerStart(authored));
	if (start >= authored.length) {
		return { body: authored, folded: history || null };
	}
	const moved = authored.slice(start).trim();
	const stored = history.trim();
	return {
		body: authored.slice(0, start).trimEnd(),
		folded: stored ? `${moved}\n\n${stored}` : moved,
	};
}

function contactDetails(line: string) {
	const residue = line.replace(contactValue, "");
	return (
		residue !== line &&
		residue
			.split("|")
			.every(
				(part) =>
					/^[\s<>()[\]:+./-]*$/.test(
						part
							.replace(contactLabel, "")
							.replace(/\b(?:ext\.?|x) *\d+\b/gi, ""),
					) || signatureDetail.test(part.trim()),
			)
	);
}

type TextRange = { start: number; end: number };
type PositionedLine = TextRange & { line: MailLine; text: string };

function inlineSignature(line: string, name: string) {
	if (!name) return;
	const at = line.toLowerCase().lastIndexOf(name);
	if (at < 0 || (at > 0 && !/\s/.test(line.charAt(at - 1)))) return;
	if (line.length - at > 500) return;
	const before = line.slice(0, at);
	const sign = before.match(/(?:^|(?<=[.!?])\s+)([\w ]+[,.!]?)\s+$/);
	const start =
		sign?.[1] && signOff.test(sign[1].trim())
			? (sign.index ?? 0) + sign[0].length - sign[0].trimStart().length
			: at;
	if (start === at && before.trim() && !/[.!?]\s+$/.test(before)) return;
	const details = line.slice(at + name.length).replace(/^\s*\|?\s*/, "");
	const detailStart = line.length - details.length;
	for (const { index } of details.matchAll(/\.(?=\s|$)|$/g)) {
		const end = Math.min(line.length, detailStart + index + 1);
		if (contactDetails(line.slice(detailStart, end))) return { start, end };
	}
}

function footerRanges(body: string, name: string) {
	const ranges = Array.from(body.matchAll(legalFooter), (match) => ({
		start: match.index,
		end: match.index + match[0].length,
	}));
	let start = 0;
	let hasContact = false;
	let hasName = false;
	let offset = 0;
	for (const raw of body.split("\n")) {
		const line = raw.trim();
		const lower = line.toLowerCase();
		const named = !!name && (lower === name || lower === name.split(" ", 1)[0]);
		const contact = line.length <= 500 && contactDetails(line);
		if (contact || named || signOff.test(line) || signatureDetail.test(line)) {
			hasContact ||= contact;
			hasName ||= named;
		} else {
			if (hasContact && hasName) ranges.push({ start, end: offset - 1 });
			const inline = inlineSignature(raw, name);
			if (inline)
				ranges.push({ start: offset + inline.start, end: offset + inline.end });
			if (deviceFooter.test(line) || imageFooter.test(line)) {
				ranges.push({ start: offset, end: offset + raw.length });
			}
			start = offset + raw.length + 1;
			hasContact = false;
			hasName = false;
		}
		offset += raw.length + 1;
	}
	if (hasContact && hasName) ranges.push({ start, end: body.length });
	return ranges;
}

function foldEmailBody(
	original: string,
	lines: MailLine[],
	removed: Set<MailLine>,
	recurring: Set<MailLine>,
	{ sender_name }: Sender,
) {
	let offset = 0;
	const positioned = lines.map((line): PositionedLine => {
		const text = removed.has(line) ? "" : line.text;
		const start = offset;
		offset += text.length + 1;
		return { line, text, start, end: offset - 1 };
	});
	const body = positioned.map(({ text }) => text).join("\n");
	if (!body.trim()) return { body: original, folded: null };

	const end = positioned.find(({ line }) => line.quoted)?.start ?? body.length;
	const start = historyStart(body.slice(0, end));
	const name = sender_name?.trim().toLowerCase() ?? "";
	const folds = footerRanges(body.slice(0, start), name);
	if (end < body.length) {
		for (const range of footerRanges(body.slice(end), name)) {
			folds.push({ start: end + range.start, end: end + range.end });
		}
	}
	if (start < end) folds.push({ start, end });

	for (const [index, position] of positioned.entries()) {
		const { line, start, end } = position;
		if (start === end) continue;
		if (recurring.has(line)) {
			folds.push({ start, end });
		} else if (line.quoted) {
			const inRun =
				positioned[index - 1]?.line.quoted ||
				positioned[index + 1]?.line.quoted;
			if (inRun || followsReply(body, start)) folds.push({ start, end });
		}
	}

	return partitionBody(original, positioned, folds, removed);
}

function followsReply(body: string, quoteStart: number) {
	const before = body
		.slice(Math.max(0, quoteStart - 3500), quoteStart)
		.trimEnd();
	if (replyOpenerEnd.test(before)) return true;
	const lastLine = before.split("\n").at(-1) ?? "";
	return (
		/(?:^|\s)\*?Subject:\*?\s*\S/i.test(lastLine) &&
		headerStart(before) < before.length
	);
}

function partitionBody(
	original: string,
	lines: PositionedLine[],
	folds: TextRange[],
	removed: Set<MailLine>,
) {
	if (!folds.length && !removed.size) return { body: original, folded: null };
	folds.sort((a, b) => a.start - b.start);
	const visible: string[] = [];
	const folded: string[] = [];
	let range = 0;
	for (const { line, text, start, end } of lines) {
		if (removed.has(line)) continue;
		let at = start;
		const shown: string[] = [];
		const hidden: string[] = [];
		while (at < end) {
			const fold = folds[range];
			if (!fold || fold.start >= end) break;
			if (fold.end <= at) {
				range++;
				continue;
			}
			if (at < fold.start)
				shown.push(text.slice(at - start, fold.start - start));
			hidden.push(
				text.slice(Math.max(at, fold.start) - start, fold.end - start),
			);
			at = Math.min(end, fold.end);
		}
		shown.push(text.slice(at - start));
		if (shown.some((part) => part.trim()) || !text.trim()) {
			visible.push(
				shown.length > 1
					? shown
							.map((part) => part.trim())
							.filter(Boolean)
							.join(" ")
					: shown.join(""),
			);
		}
		if (hidden.length || !text.trim()) folded.push(hidden.join(" "));
	}
	const join = (parts: string[]) =>
		parts
			.join("\n")
			.trim()
			.replace(/\n(?:[ \t]*\n){2,}/g, "\n\n");
	const shown = join(visible);
	const hidden = join(folded);
	if (shown) return { body: shown, folded: hidden || null };
	return { body: removed.size ? hidden : original, folded: null };
}

export function cleanEmailThread(
	messages: (Sender & {
		body: string;
		authored?: string | null;
		history?: string | null;
	})[],
) {
	const earlier = new Set<string>();
	const senders = new Map<string, MailLine[][]>();
	const cleaned = messages.map(
		({ body, authored = null, history = null, sender, sender_name }) => {
			const lines = mailLines(body);
			const content = lines.filter(({ text }) => text.trim());
			const removed = historyLines(content, earlier);
			for (const { key } of content) {
				if (key) earlier.add(key);
			}

			const address = sender.trim().toLowerCase();
			if (address) {
				const own = content.filter((line) => !removed.has(line));
				const group = senders.get(address);
				if (group) group.push(own);
				else senders.set(address, [own]);
			}
			return {
				body,
				authored,
				history,
				lines,
				content,
				removed,
				sender_name,
				sender,
			};
		},
	);

	const recurring = new Set<MailLine>();
	for (const group of senders.values()) {
		if (group.length < 3) continue;
		for (const lines of recurringLines(group)) {
			for (const line of lines) recurring.add(line);
		}
	}

	return cleaned.map((message) => {
		if (message.authored !== null) {
			return splitStoredAuthored(message.authored, message.history ?? "");
		}
		const { body, lines, content, removed } = message;
		let inInvite = false;
		for (const line of content) {
			const { key } = line;
			inInvite =
				inviteHeading.test(key) ||
				teamsJoin.test(key) ||
				zoomJoin.test(key) ||
				(inInvite && inviteDetail.test(key));
			if (inInvite) removed.add(line);
		}
		return foldEmailBody(body, lines, removed, recurring, message);
	});
}

function messageMatchKey(row: ThreadRow) {
	const normalized = row.body
		.replace(/\p{White_Space}+/gu, " ")
		.replace(/^ | $/g, "");
	if (!normalized) return null;
	return JSON.stringify([
		row.sender.toLowerCase(),
		row.exact_happened_at,
		row.subject,
		createHash("sha256").update(normalized).digest("hex"),
	]);
}

function groupThreadRows(rows: ThreadRow[], sourceId: string) {
	const uniqueIdsByMatch = new Map<string, string | null>();
	const matchedRows = rows.map((row) => {
		const match = messageMatchKey(row);
		const { message_id: id } = row;
		if (match !== null && id !== null) {
			const known = uniqueIdsByMatch.get(match);
			uniqueIdsByMatch.set(
				match,
				known === undefined || known === id ? id : null,
			);
		}
		return { row, match };
	});
	const groups = new Map<string, { display: ThreadRow; order: number }>();
	let sourceKey: string | undefined;
	for (const [order, { row, match }] of matchedRows.entries()) {
		const id = row.message_id ?? (match ? uniqueIdsByMatch.get(match) : null);
		const key = id
			? `id:${id}`
			: match
				? `match:${match}`
				: `activity:${row.activity_id}`;
		if (row.activity_id === sourceId) sourceKey = key;
		const group = groups.get(key);
		if (!group) {
			groups.set(key, { display: row, order });
			continue;
		}

		const hasSplit = row.authored !== null;
		const displayHasSplit = group.display.authored !== null;
		if (
			(hasSplit && !displayHasSplit) ||
			(hasSplit === displayHasSplit &&
				row.activity_id < group.display.activity_id)
		) {
			group.display = row;
			group.order = order;
		}
	}
	return {
		groups: [...groups.values()].sort((a, b) => a.order - b.order),
		source:
			sourceKey === undefined ? undefined : groups.get(sourceKey)?.display,
	};
}

export async function readHomeEmailThread(
	db: Transaction<DB>,
	userId: string,
	sourceId: string,
) {
	const { rows } = await sql<ThreadRow>`
		select e.activity_id, e.sender, ${senderLabel("e", false)} as sender_name, a.summary,
			${isoMillis(sql.ref("a.happened_at"))} as happened_at,
			a.happened_at::text as exact_happened_at, e.message_id, e.subject, e.body, e.authored, e.history
		from email source
		join email_mailbox source_mailbox on source_mailbox.activity_id = source.activity_id
			and source_mailbox.user_id = ${userId}::uuid
		join email e on e.activity_id = source.activity_id or e.conversation_id = source.conversation_id
		join email_mailbox m on m.activity_id = e.activity_id and m.user_id = source_mailbox.user_id
		join activity a on a.id = e.activity_id
		where source.activity_id = ${sourceId}::uuid
		order by a.happened_at, a.id
	`.execute(db);
	const { groups, source } = groupThreadRows(rows, sourceId);
	const bodies = cleanEmailThread(groups.map(({ display }) => display));
	const thread = groups.map(({ display }, index) => {
		const { activity_id, sender_name, happened_at } = display;
		const cleaned = bodies[index];
		return {
			activity_id,
			sender_name,
			happened_at,
			body: cleaned?.body ?? display.body,
			folded: cleaned?.folded ?? null,
		};
	});
	const sourceActivity = source && {
		id: source.activity_id,
		kind: "email",
		sender: source.sender,
		sender_name: source.sender_name,
		subject: source.subject,
		body: source.body,
		happened_at: source.happened_at,
	};
	return { thread, sourceActivity, sourceSummary: source?.summary ?? null };
}
