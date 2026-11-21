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

type ThreadMessage = {
	activity_id: string;
	sender: string;
	sender_name: string | null;
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

export function cleanEmailThread(
	messages: Pick<ThreadMessage, "body" | "sender">[],
) {
	const earlier = new Set<string>();
	const senders = new Map<string, MailLine[][]>();
	const cleaned = messages.map(({ body, sender }) => {
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
		return { body, lines, content, removed };
	});

	const signatures = new Set<MailLine>();
	for (const group of senders.values()) {
		if (group.length < 3) continue;
		for (const lines of signatureLines(group)) {
			for (const line of lines) signatures.add(line);
		}
	}

	return cleaned.map(({ body, lines, content, removed }) => {
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
		if (!removed.size) return body;
		const shown = lines.filter((line) => !removed.has(line));
		const start = shown.findIndex(({ text }) => text.trim());
		if (start < 0) return body;
		const end = shown.findLastIndex(({ text }) => text.trim());
		return shown
			.slice(start, end + 1)
			.map(({ text }) => text)
			.join("\n")
			.replace(/\n(?:[ \t]*\n){2,}/g, "\n\n");
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
		body: bodies[index] ?? message.body,
	}));
}
