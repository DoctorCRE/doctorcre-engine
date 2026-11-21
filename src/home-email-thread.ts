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
const droppedLine =
	/^[ \t]*(?:>|\*?(?:from|to|cc|bcc|sent|subject|phone|fax|tel|mobile|cell):|sent from my )/i;
const ruleLine = /^[ \t]*[-_=*]{3,}[ \t]*$/;
const signOff =
	/^(?:best|regards|(?:best|kind|warm) regards|thanks(?: so much| again)?|thank you|many thanks|sincerely|cheers)[,.!]?$/i;
const contact = /\S@\S+\.\S|https?:\/\/|www\.|\d[\d(). -]{8,}\d/i;

export function cleanEmailBody(body: string, sender: string | null) {
	const source = body.replace(/\u00a0/g, " ").split(/\r\n?|\n/);
	const kept = source
		.slice(0, historyStart(source))
		.filter((line) => !droppedLine.test(line));
	const lines = kept.slice(0, signatureStart(kept, sender));
	const end = lines.findLastIndex(
		(line) => line.trim() && !ruleLine.test(line),
	);
	return lines
		.slice(0, end + 1)
		.join("\n")
		.trim();
}

function historyStart(lines: string[]) {
	let from = -1;
	for (const [index, line] of lines.entries()) {
		const text = line.trim();
		if (historyMarker.test(text) || quoteIntro(lines, index)) return index;
		if (/^\*?from:/i.test(text)) from = index;
		else if (from < 0 || !text) continue;
		else if (/^\*?(?:sent|date):/i.test(text)) return from;
		else if (!/^[ \t]|^\*?[a-z][a-z0-9-]*:/i.test(line)) from = -1;
	}
	return lines.length;
}

// Mail clients wrap a long "On <date>, <name> <address> wrote:" over lines.
function quoteIntro(lines: string[], index: number) {
	if (!/^on\s/i.test(lines[index]?.trim() ?? "")) return false;
	let text = "";
	for (const line of lines.slice(index, index + 3)) {
		text = `${text} ${line.trim()}`.trim();
		if (text.length > 400) return false;
		if (/\bwrote:$/i.test(text)) return true;
	}
	return false;
}

function signatureStart(lines: string[], sender: string | null) {
	const name = sender?.trim().toLowerCase();
	const first = name?.split(/\s+/, 1)[0];
	const isName = (line: string) =>
		!!name &&
		(line === name ||
			line === first ||
			line.startsWith(`${name} `) ||
			line.startsWith(`${name},`));
	const details = (rest: string[]) =>
		rest.length <= 8 &&
		rest.every((line) => line.length <= 80) &&
		(!rest.length || rest.some((line) => contact.test(line)));
	const window = lines.length - 15;
	// A sign-off or the sender's name followed only by short contact lines is a signature.
	const start = lines.findIndex((raw, index) => {
		if (index < window) return false;
		const line = raw.trim().toLowerCase();
		const tail = lines
			.slice(index + 1)
			.map((rest) => rest.trim().toLowerCase())
			.filter(Boolean);
		const [next = "", ...rest] = tail;
		return (
			line === "--" ||
			(signOff.test(line) && (!next || (isName(next) && details(rest)))) ||
			(isName(line) && !!next && details(tail))
		);
	});
	return start < 0 ? lines.length : start;
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
