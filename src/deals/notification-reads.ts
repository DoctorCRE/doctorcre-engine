import type { Context } from "hono";
import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { Refusal, refuse } from "../answer.ts";
import { failureKind } from "../failure.ts";
import { visibleProposalDetail } from "../home-inbox-review.ts";
import { nextTransaction } from "../next-connection.ts";
import type { DB, JsonObject, JsonValue } from "../next-database.d.ts";
import type { NextSaveEnv } from "../next-door.ts";
import { isUuid } from "../uuid.ts";
import { criticalDateLabel } from "./checklist.ts";
import { isOpenBoardDeal, selectNextDeals } from "./next-board.ts";

type Read = (db: Transaction<DB>) => Promise<unknown>;

async function answer(c: Context<NextSaveEnv>, read: Read): Promise<Response> {
	const database = c.env.DATABASE;
	if (!database) return refuse(c, new Refusal(503, "database_unavailable"));
	try {
		const stamp = c.get("stamp");
		const result = await nextTransaction(
			database.connectionString,
			"read",
			async (tx) => {
				const job =
					"job" in stamp &&
					(await tx
						.selectFrom("job")
						.select("slug")
						.where("slug", "=", stamp.job)
						.executeTakeFirst());
				return job ? read(tx) : new Refusal(403, "unknown_job");
			},
		);
		return result instanceof Refusal ? refuse(c, result) : c.json(result);
	} catch (error) {
		console.warn("notification read failed:", failureKind(error));
		return refuse(c, new Refusal(503, "database_unavailable"));
	}
}

async function checklistReminders(db: Transaction<DB>, dealId: string) {
	const board = selectNextDeals(db).select([
		"owner.id as owner_user_id",
		"owner.is_account_partner",
	]);
	const deal = await db
		.selectFrom(board.as("board"))
		.select(["id as deal_id", "owner_user_id", "owner"])
		.select(
			sql<string>`(now() at time zone 'America/Chicago')::date::text`.as(
				"observed_on",
			),
		)
		.select(
			sql<boolean>`(${isOpenBoardDeal}) and operating_state = 'active' and is_account_partner`.as(
				"eligible",
			),
		)
		.where("id", "=", dealId)
		.executeTakeFirst();
	if (!deal) return new Refusal(404, "not_found");
	const { eligible, ...header } = deal;
	if (!eligible) return { ...header, items: [] };
	const { rows } = await sql<{
		item_ref: string;
		title: string;
		due_on: string;
		standard: boolean;
	}>`
		with due as (
			select 'critical-date:' || id as item_ref, kind as title, due_on, true as standard, null::timestamptz as created_at
			from critical_date where deal_id = ${dealId} and status = 'open'
			union all
			select 'deal-item:' || id, item_title, due_on, false, created_at
			from next_step where deal_id = ${dealId} and status = 'open' and item_title is not null
			and source_ref ~ '[^[:space:]]'
		)
		select item_ref, title, due_on::text, standard from due
		where due_on between date '0001-01-01' and ${deal.observed_on}::date
		and not exists (
			select from home_update u where u.user_id = ${deal.owner_user_id} and u.deal_id = ${dealId}
			and u.checklist_item_ref = due.item_ref and u.due_on = due.due_on
		)
		order by standard desc, case when standard then due_on end, created_at, item_ref`.execute(
		db,
	);
	return {
		...header,
		items: rows.map(({ standard, title, ...item }) => ({
			...item,
			title: standard ? criticalDateLabel(title) : title,
		})),
	};
}

type Watch = {
	kind: "deal" | "lease";
	id: string;
	subscriber: string;
	since: string;
};
type WatchChange = {
	change_id: string;
	table_name: string;
	record: JsonObject;
	action: string;
	field: string;
	old_value: JsonValue;
	new_value: JsonValue;
	actor: string;
	for_user: string | null;
	changed_at: string;
};

