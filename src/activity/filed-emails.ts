import { Hono } from "hono";
import { sql } from "kysely";
import { Refusal, refuse } from "../answer.ts";
import { nextTransaction } from "../next-connection.ts";
import type { NextSaveEnv } from "../next-door.ts";
import { isUuid } from "../uuid.ts";

type FiledEmail = {
	activity_id: string;
	deal_ids: string[];
	outgoing: boolean;
	body: string;
	happened_at: string;
};

export const filedEmails = new Hono<NextSaveEnv>().get(
	"/filed-emails",
	async (c) => {
		const after = c.req.query("after") || null;
		const limit = Number(c.req.query("limit") ?? 100);
		if (
			(after !== null && !isUuid(after)) ||
			!Number.isInteger(limit) ||
			limit < 1 ||
			limit > 1000
		)
			return refuse(
				c,
				new Refusal(400, "invalid_field_value", { fields: ["after", "limit"] }),
			);
		const stamp = c.get("stamp");
		if (stamp.job === undefined)
			return refuse(c, new Refusal(403, "unknown_job"));
		const database = c.env.DATABASE;
		if (!database) return refuse(c, new Refusal(503, "database_unavailable"));
		try {
			const result = await nextTransaction(
				database.connectionString,
				"read",
				async (tx) => {
					const job = await tx
						.selectFrom("job")
						.select("slug")
						.where("slug", "=", stamp.job)
						.executeTakeFirst();
					if (!job) return new Refusal(403, "unknown_job");
					const user =
						stamp.for_user &&
						(await tx
							.selectFrom("app_user")
							.select("id")
							.where("slug", "=", stamp.for_user)
							.executeTakeFirst());
					if (!user) return new Refusal(422, "actor_not_provisioned");
					const { rows } = await sql<FiledEmail>`
    select e.activity_id, e.body, to_char(a.happened_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as happened_at,
     array(select ab.deal_id from activity_about ab where ab.activity_id = e.activity_id and ab.deal_id is not null order by ab.deal_id) as deal_ids,
     exists (select from party_email pe join app_user u on u.id = pe.party_id where pe.address = e.sender) as outgoing
    from email e join activity a on a.id = e.activity_id
    join email_mailbox m on m.activity_id = e.activity_id
    where m.user_id = ${user.id} and (${after}::uuid is null or e.activity_id > ${after}::uuid)
     and exists (select from activity_about ab where ab.activity_id = e.activity_id and ab.deal_id is not null)
    order by e.activity_id limit ${limit + 1}`.execute(tx);
					const emails = rows.slice(0, limit);
					return {
						emails,
						next_cursor:
							rows.length > limit ? emails.at(-1)?.activity_id : null,
					};
				},
			);
			return result instanceof Refusal ? refuse(c, result) : c.json(result);
		} catch {
			return refuse(c, new Refusal(503, "database_unavailable"));
		}
	},
);
