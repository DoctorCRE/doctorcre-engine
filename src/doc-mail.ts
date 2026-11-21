import { sql, type Transaction } from "kysely";
import { isoMillis } from "./answer.ts";
import type { Source } from "./doc-reads.ts";
import { senderLabel } from "./home-email-thread.ts";
import {
	findHomeEmailReviewItem,
	readHomeMailPriorities,
} from "./home-inbox-review.ts";
import type { DB } from "./next-database.d.ts";

export type MailSource = Source<"email">;

function mailSource(id: string, subject: string, itemId: string): MailSource {
	return {
		ref: { kind: "email", id },
		label: subject,
		href: `/inbox/card/${encodeURIComponent(itemId)}`,
	};
}

export async function readDocMailPriorities(
	db: Transaction<DB>,
	userId: string,
) {
	const { items } = await readHomeMailPriorities(db, userId, {
		limit: 10,
		requireMailbox: true,
	});
	return items.map(
		({ item_id, source_activity, sender, subject, suggestion, due_on }) => ({
			record: mailSource(source_activity.id, subject, item_id),
			sender,
			subject,
			happened_at: source_activity.happened_at,
			suggestion,
			due_on,
		}),
	);
}

export async function readDocMail(
	db: Transaction<DB>,
	userId: string,
	activityId: string,
) {
	const facts = await db
		.selectFrom("email as e")
		.innerJoin(
			"email_mailbox as mailbox",
			"mailbox.activity_id",
			"e.activity_id",
		)
		.innerJoin("activity as a", "a.id", "e.activity_id")
		.where("mailbox.user_id", "=", userId)
		.where("e.activity_id", "=", activityId)
		.select([
			senderLabel("e").as("sender"),
			sql<string>`coalesce(nullif(btrim(e.subject), ''), 'No subject')`.as(
				"subject",
			),
			isoMillis(sql.ref("a.happened_at")).as("happened_at"),
			sql<string>`left(e.body, 2000)`.as("body"),
		])
		.executeTakeFirst();
	if (!facts) return null;
	const itemId = await findHomeEmailReviewItem(db, userId, activityId);
	if (!itemId) return null;
	return { record: mailSource(activityId, facts.subject, itemId), ...facts };
}
