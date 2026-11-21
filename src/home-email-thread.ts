import { type Expression, sql, type Transaction } from "kysely";
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
) {
	return sql<boolean>`coalesce((select bool_or(user_id = ${userId}::uuid)
		from email_mailbox where activity_id = ${source}), true)`;
}

export const mailGroup = sql<
	string | null
>`coalesce('conversation:' || e.conversation_id, 'email:' || e.activity_id)`;

// A job suggests filing on each message of a conversation; every screen shows that decision once, as its newest pending suggestion.
export function decisionPosition(
	proposal: string,
	source: Expression<string | null>,
) {
	const column = (name: string) => sql.ref(`${proposal}.${name}`);
	return sql<number>`row_number() over (
		partition by ${source}, case when ${column("kind")} in ('file_to_deal', 'possible_new_deal')
			then ${column("kind")} || ':' || coalesce(${column("deal_id")}::text, '') else ${column("id")}::text end
		order by (${column("status")} = 'pending') desc, ${column("created_at")} desc, ${column("id")})`;
}

const historyMarker =
	/(?<!-)-{2,} *(?:original|forwarded) message *-{2,}|\bbegin forwarded message:(?=[ \t]*(?:\n|\*?from:|$))/i;
const underscoreDivider = /(?<!_)_{8,120}(?!_)|^[ \t]*_{8,}[ \t]*$/m;
const strayFrom =
	/^[ \t]*\*?[Ff][Rr][Oo][Mm]:\*?[ \t]*\p{Lu}[\p{L}’'-]*[ \t]*$/u;
const ruleLine = /^[-_=*]{3,}$/;
const signOffWords = `(?:best|regards|(?:best|kind|warm) regards|thanks(?: so much| again)?|thank you|many thanks|sincerely|cheers)[,.!]?`;
const signOff = new RegExp(`^${signOffWords}$`, "i");
const trailingSignOff = new RegExp(
	String.raw`(?<=^|\s)${signOffWords}\s+$`,
	"i",
);
const deviceFooter = /^sent from my [\w-]+(?: [\w-]+){0,3}$/i;
// Names, titles, companies, phones, emails and links start each word with a capital, digit or symbol.
const contactWord = /^(?:[^a-z]|[a-z]:$|(?:of|and|at|for|in|the)$)|@|:\/\//;
const senderBanner =
	/You don['’]t often get email from \S+? Learn why this is important(?:\s*<[^>\s]*>)?\.?\s*/g;

function withoutSignature(
	body: string,
	senderName: string | null,
	senderAddress: string,
) {
	const own = body.split("\n");
	const signed = own.slice(0, footerStart(own));
	const unsigned = text(signed.slice(0, signatureStart(signed, senderName)));
	return (
		unsigned
			.slice(0, inlineSignatureStart(unsigned, senderName, senderAddress))
			.trim() ||
		text(signed) ||
		body
	);
}

function text(lines: string[]) {
	const end = lines.findLastIndex(
		(line) => line.trim() && !ruleLine.test(line.trim()),
	);
	return lines
		.slice(0, end + 1)
		.join("\n")
		.trim();
}

function footerStart(lines: string[]) {
	const last = lines.findLastIndex((line) => line.trim());
	return deviceFooter.test(lines[last]?.trim() ?? "") ? last : lines.length;
}

const contactLine = (line: string) =>
	line
		.split(/\s*\|\s*/)
		.every(
			(part) =>
				part.length <= 250 &&
				(part.split(/\s+/).every((word) => !word || contactWord.test(word)) ||
					titleLine.test(part) ||
					phoneLine.test(part) ||
					licenseLine.test(part)),
		);

// A signature is a trailing sign-off, then the sender's name, then only contact lines.
function signatureStart(lines: string[], sender: string | null) {
	const name = sender?.trim().toLowerCase() ?? "";
	const first = name.split(/\s+/, 1)[0];
	const isName = (line: string) => {
		const lower = line.toLowerCase();
		const suffix = lower.slice(name.length);
		return (
			!!name &&
			(lower === first ||
				(lower.startsWith(name) && /^(?:[ ,|]|$)/.test(suffix)))
		);
	};
	const signature = (block: string[]) =>
		isName(block[0] ?? "") && block.every(contactLine);
	const tail = lines
		.flatMap((line, index) =>
			line.trim() ? [{ index, line: line.trim() }] : [],
		)
		.slice(-10);
	const start = tail.findIndex(({ line }, position) => {
		const after = tail.slice(position + 1).map((rest) => rest.line);
		return signOff.test(line)
			? !after.length || signature(after)
			: after.length > 0 && signature([line, ...after]);
	});
	return tail[start]?.index ?? lines.length;
}

// A one-line body ends "... works. Best, Maya Example Office Manager | Direct: 555-010-2000".
function inlineSignatureStart(
	text: string,
	senderName: string | null,
	senderAddress: string,
) {
	const first = senderName?.split(/\s+/, 1)[0];
	if (!first) return text.length;
	const start = Math.max(0, text.length - 1600);
	const tail = text.slice(start);
	const words = [...tail.matchAll(/\S+/g)];
	for (const { 0: word, index } of words) {
		if (word.split(/[.,|]/, 1)[0]?.toLowerCase() !== first) continue;
		const at = tail.slice(0, index).search(trailingSignOff);
		// A capital separates "Thanks, Maya" from "I want to say thanks, Maya".
		if (
			at > 0 &&
			/[A-Z]/.test(tail[at] ?? "") &&
			tail.slice(index).split("\n").every(contactLine)
		)
			return start + at;
		if (!senderName || !tail.slice(index).toLowerCase().startsWith(senderName))
			continue;
		const details = tail.slice(index + senderName.length);
		const credential = /^[, ]+(?:DMD|DDS)(?=\b|[A-Z])/.test(details);
		const ownAddress =
			senderAddress &&
			details
				.toLowerCase()
				.split(/[\s,;<>|]+/)
				.includes(senderAddress);
		if (
			(credential || ownAddress) &&
			/^[,|\s]/.test(details) &&
			/(?:[.!?]|\n)\s*$/.test(tail.slice(0, index)) &&
			details.trim().split("\n").every(contactLine)
		)
			return start + index;
	}
	return text.length;
}

type ThreadMessage = {
	activity_id: string;
	sender: string;
	sender_name: string | null;
	happened_at: string;
	body: string;
};

const minimumSignatureLength = 25;
const quoteHeaderField =
	/(?<!\S)\*?(from|sent|date|to|cc|bcc|subject):\*?(?=\s)/gi;
const month = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?";
const weekday = "(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\\.?,?\\s+)?";
const day = String.raw`(?:\d{1,4}[./-]\d{1,2}(?:[./-]\d{1,4})?|(?:\d{1,2}\s+${month}|${month}\s+\d{1,2})(?:,?\s+\d{4})?)`;
const datePrefix = new RegExp(`^${weekday}${day}(?=\\W|$)`, "i");
const quoteDate = new RegExp(
	String.raw`(?<!\S)On\s+${weekday}${day}(?=\W)`,
	"gi",
);
const quoteTime =
	/^[, \t\n]+(?:at\s+)?\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?m\.?)?(?:\s+(?:GMT|UTC)(?:[+-]\d{1,4})?)?/i;
const wrote = /\bwrote:/i;
const quoteDivider = /(?<![-_=*])[-_=*]{3,}$/;
const addressDomain = /@[\w-]+(?:\.[\w-]+)+/;
const address = String.raw`[^<>\s,;]+${addressDomain.source}`;
const mailboxAddress = new RegExp(
	`^(?:${address}|[^<>]*<\\s*${address}\\s*>)$`,
);
const nameWord = /^(?:\p{Lu}[\p{L}'’.-]*[\p{L}]|\p{Lu}\.?)$/u;
const nameConnector = /^(?:de|del|van|von|da|dos)$/i;
const quoteIndent = /^[ \t]*(?:>[ \t]*)+/gm;
const trailingQuoteIndent = /(?:^|[\r\n])[ \t]*(?:>[ \t]*)+$/;

function comparableBody(body: string) {
	const words = /(^[ \t]*(?:>[ \t]*)+)|\S+/gm;
	const offsets: number[] = [];
	let normalized = "";
	for (let match = words.exec(body); match; match = words.exec(body)) {
		if (match[1]) continue;
		if (normalized) normalized += " ";
		offsets[normalized.length] = match.index;
		normalized += match[0].toLowerCase();
	}
	return { body, normalized, offsets };
}

function headerValue(label: string, value: string) {
	if (!value) return false;
	if (label === "subject") return !/[\r\n]/.test(value);
	if (label === "sent" || label === "date")
		return /^(?:yesterday|today)$/i.test(value) || datePrefix.test(value);
	return (
		mailboxAddress.test(value) ||
		value.split(/\s+on behalf of\s+|[;,](?![^<>]*>)/i).every((mailbox) => {
			const [first, ...rest] = mailbox.trim().split(/\s+/);
			return (
				mailboxAddress.test(mailbox.trim()) ||
				(first !== undefined &&
					nameWord.test(first) &&
					rest.every((word) => nameWord.test(word) || nameConnector.test(word)))
			);
		})
	);
}

function openerStart(body: string) {
	if (!wrote.test(body)) return -1;
	for (const date of body.matchAll(quoteDate)) {
		const from = date.index + date[0].length;
		const tail = body.slice(from, from + 380);
		const marker = tail.search(wrote);
		if (marker < 0) continue;
		const mailbox = tail
			.slice(0, marker)
			.replace(quoteTime, "")
			.trim()
			.replace(/^,\s*/, "");
		if (
			!mailbox.match(quoteDate) &&
			!/(?:\p{L}{4}\.|[!?])\s+[\p{Lu}][\p{Ll}]/u.test(mailbox) &&
			headerValue("from", mailbox)
		)
			return date.index;
	}
	return -1;
}

function historyStart(body: string) {
	// Quote indents count as whitespace without changing the source offsets.
	const unquoted = body.replace(quoteIndent, (indent) =>
		" ".repeat(indent.length),
	);
	const rule = unquoted.search(underscoreDivider);
	const join = unquoted.search(joinBlock);
	const marker = unquoted.search(historyMarker);
	const opener = openerStart(unquoted);
	const limit = Math.min(
		marker < 0 ? body.length : marker,
		opener < 0 ? body.length : opener,
		rule < 0 || join >= 0 ? body.length : rule,
	);
	const fields = [...unquoted.slice(0, limit).matchAll(quoteHeaderField)];
	const labels = new Set<string>();
	let start = 0;
	let end = 0;
	for (const [index, field] of fields.entries()) {
		const label = field[1]?.toLowerCase() ?? "";
		const valueStart = field.index + field[0].length;
		const next = fields[index + 1]?.index ?? limit;
		const nearby = unquoted.slice(valueStart, Math.min(valueStart + 600, next));
		const value = nearby.match(/^[^\n]*(?:\n[ \t]*<[^<>\n]+>)?/)?.[0] ?? "";
		const valid =
			(label === "subject" ||
				label === "date" ||
				label === "sent" ||
				nearby.length === next - valueStart ||
				value.length < nearby.length) &&
			headerValue(label, value.trim());
		if (
			!valid ||
			labels.has(label) ||
			(labels.size && unquoted.slice(end, field.index).trim())
		)
			labels.clear();
		if (!valid) continue;
		if (!labels.size) start = field.index;
		labels.add(label);
		end = valueStart + value.length;
		if (labels.size >= 2) {
			const divider = unquoted.slice(0, start).trimEnd().search(quoteDivider);
			return divider < 0 ? start : divider;
		}
	}
	return limit;
}

function withoutHistory(body: string) {
	const normalized = body
		.replace(/\u00a0/g, " ")
		.replace(/\r\n?/g, "\n")
		.replace(senderBanner, "");
	const current = normalized
		.slice(0, historyStart(normalized))
		.replace(trailingQuoteIndent, "");
	const lines = current.split("\n").filter((line) => !strayFrom.test(line));
	return text(lines) || body;
}

type ComparableBody = ReturnType<typeof comparableBody> & {
	senderName: string | null;
	senderAddress: string;
};

const phone = /(?:\(\d{3}\)|\b\d{3})[ .-]*\d{3}[ .-]*\d{4}\b/;
const phoneLine =
	/^(?:(?:direct|main|office|phone|cell|mobile|fax|tel(?:ephone)?|[cftmpo])\s*:\s*)?(?:\+?1[ .-]*)?(?:\(\d{3}\)|\d{3})[ .-]*\d{3}[ .-]*\d{4}(?:\s*(?:ext\.?|x)\s*\d+)?$/i;
const licenseLine =
	/^(?:[A-Z]{2} )?(?:(?:RE |DRE |BRE |NMLS )?(?:license|lic\.)|DRE|BRE|NMLS)[ :#]+[A-Z\d-]*\d[A-Z\d-]*$/i;
const website = /\b(?:https?:\/\/|www\.)\S+/i;
const contactLabel = /(?:direct|cell|fax):/i;
const inlineContact = new RegExp(
	String.raw`(?:^|(?<=[\r\n|]))[ \t]*(?=(?:(?:${contactLabel.source}[ \t]*)?${phone.source}|${website.source}|<?[^<>\s,;|]{1,64}${addressDomain.source}>?)[ \t]*(?:$|[\r\n|]))`,
	"i",
);
const titleLine =
	/(?:^|(?<=[\r\n|]))[ \t]*(?:(?:senior|junior|general|regional|office|transaction|leasing|commercial|managing|associate|executive|chief|operating|vice)[ \t]+){0,5}(?:dentist|director|manager|broker|president|partner|associate|coordinator|officer)[ \t]*(?=$|[\r\n|])/i;

function sharedFooterStart(block: string, senderName: string | null) {
	const contact = inlineContact.exec(block);
	const title = titleLine.exec(block);
	const titleStart = title
		? title.index + title[0].length - title[0].trimStart().length
		: block.length;
	const contactStart = contact
		? contact.index + contact[0].length
		: block.length;
	const footer = Math.min(titleStart, contactStart);
	const name = senderName?.split(/\s+/).map(RegExp.escape).join("[ \\t]+");
	const signOffLine = String.raw`${signOffWords}(?=[ \t]*(?:[\r\n]|$))`;
	const sender = name
		? String.raw`|${name}(?=[ \t]*(?:[,|\r\n]|$))|${signOffWords}[ \t]+${name}(?=[\s,.|]|$)`
		: "";
	const opening = new RegExp(
		String.raw`(?:^|[\r\n]|[.!?][ \t]+)[ \t]*(?=${signOffLine}${sender})`,
		"i",
	).exec(block.slice(0, footer));
	const start = opening ? opening.index + opening[0].length : footer;
	return block.slice(start).split("\n").every(contactLine) ? start : footer;
}

function sharedSignatureLength(messages: ComparableBody[]) {
	const [first, ...rest] = messages;
	if (!first || !rest.length) return 0;
	let length = first.normalized.length;
	for (const { normalized } of rest) {
		let shared = 0;
		while (
			shared < length &&
			shared < normalized.length &&
			first.normalized.at(-shared - 1) === normalized.at(-shared - 1)
		)
			shared++;
		length = shared;
	}
	if (length < minimumSignatureLength) return 0;
	if (
		messages.some(
			({ normalized, offsets }) =>
				offsets[normalized.length - length] === undefined,
		)
	) {
		const space = first.normalized.indexOf(
			" ",
			first.normalized.length - length,
		);
		length = space < 0 ? 0 : first.normalized.length - space - 1;
	}
	if (length < minimumSignatureLength) return 0;

	let signature = 0;
	for (const { body, normalized, offsets, senderName } of messages) {
		const start = normalized.length - length;
		const at = offsets[start];
		if (at === undefined) continue;
		const block = body.slice(at);
		const boundary = sharedFooterStart(block, senderName);
		if (
			!boundary &&
			inlineContact.exec(block)?.index === 0 &&
			!/(?:\n|[.!?|])\s*$/.test(body.slice(0, at))
		)
			continue;
		const footer = at + boundary;
		if (footer === body.length) continue;
		const position = offsets.indexOf(footer, start);
		if (position >= 0)
			signature = Math.max(signature, normalized.length - position);
	}
	return signature;
}

const joinBlock =
	/(?<!\S)(?:Microsoft Teams meeting\b(?=\s+(?:Join|Meeting ID:|Dial in))|Teams Meeting\s+Dial in by phone\b|Join (?:the meeting now|(?:with )?Google Meet|Zoom Meeting|Microsoft Teams Meeting|on your computer)\b:?(?=\s*(?:https?:\/\/|<|Meeting ID:|Dial in))|Google (?:Calendar invitation|Meet joining info)\b)/i;

function withoutJoinBlock(body: string) {
	const join = joinBlock.exec(body);
	if (!join) return body;
	const before = body
		.slice(0, join.index)
		.trimEnd()
		.replace(quoteDivider, "")
		.trimEnd();
	if (!before) return body;
	const tail = body.slice(join.index + join[0].length);
	const end = /\n[ \t]*_{8,}[ \t]*(?=\n)|(?=\n[ \t]*P\.?S\.[ \t])/i.exec(tail);
	const after = end ? tail.slice(end.index + end[0].length).trim() : "";
	return after ? `${before}\n\n${after}` : before;
}

export function cleanEmailBody(body: string, sender: string | null) {
	return (
		cleanEmailThread([{ body, sender: "", sender_name: sender }])[0] ?? body
	);
}

export function cleanEmailThread(
	messages: Pick<ThreadMessage, "body" | "sender" | "sender_name">[],
) {
	const senders = new Map<string, ComparableBody[]>();
	const own = messages.map(({ body, sender, sender_name }) => {
		const address = sender.toLowerCase();
		const message = {
			...comparableBody(withoutHistory(body)),
			senderName: sender_name?.trim().toLowerCase() || null,
			senderAddress: address,
		};
		const group = senders.get(address);
		if (group) group.push(message);
		else senders.set(address, [message]);
		return message;
	});
	for (const group of senders.values()) {
		const length = sharedSignatureLength(group);
		if (!length) continue;
		for (const message of group) {
			const offset = message.offsets[message.normalized.length - length];
			message.body = message.body.slice(0, offset).trimEnd() || message.body;
		}
	}
	return own.map(({ body, senderName, senderAddress }) =>
		withoutJoinBlock(withoutSignature(body, senderName, senderAddress)),
	);
}

export async function readHomeEmailThread(
	db: Transaction<DB>,
	userId: string,
	sourceId: string | null,
) {
	if (!sourceId) return [];
	const { rows } = await sql<ThreadMessage>`
		select e.activity_id, e.sender, ${senderLabel("e", false)} as sender_name,
			${isoMillis(sql.ref("a.happened_at"))} as happened_at, e.body
		from email source
		join email_mailbox source_mailbox on source_mailbox.activity_id = source.activity_id
			and source_mailbox.user_id = ${userId}::uuid
		join email e on e.activity_id = source.activity_id or e.conversation_id = source.conversation_id
		join email_mailbox m on m.activity_id = e.activity_id and m.user_id = source_mailbox.user_id
		join activity a on a.id = e.activity_id
		where source.activity_id = ${sourceId}::uuid
		order by a.happened_at, a.id
	`.execute(db);
	const bodies = cleanEmailThread(rows);
	return rows.map(({ sender: _sender, ...message }, index) => ({
		...message,
		body: bodies[index] ?? message.body,
	}));
}