async function dealWatch(db: Transaction<DB>, watch: Watch) {
	const subscriber = await db
		.selectFrom("app_user")
		.select("id")
		.where("slug", "=", watch.subscriber)
		.where("is_account_partner", "=", true)
		.executeTakeFirst();
	if (!subscriber) return new Refusal(422, "actor_not_provisioned");
	const target = await (watch.kind === "lease"
		? db
				.selectFrom("lease")
				.select(["deal_id", "party_id"])
				.where("id", "=", watch.id)
		: db
				.selectFrom("deal")
				.select(["id as deal_id", sql<null>`null`.as("party_id")])
				.where("id", "=", watch.id)
	).executeTakeFirst();
	if (!target) return new Refusal(404, "not_found");
	const dealId = target.deal_id;
	const leaseId = watch.kind === "lease" ? watch.id : null;
	const { rows: changes } = await sql<WatchChange>`
		with versions as (
			select v.id from lease_version v join lease l on l.id = v.lease_id
			where l.id = ${leaseId} or (${leaseId}::uuid is null and l.deal_id = ${dealId})
		), watched_fields(table_name, fields) as (values
			('deal', array['owner_user_id', 'parking_reason']),
			('deal_phase_change', array['phase', 'happened_at']),
			('next_step', array['status', 'owner_party_id', 'due_on', 'item_title', 'created_at', 'done_at']),
			('critical_date', array['status', 'kind', 'due_on']),
			('proposal', array['next_step_id', 'keeps_deal_date', 'decided_at']),
			('lease_version', array['version', 'executed_on', 'expiration_on']),
			('lease_option', array['kind', 'notice_on'])
		)
		select c.id::text as change_id, c.table_name, c.record, c.action, field,
			c.old_value -> field as old_value, c.new_value -> field as new_value,
			coalesce(actor.slug, c.changed_by_job) as actor, sponsor.slug as for_user,
			to_jsonb(c.changed_at) #>> '{}' as changed_at
		from change c join watched_fields w using (table_name)
		cross join lateral jsonb_object_keys(coalesce(c.new_value, c.old_value)) as edit(field)
		left join app_user actor on actor.id = c.changed_by_user_id
		left join app_user sponsor on sponsor.id = c.changed_for_user_id
		where c.changed_at >= ${watch.since}::timestamptz and c.action <> 'erase'
			and field = any(w.fields)
			and case c.table_name
				when 'deal' then c.record = jsonb_build_object('id', ${dealId}::uuid)
				when 'deal_phase_change' then c.record ->> 'deal_id' = ${dealId}::text
				when 'next_step' then case when c.action = 'delete' then c.old_value ->> 'deal_id' = ${dealId}::text
					else exists (
						select from next_step s where s.deal_id = ${dealId} and c.record = jsonb_build_object('id', s.id)
					) end
				when 'critical_date' then exists (
					select from critical_date d where c.record = jsonb_build_object('id', d.id)
					and (d.deal_id = ${dealId} or (d.kind = 'option_notice' and d.lease_version_id in (select id from versions)))
				)
				when 'proposal' then exists (
					select from proposal p
					left join activity a on a.id = p.activity_id
					left join next_step step on step.id = p.next_step_id
					where p.deal_id = ${dealId} and p.kind = 'next_step_done'
					and c.record = jsonb_build_object('id', p.id)
					and ${visibleProposalDetail(subscriber.id)}
				)
				when 'lease_version' then (c.record ->> 'id')::uuid in (select id from versions)
				when 'lease_option' then (c.record ->> 'lease_version_id')::uuid in (select id from versions)
			end
		order by c.changed_at, c.id, field`.execute(db);
	const { rows: replies } = await sql<{ activity_id: string }>`
		select e.activity_id from email e join email_mailbox m using (activity_id)
		where m.user_id = ${subscriber.id}
		and exists (select from activity_about a where a.activity_id = e.activity_id and a.deal_id = ${dealId}
			and greatest(a.changed_at, m.changed_at) >= ${watch.since}::timestamptz)
		and not exists (select from party_email pe join app_user u on u.id = pe.party_id where pe.address = e.sender)
		order by e.activity_id`.execute(db);
	return {
		kind: watch.kind,
		id: watch.id,
		deal_id: dealId,
		href: target.party_id
			? `/clients?record=${target.party_id}`
			: `/deals?deal=${watch.id}`,
		changes,
		reply_activity_ids: replies.map((reply) => reply.activity_id),
	};
}

const watchQuery = z.strictObject({
	subscriber: z.string().min(1),
	since: z.iso.datetime({ offset: true }),
});

export const notificationReads = new Hono<NextSaveEnv>()
	.get("/deals/:deal_id/checklist-reminders", async (c) => {
		const id = c.req.param("deal_id");
		if (!isUuid(id)) return refuse(c, new Refusal(404, "not_found"));
		return answer(c, (db) => checklistReminders(db, id));
	})
	.get("/deal-watches/:kind/:id", async (c) => {
		const { kind, id } = c.req.param();
		if ((kind !== "deal" && kind !== "lease") || !isUuid(id))
			return refuse(c, new Refusal(404, "not_found"));
		const query = watchQuery.safeParse(c.req.query());
		if (!query.success)
			return refuse(c, new Refusal(400, "invalid_field_value"));
		return answer(c, (db) => dealWatch(db, { kind, id, ...query.data }));
	});
