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

const signOff =
	/^(?:best(?: regards)?|kind regards|regards|thanks|thank you|sincerely)[,.!]$/i;
const contactLine =
	/^(?:\+?(?:[(). -]*\d){10,15}|\S+@\S+\.\S+|https?:\/\/\S+)$/i;

export function cleanEmailBody(body: string, sender: string | null) {
	const source = body.split(/\r?\n/);
	let candidate = -1;
	let cutoff = source.length;
	for (const [index, line] of source.entries()) {
		if (
			/^(?:[- ]*original message[- ]*|on .+ wrote:[ \t]*)$/i.test(
				line.trimStart(),
			)
		) {
			cutoff = index;
			break;
		}
		if (/^[ \t]*from:/i.test(line)) {
			candidate = index;
		} else if (candidate >= 0 && /^[ \t]*(?:sent|date):/i.test(line)) {
			cutoff = candidate;
			break;
		} else if (
			candidate >= 0 &&
			!/^(?:[ \t]+|[A-Za-z][A-Za-z0-9-]*:)/.test(line)
		) {
			candidate = -1;
		}
	}
	const lines = source
		.slice(0, cutoff)
		.filter(
			(line) =>
				!/^[ \t]*(?:>|from:|to:|cc:|bcc:|sent:|subject:|phone:|fax:|tel:|mobile:)/i.test(
					line,
				),
		);
	const end = lines.findLastIndex((line) => signOff.test(line.trim()));
	if (end < 0) return lines.join("\n").trim();

	const name = sender?.toLowerCase();
	const firstName = name?.split(/\s+/, 1)[0];
	const [signature, ...details] = lines
		.slice(end + 1)
		.map((line) => line.trim().toLowerCase())
		.filter(Boolean);
	const footer =
		!signature ||
		((signature === name || signature === firstName) &&
			details.every((line) => contactLine.test(line)));
	return (footer ? lines.slice(0, end) : lines).join("\n").trim();
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
