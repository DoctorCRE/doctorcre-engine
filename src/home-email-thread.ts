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
	userId: string,
) {
	return sql<boolean>`coalesce((select bool_or(user_id = ${userId}::uuid)
		from email_mailbox where activity_id = ${source}), true)`;
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
		text(lines)
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
	sender_name: string | null;
	happened_at: string;
	body: string;
};

export async function readHomeEmailThread(
	db: Transaction<DB>,
	userId: string,
	sourceId: string | null,
) {
	if (!sourceId) return [];
	const { rows } = await sql<ThreadMessage>`
		select e.activity_id, ${senderLabel("e", false)} as sender_name,
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
	return rows.map((message) => ({
		...message,
		body: cleanEmailBody(message.body, message.sender_name),
	}));
}
