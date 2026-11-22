import type { Context } from "hono";
import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { Refusal, refuse } from "../answer.ts";
import { isCalendarDate } from "../calendar-date.ts";
import { failureKind } from "../failure.ts";
import { visibleProposalDetail } from "../home-inbox-review.ts";
import { nextTransaction, setNextReadViewer } from "../next-connection.ts";
import type { DB, JsonObject, JsonValue } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { fit } from "../request-shape.ts";
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

function checklistDeals(db: Transaction<DB>) {
	const board = selectNextDeals(db).select([
		"owner.id as owner_user_id",
		"owner.is_account_partner",
	]);
	return db
		.selectFrom(board.as("board"))
		.select(["id as deal_id", "owner_user_id", "owner"])
		.select(
			sql<boolean>`(${isOpenBoardDeal}) and operating_state = 'active' and is_account_partner`.as(
				"eligible",
			),
		);
}

const openChecklistItems = (day: string) => sql`
	select deal_id, 'critical-date:' || id as item_ref, kind as title,
		due_on, true as standard, null::timestamptz as created_at,
		null::uuid as call_activity_id, null::uuid as owner_party_id
	from critical_date where status = 'open' and due_on between date '0001-01-01' and ${day}::date
	union all
	select deal_id, 'deal-item:' || id, item_title, due_on, false, created_at, call_activity_id, owner_party_id
	from next_step where status = 'open' and item_title is not null
		and source_ref ~ '[^[:space:]]' and due_on between date '0001-01-01' and ${day}::date
`;

async function checklistReminders(db: Transaction<DB>, dealId: string) {
	const deal = await checklistDeals(db)
		.select(
			sql<string>`(now() at time zone 'America/Chicago')::date::text`.as(
				"observed_on",
			),
		)
		.where("id", "=", dealId)
		.executeTakeFirst();
	if (!deal) return new Refusal(404, "not_found");
	const { eligible, ...header } = deal;
	if (!eligible) return { ...header, items: [] };
	await setNextReadViewer(db, deal.owner_user_id);
	const { rows } = await sql<{
		item_ref: string;
		title: string;
		due_on: string;
		standard: boolean;
	}>`
		select item_ref, title, due_on::text, standard
		from (${openChecklistItems(deal.observed_on)}) due
		where deal_id = ${dealId}
		and call_step_visible_to(call_activity_id, owner_party_id)
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

const isRunDate = (value: unknown): value is string =>
	isCalendarDate(value) && value >= "0001-01-01";

async function queueChecklistReminders(
	db: Transaction<DB>,
	{ run_date }: { run_date: string },
) {
	const { rows } = await sql<{ queued: number; already_queued: number }>`
		with due as (
			select deal_id, owner_user_id, item_ref, due_on
			from (${openChecklistItems(run_date)}) item
			join (${checklistDeals(db)}) deal using (deal_id) where deal.eligible
			and call_step_visible_to(item.call_activity_id, item.owner_party_id, deal.owner_user_id)
		), local_times as (
			select owner_user_id, coalesce(p.time_zone, 'America/Chicago') as zone,
				${new Date().toISOString()}::timestamptz as queued_at,
				coalesce(p.quiet_until, time '07:00') as opens_at
			from (select distinct owner_user_id from due) owners
			left join user_preference p on p.user_id = owner_user_id
		), calendar as (
			select owner_user_id, zone, queued_at,
				(queued_at at time zone zone)::date + opens_at as opens_today
			from local_times
		), windows as (
			select owner_user_id, zone, queued_at,
				case when queued_at < opens_today at time zone zone
					then opens_today - interval '1 day' else opens_today end as last_open
			from calendar
		), queued as (
			insert into home_update (user_id, deal_id, checklist_item_ref, due_on, what, held_until)
			select owner_user_id, deal_id, item_ref, due_on,
				'A deal checklist item is due. Open the deal checklist for details.',
				case when queued_at >= (last_open + interval '4 hours') at time zone zone
					then (last_open + interval '1 day') at time zone zone
				end
			from due join windows using (owner_user_id)
			order by owner_user_id, deal_id, item_ref, due_on
			on conflict (user_id, deal_id, checklist_item_ref, due_on) do nothing
			returning id
		)
		select count(*)::int as queued,
			((select count(*) from due) - count(*))::int as already_queued
		from queued
	`.execute(db);
	const [answer] = rows;
	if (!answer) throw new Error("Checklist reminders were not counted");
	return answer;
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
	await setNextReadViewer(db, subscriber.id);
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
			case when c.table_name = 'deal_phase_change' and c.action = 'insert' and field = 'phase' then (
				select to_jsonb(prior.phase) from deal_phase_change prior
				where prior.deal_id = ${dealId}
				and prior.happened_at < (c.record ->> 'happened_at')::timestamptz
				order by prior.happened_at desc limit 1
			) else c.old_value -> field end as old_value,
			c.new_value -> field as new_value,
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
					and call_step_visible_to((c.old_value ->> 'call_activity_id')::uuid, (c.old_value ->> 'owner_party_id')::uuid)
					else exists (
						select from next_step s where s.deal_id = ${dealId} and c.record = jsonb_build_object('id', s.id)
						and call_step_visible_to(s.call_activity_id, s.owner_party_id)
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
	.post("/deals/checklist-reminders", async (c) => {
		if (c.get("stamp").job !== "nightly_checklist")
			return refuse(c, new Refusal(403, "unknown_job"));
		return answerNextSave(
			c,
			"queue-checklist-reminders",
			(body) =>
				fit(body, { idempotency_key: isUuid, run_date: isRunDate }, [
					"idempotency_key",
					"run_date",
				]),
			queueChecklistReminders,
		);
	})
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
