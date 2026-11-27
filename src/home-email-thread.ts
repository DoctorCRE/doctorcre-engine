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

// A partner's own address always reads as "Joe" or "Dell", whatever display name the message carried.
const partnerName = sql<
	string | null
>`(select initcap(min(app_user.slug)) from party_email
	join app_user on app_user.id = party_email.party_id and app_user.is_account_partner
	where party_email.address = e.sender
	having count(*) = 1)`;

type ThreadRow = {
	sender_name: string | null;
	partner_name: string | null;
	activity_id: string;
	happened_at: string;
	exact_happened_at: string;
	summary: DB["activity"]["summary"];
} & Pick<
	DB["email"],
	"sender" | "message_id" | "subject" | "body" | "authored" | "history"
>;

function shownText({ body, authored, history }: ThreadRow) {
	if (authored === null) return { body, folded: null };
	return { body: authored, folded: history?.trim() || null };
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
		select e.activity_id, e.sender, ${senderLabel("e", false)} as sender_name, ${partnerName} as partner_name, a.summary,
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
	const thread = groups.map(({ display }) => ({
		activity_id: display.activity_id,
		sender_name: display.partner_name ?? display.sender_name,
		happened_at: display.happened_at,
		...shownText(display),
	}));
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
