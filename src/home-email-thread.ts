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
	/^(?:-+ *(?:original|forwarded) message *-+|begin forwarded message:)$/i;
const headerField = /^\*?(from|to|cc|bcc|sent|date|subject):\*?(.*)$/i;
// People write "Date:" in their own words, so only a header block owns it.
const strayHeader = new Set(["from", "to", "cc", "bcc", "sent", "subject"]);
const ruleLine = /^[-_=*]{3,}$/;
const signOffWords = `(?:best|regards|(?:best|kind|warm) regards|thanks(?: so much| again)?|thank you|many thanks|sincerely|cheers)[,.!]?`;
const signOff = new RegExp(`^${signOffWords}$`, "i");
const trailingSignOff = new RegExp(
	String.raw`(?<=^|\s)${signOffWords}\s+$`,
	"i",
);
const deviceFooter = /^sent from my [\w-]+(?: [\w-]+){0,3}$/i;
const sentence = /[.!?]$|\b[a-z]+ [a-z]+\b/;
// Names, titles, companies, phones, emails and links start each word with a capital, digit or symbol.
const contactWord = /^(?:[^a-z]|[a-z]:$|(?:of|and|at|for|in|the)$)|@|:\/\//;
// Stored mail often has no line breaks, so quoted history must be found mid-line too.
const inlineHistory = new RegExp(
	[
		"(?<!-)-{2,80} ?(?:Original|Forwarded) [Mm]essage ?-{2,80}(?!-)",
		// A repeated From or Sent starts a new candidate, so incomplete headers cannot overlap.
		String.raw`(?:(?<![-_=*])[-_=*]{3,80}[ \t]{0,80})?\*?From:\*? ` +
			String.raw`(?:(?! \*?(?:From|Sent):)[^\r\n]){1,300} \*?Sent:\*? ` +
			String.raw`(?:(?! \*?(?:From|Sent|Subject):)[^\r\n\d]){0,40}\d` +
			String.raw`(?:(?! \*?(?:From|Sent|Subject):)[^\r\n]){0,2000} \*?Subject:`,
		String.raw`(?<=^|\s)On (?:(?![.!?]\s)[^\r\n\d]){0,300}\d(?:(?![.!?]\s| wrote:)[^\r\n]){0,300} wrote:`,
	].join("|"),
);
const senderBanner =
	/You don['’]t often get email from \S+? Learn why this is important(?:\s*<[^>\s]*>)?\.?\s*/g;

export function cleanEmailBody(body: string, sender: string | null) {
	const lines = body.replace(/\u00a0/g, " ").split(/\r\n?|\n/);
	const current = lines.join("\n").replace(senderBanner, "");
	const cut = current.search(inlineHistory);
	const recent = (cut < 0 ? current : current.slice(0, cut)).split("\n");
	const own = recent
		.slice(0, historyStart(recent))
		.filter((line) => !/^\s*>/.test(line) && !strayHeader.has(field(line)));
	const signed = own.slice(0, footerStart(own));
	const unsigned = text(signed.slice(0, signatureStart(signed, sender)));
	// A message that is only a sign-off, a signature or quoted mail keeps its text.
	return (
		unsigned.slice(0, inlineSignatureStart(unsigned, sender)).trim() ||
		text(signed) ||
		text(lines) ||
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

function field(line: string) {
	const [, label = "", value = ""] = headerField.exec(line.trim()) ?? [];
	return sentence.test(value) ? "" : label.toLowerCase();
}

function historyStart(lines: string[]) {
	let from = -1;
	for (const [index, line] of lines.entries()) {
		if (historyMarker.test(line.trim()) || quoteOpener(lines, index))
			return index;
		const label = field(line);
		if (label === "from") from = index;
		else if (from < 0 || !line.trim()) continue;
		else if (label === "sent" || label === "date") return from;
		else if (!/^[ \t]|^\*?[a-z][a-z0-9-]*:/i.test(line)) from = -1;
	}
	return lines.length;
}

// Mail clients wrap a long "On <date>, <name> <address> wrote:" over lines.
function quoteOpener(lines: string[], index: number) {
	if (!/^on\s/i.test(lines[index]?.trim() ?? "")) return false;
	let opener = "";
	for (const line of lines.slice(index, index + 3)) {
		opener = `${opener} ${line.trim()}`;
		if (opener.length > 400 || !line.trim()) return false;
		if (/\bwrote:$/i.test(opener)) return /\d/.test(opener);
		if (/[.!?]$/.test(opener)) return false;
	}
	return false;
}

function footerStart(lines: string[]) {
	const last = lines.findLastIndex((line) => line.trim());
	return deviceFooter.test(lines[last]?.trim() ?? "") ? last : lines.length;
}

const contactLine = (line: string) =>
	line.length <= 80 &&
	line.split(/\s+/).every((word) => contactWord.test(word));

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
function inlineSignatureStart(text: string, sender: string | null) {
	const first = sender?.trim().split(/\s+/, 1)[0]?.toLowerCase();
	const words = [...text.matchAll(/\S+/g)];
	const contact = words.findLastIndex(([word]) => !contactWord.test(word)) + 1;
	for (const { 0: word, index } of words.slice(contact)) {
		if (word.replace(/[.,|]$/, "").toLowerCase() !== first) continue;
		const at = text.slice(0, index).search(trailingSignOff);
		// A capital separates "Thanks, Maya" from "I want to say thanks, Maya".
		if (at >= 0 && /[A-Z]/.test(text[at] ?? "")) return at;
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

const quoteWindowLength = 40;
const minimumSignatureLength = 25;
const quoteHeaderField =
	/(?<!\S)\*?(from|sent|date|to|cc|bcc|subject):\*?(?=\s)/gi;
const replyOpener =
	/(?<!\S)On\s+(?:(?![.!?]\s)[^\d]){0,300}\d(?:(?![.!?]\s| wrote:)[\s\S]){0,300}\s+wrote:$/i;
const quoteDivider =
	/(?<!\S)(?:[-_=*]{3,}|-+ *(?:original|forwarded) message *-+|begin forwarded message:)$/i;
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
	const starts: number[] = [];
	const offsets: number[] = [];
	let normalized = "";
	for (let match = words.exec(body); match; match = words.exec(body)) {
		if (match[1]) continue;
		if (normalized) normalized += " ";
		starts.push(normalized.length);
		offsets[normalized.length] = match.index;
		normalized += match[0].toLowerCase();
	}
	return { body, normalized, starts, offsets };
}

function headerValue(label: string, value: string) {
	if (!value) return false;
	if (label === "subject") return !/[\r\n]/.test(value);
	if (label === "sent" || label === "date")
		return /\d/.test(value) && Number.isFinite(Date.parse(value));
	return (
		mailboxAddress.test(value) ||
		value.split(/[;,]/).every((mailbox) => {
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

function quoteBoundary(prefix: string) {
	const end = prefix
		.trimEnd()
		.replace(trailingQuoteIndent, "")
		.trimEnd().length;
	const start = Math.max(0, end - 2100);
	const raw = prefix.slice(start, end);
	// Keep the match offsets valid in the original body.
	const tail = raw.replace(quoteIndent, (indent) => " ".repeat(indent.length));
	const boundaryAt = (offset: number) =>
		start + raw.slice(0, offset).replace(trailingQuoteIndent, "").length;
	const opener = /wrote:$/i.test(tail) ? tail.search(replyOpener) : -1;
	if (opener >= 0) return boundaryAt(opener);

	const labels = new Set<string>();
	let header = tail.length;
	for (const field of [...tail.matchAll(quoteHeaderField)].reverse()) {
		const label = field[1]?.toLowerCase() ?? "";
		const value = tail.slice(field.index + field[0].length, header).trim();
		if (
			header - field.index > 300 ||
			labels.has(label) ||
			!headerValue(label, value)
		)
			break;
		labels.add(label);
		header = field.index;
	}
	const beforeHeader = labels.size >= 2 ? header : tail.length;
	const divider = tail.slice(0, beforeHeader).trimEnd().search(quoteDivider);
	if (divider >= 0) return boundaryAt(divider);
	return labels.size >= 2 ? boundaryAt(header) : null;
}

type EarlierText = {
	text: string;
	opening: string;
	signature: string | undefined;
};
type EarlierMessages = Map<string, Map<string, EarlierText[]>>;

function quoteKey(text: string, start = 0) {
	const prefix = text.slice(start, start + 8);
	const space = prefix.indexOf(" ");
	return space < 0 ? prefix : prefix.slice(0, space);
}

function withoutHistory(body: string, earlier: EarlierMessages) {
	const message = comparableBody(body);
	if (!earlier.size) return message;
	const { normalized } = message;
	for (const start of message.starts) {
		if (!start) continue;
		const bucket = earlier.get(normalized.charAt(start));
		const matches = bucket?.get(quoteKey(normalized, start));
		if (!matches) continue;
		const repeats = matches.some(({ opening }) => {
			const end = start + opening.length;
			return (
				normalized.startsWith(opening, start) &&
				(opening.length === quoteWindowLength ||
					end === normalized.length ||
					normalized[end] === " ")
			);
		});
		if (!repeats) continue;

		const offset = message.offsets[start];
		const boundary = quoteBoundary(body.slice(0, offset));
		if (
			boundary === null &&
			!matches.some(
				({ text, signature }) =>
					normalized.length - start === text.length &&
					normalized.endsWith(text) &&
					(!signature ||
						normalized.slice(0, start - 1).endsWith(` ${signature}`)),
			)
		)
			continue;
		const own = body.slice(0, boundary ?? offset).trim();
		if (own) return comparableBody(own);
	}
	return message;
}

type ComparableBody = ReturnType<typeof comparableBody> & {
	senderName: string | null;
};

const contactAddress = new RegExp(`(?<=[^<>\\s,;])${addressDomain.source}`);
const phone = /(?:\(\d{3}\)|\b\d{3})[ .-]*\d{3}[ .-]*\d{4}\b/;
const website = /\b(?:https?:\/\/|www\.)\S+/i;
const contactLabel = /(?:direct|cell|fax):/i;
const contactLineLabel = new RegExp(
	String.raw`(?:^|[\r\n|])\s*${contactLabel.source}`,
	"i",
);
const inlineContact = new RegExp(
	String.raw`(?<![^\s|])(?:(?:teams meeting\s+)?dial in by phone\s+${phone.source}|${contactLabel.source}|${phone.source}|${website.source}|<?[^<>\s,;|]{1,64}${addressDomain.source})`,
	"i",
);
const titleLine =
	/(?:^|(?<=[\r\n|]))[ \t]*(?:[\p{L}-]+[ \t]+){0,5}(?:director|manager|broker|president|partner|associate|coordinator|officer)[ \t]*(?=$|[\r\n|])/iu;

function hasContactDetails(text: string) {
	return (
		contactAddress.test(text) ||
		phone.test(text) ||
		website.test(text) ||
		contactLineLabel.test(text) ||
		titleLine.test(text)
	);
}

function startsWithName(text: string, name: string) {
	return (
		text === name ||
		(text.startsWith(name) && /[ ,.|]/.test(text.charAt(name.length)))
	);
}

function sharedFooterStart(block: string, senderName: string | null) {
	const contact = block.search(inlineContact);
	const title = titleLine.exec(block);
	const titleStart = title
		? title.index + title[0].length - title[0].trimStart().length
		: block.length;
	const footer = Math.min(titleStart, contact < 0 ? block.length : contact);
	const name = senderName?.split(/\s+/).map(RegExp.escape).join("[ \\t]+");
	const signOffLine = String.raw`${signOffWords}(?=[ \t]*(?:[\r\n]|$))`;
	const sender = name
		? String.raw`|(?:${signOffWords}[ \t]+)?${name}(?=[\s,.|]|$)`
		: "";
	const opening = new RegExp(
		String.raw`(?:^|[\r\n]|[.!?][ \t]+)[ \t]*(?=${signOffLine}${sender})`,
		"i",
	).exec(block.slice(0, footer));
	return opening ? opening.index + opening[0].length : footer;
}

function rememberEarlier(message: ComparableBody, earlier: EarlierMessages) {
	const { body, normalized, offsets, senderName } = message;
	if (!normalized) return;
	const initial = normalized.charAt(0);
	const bucket = earlier.get(initial) ?? new Map<string, EarlierText[]>();
	earlier.set(initial, bucket);
	const remember = (text: string, signature?: string) => {
		const opening = text.slice(0, quoteWindowLength);
		const quote = { text, opening, signature };
		const key = quoteKey(opening);
		const matches = bucket.get(key);
		if (matches) matches.push(quote);
		else bucket.set(key, [quote]);
	};
	remember(normalized);
	if (!senderName) return;
	const start = normalized.lastIndexOf(` ${senderName}`) + 1;
	if (!start || !startsWithName(normalized.slice(start), senderName)) return;
	const at = offsets[start];
	if (
		at === undefined ||
		!/(?:[.!?]|[\r\n])\s*$/.test(body.slice(0, at)) ||
		!hasContactDetails(body.slice(at))
	)
		return;
	// A reply can quote the earlier text without copying the sender's footer.
	remember(normalized.slice(0, start - 1), normalized.slice(start));
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
		const footer = at + sharedFooterStart(body.slice(at), senderName);
		if (footer === body.length) continue;
		const position = offsets.indexOf(footer, start);
		if (position >= 0)
			signature = Math.max(signature, normalized.length - position);
	}
	return signature;
}

export function cleanEmailThread(
	messages: Pick<ThreadMessage, "body" | "sender" | "sender_name">[],
) {
	const senders = new Map<string, ComparableBody[]>();
	const firstSender = messages[0]?.sender.toLowerCase();
	const useFallback =
		firstSender !== undefined &&
		!messages
			.slice(1)
			.some(({ sender }) => sender.toLowerCase() === firstSender);
	const earlier: EarlierMessages = new Map();
	const own = messages.map(({ body, sender, sender_name }, index) => {
		const comparable =
			index === 0 && useFallback
				? comparableBody(cleanEmailBody(body, sender_name))
				: withoutHistory(body, earlier);
		const message = {
			...comparable,
			senderName: sender_name?.trim().toLowerCase() || null,
		};
		rememberEarlier(message, earlier);
		const address = sender.toLowerCase();
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
	return own.map(({ body }) => body);
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
