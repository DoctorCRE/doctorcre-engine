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

type Sender = { sender: string; sender_name: string | null };

type ThreadMessage = Sender & {
	activity_id: string;
	happened_at: string;
	body: string;
};

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
const forwarded =
	/\bBegin forwarded message:|(?<!-)-{2,} *(?:original|forwarded) message *-{2,}/i;
const headerField =
	/(?<![^\s.…>])\*?(From|Sent|Date|To|Cc|Bcc|Subject):\*?(?=\s|$)/gi;
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
	/^(?:(?:[A-Z]{2} )?(?:license|lic\.|dre|bre|nmls)[ :#]+[\w-]*\d[\w-]*|(?:(?:general|regional|office|transaction|leasing|commercial|managing|associate|executive|chief|operating|vice|senior) ){0,4}(?:dentist|director|manager|broker|president|partner|associate|coordinator|officer)|(?:[\w-]+\.)+(?:com|org|net|co|io)|\d+ [\w. ]+ (?:st\.?|street|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?|blvd\.?)(?:[., ].*)?|[\w. ]+, [A-Z]{2} \d{5}(?:-\d{4})?)$/i;
const legalFooter =
	/^(?:confidentiality (?:notice|statement)\b|if you (?:are not the intended recipient|have received this (?:e-?mail|message) in error)\b|(?:this|the) (?:e-?mail|message|communication|transmission|information)\b.*\b(?:confidential|privileged|intended (?:only |solely )?for)\b)/is;
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

type SignatureLine = {
	messages: number;
	preceding: Map<string, SignatureLine>;
};

function signatureLines(group: MailLine[][]) {
	const endings = new Map<string, SignatureLine>();
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

function historyStart(body: string) {
	const start = Math.min(
		body.length,
		...[
			body.search(replyOpener),
			body.search(forwarded),
			body.search(/^[ \t]*>/m),
		].filter((at) => at >= 0),
	);
	const fields = [...body.matchAll(headerField)];
	const header = fields.findIndex((field, index) => {
		if (field.index >= start) return false;
		if (/^(?:cc|bcc)$/i.test(field[1] ?? "")) return false;
		const labels = new Set<string>();
		for (const [offset, next] of fields.slice(index, index + 7).entries()) {
			if (next.index - field.index > 3500) break;
			const label = next[1]?.toLowerCase() ?? "";
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
				(labels.has("sent") || labels.has("date"))
			)
				return true;
		}
		return false;
	});
	const boundary = fields[header]?.index ?? start;
	const divider = body.slice(0, boundary).search(/(?<!_)_{8,}\s*$/);
	return boundary < body.length && divider >= 0 ? divider : boundary;
}

function signatureStart(
	body: string,
	senderName: string | null,
	sender: string,
) {
	const name = senderName?.trim().toLowerCase();
	const firstName = name?.split(/\s+/, 1)[0];
	let start = body.length;
	let hasContact = false;
	const paragraph = body.lastIndexOf("\n\n") + 2;
	if (paragraph > 1 && legalFooter.test(body.slice(paragraph).trimStart())) {
		start = paragraph - 1;
		hasContact = true;
	}
	for (const raw of body.slice(0, start).split("\n").toReversed()) {
		const line = raw.trim();
		if (line) {
			const lower = line.toLowerCase();
			const named = name && (lower.startsWith(`${name} |`) || lower === name);
			const details =
				named && line.includes("|") ? line.slice(line.indexOf("|") + 1) : line;
			const contactLine = details.length <= 500 && contactDetails(details);
			const footer =
				legalFooter.test(line) ||
				deviceFooter.test(line) ||
				imageFooter.test(line);
			if (contactLine || footer) hasContact = true;
			else if (
				!hasContact ||
				!(
					named ||
					lower === firstName ||
					signatureDetail.test(line) ||
					signOff.test(line)
				)
			)
				break;
		}
		start -= raw.length + 1;
	}
	const last = hasContact ? Math.max(0, start + 1) : body.length;
	const prefix = body.slice(0, last).trimEnd();
	const lineStart = prefix.lastIndexOf("\n") + 1;
	const inline = prefix.slice(lineStart);
	const inlineStart = inlineSignatureStart(inline, name, sender);
	return inlineStart < inline.length ? lineStart + inlineStart : last;
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

function inlineSignatureStart(
	line: string,
	name: string | undefined,
	sender: string,
) {
	const tail = line.slice(-1600);
	const mailbox = sender.trim().toLowerCase();
	if (!phone.test(tail) && !address.test(tail) && !website.test(tail))
		return line.length;
	for (const sign of tail.matchAll(/(?<=\S )[A-Z][a-z]+(?: [a-z]+){0,2},? /g)) {
		if (!signOff.test(sign[0].trim())) continue;
		const details = tail.slice(sign.index + sign[0].length);
		if (
			name &&
			!details.toLowerCase().startsWith(name.split(" ", 1)[0] ?? name)
		)
			continue;
		if (
			details.includes("|") ||
			(mailbox && details.toLowerCase().includes(mailbox)) ||
			/^\S+[,.]? +(?:\+?1 |\(|\d)/.test(details)
		)
			return line.length - tail.length + sign.index;
	}
	if (name) {
		const at = tail.toLowerCase().lastIndexOf(name);
		const details = tail.slice(at + name.length);
		if (
			at > 0 &&
			/[.!?]\s+$/.test(tail.slice(0, at)) &&
			(/^[, ]+(?:DMD|DDS)/.test(details) ||
				details.includes("|") ||
				(mailbox && details.toLowerCase().includes(mailbox)))
		)
			return line.length - tail.length + at;
	}
	return line.length;
}

function foldEmailBody(body: string, { sender_name, sender }: Sender) {
	const normalized = body.replace(/\r\n?/g, "\n");
	const history = historyStart(normalized);
	const visible = normalized.slice(0, history).trimEnd();
	const split = signatureStart(visible, sender_name, sender);
	const current = visible.slice(0, split).trimEnd();
	const folded = normalized.slice(split).trim();
	return current && folded ? { body: current, folded } : { body, folded: null };
}

export function cleanEmailThread(messages: (Sender & { body: string })[]) {
	const earlier = new Set<string>();
	const senders = new Map<string, MailLine[][]>();
	const cleaned = messages.map(({ body, sender, sender_name }) => {
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
		return { body, lines, content, removed, sender_name, sender };
	});

	const signatures = new Set<MailLine>();
	for (const group of senders.values()) {
		if (group.length < 3) continue;
		for (const lines of signatureLines(group)) {
			for (const line of lines) signatures.add(line);
		}
	}

	return cleaned.map((message) => {
		const { body, lines, content, removed } = message;
		let inInvite = false;
		for (const line of content) {
			const { key } = line;
			inInvite =
				inviteHeading.test(key) ||
				teamsJoin.test(key) ||
				zoomJoin.test(key) ||
				(inInvite && inviteDetail.test(key));
			if (inInvite || signatures.has(line)) removed.add(line);
		}
		if (!removed.size) return foldEmailBody(body, message);
		const shown = lines.filter((line) => !removed.has(line));
		const start = shown.findIndex(({ text }) => text.trim());
		if (start < 0) return foldEmailBody(body, message);
		const end = shown.findLastIndex(({ text }) => text.trim());
		const retained = shown
			.slice(start, end + 1)
			.map(({ text }) => text)
			.join("\n")
			.replace(/\n(?:[ \t]*\n){2,}/g, "\n\n");
		return foldEmailBody(retained, message);
	});
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
		...(bodies[index] ?? { body: message.body, folded: null }),
	}));
}
