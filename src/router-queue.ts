import { Hono } from "hono";
import { type RawBuilder, sql } from "kysely";
import { Refusal, refuse } from "./answer.ts";
import type { JsonObject } from "./database.d.ts";
import { nextTransaction } from "./next-connection.ts";
import type { NextSaveEnv } from "./next-door.ts";
import { isUuid } from "./request-shape.ts";
import { SaveRefusal } from "./save.ts";

const threadSubject = (subject: RawBuilder<unknown>) =>
	sql`regexp_replace(lower(btrim(regexp_replace(${subject}, '[[:space:]]+', ' ', 'g'))), '^(?:(?:re|fw|fwd) *: *)+', '')`;

export const routerQueue = new Hono<NextSaveEnv>().get(
	"/router-queue",
	async (c): Promise<Response> => {
		const days = Number(c.req.query("days") ?? 3),
			limit = Number(c.req.query("limit") ?? 25);
		const after = c.req.query("after");
		if (
			!Number.isInteger(days) ||
			days < 1 ||
			days > 7 ||
			!Number.isInteger(limit) ||
			limit < 1 ||
			limit > 200 ||
			(after !== undefined && !isUuid(after))
		)
			return refuse(c, new Refusal(400, "invalid_field_value"));
		const stamp = c.get("stamp");
		if (!("for_user" in stamp) || !stamp.for_user || !stamp.job)
			return refuse(c, new Refusal(422, "actor_not_provisioned"));
		const { job: jobSlug, for_user: userSlug } = stamp;
		const database = c.env.DATABASE;
		if (!database) return refuse(c, new Refusal(503, "database_unavailable"));
		try {
			return c.json(
				await nextTransaction(database.connectionString, "read", async (tx) => {
					const user = await tx
						.selectFrom("app_user")
						.select("id")
						.where("slug", "=", userSlug)
						.executeTakeFirst();
					const job = await tx
						.selectFrom("job")
						.select("slug")
						.where("slug", "=", jobSlug)
						.executeTakeFirst();
					if (!job) throw new SaveRefusal(new Refusal(403, "unknown_job"));
					if (!user)
						throw new SaveRefusal(new Refusal(422, "actor_not_provisioned"));
					const { rows } = await sql<{
						answer: JsonObject;
					}>`with open_deals as (
    select d.id as deal_id, d.name, ph.phase, d.kind, cl.party_id as client_party_id, cl.name as client_name,
     prop.address as property, m.name as city,
     coalesce((select jsonb_agg(jsonb_build_object('party_id', p.id, 'name', p.name, 'role', dp.role) order by p.id, dp.role)
      from deal_party dp join party p on p.id = dp.party_id where dp.deal_id = d.id), '[]') as participants
    from deal d left join market m on m.id = d.market_id left join lateral (select phase from deal_phase_change where deal_id = d.id order by happened_at desc limit 1) ph on true
    left join lateral (select p.id as party_id, p.name from deal_party dp join party p on p.id = dp.party_id
      where dp.deal_id = d.id and dp.role = 'client' order by p.id limit 1) cl on true
    left join lateral (select p.address from deal_property dp join property p on p.id = dp.property_id
      where dp.deal_id = d.id order by dp.created_at, p.id limit 1) prop on true
    where coalesce(ph.phase, '') not in ('closed', 'dead')
   ), queued_mail as (
    select a.id, a.happened_at, e.message_id, e.conversation_id, e.sender, e.sender_name, e.subject, e.body
    from email_mailbox m join email e using (activity_id) join activity a on a.id = e.activity_id
    where m.user_id = ${user.id}::uuid and m.changed_at >= now() - ${days} * interval '1 day'
     and a.happened_at between now() - interval '30 days' and now()
     and (${after ?? null}::uuid is null or (a.happened_at, a.id) > (select happened_at, id from activity where id = ${after ?? null}::uuid))
    order by a.happened_at, a.id limit ${limit + 1}
   ), page as (
    select * from queued_mail order by happened_at, id limit ${limit}
   ), thread_entries as (
    select current_mail.id as queued_id, old.id, old.happened_at, prior.conversation_id, prior.subject,
     prior.sender, prior.sender_name, aa.deal_id
    from activity old join email prior on prior.activity_id = old.id
    join activity_about aa on aa.activity_id = old.id and aa.deal_id is not null
    join page current_mail on old.happened_at < current_mail.happened_at
     and (prior.conversation_id = current_mail.conversation_id or
      (prior.conversation_id is null and current_mail.conversation_id is null
       and old.happened_at >= current_mail.happened_at - interval '30 days'
       and nullif(${threadSubject(sql`prior.subject`)}, '') = ${threadSubject(sql`current_mail.subject`)}))
   ), work_addresses as (
    select pe.address from party_email pe join app_user u on u.id = pe.party_id where pe.label = 'work'
   ), mail as (
    select id, sender, sender_name from page union select id, sender, sender_name from thread_entries
   ), addresses as (
    select sender as address from mail
    union select r.address from email_recipient r join mail m on m.id = r.activity_id
   ), contacts as (
    select pe.address, min(pe.party_id::text)::uuid as party_id
    from party_email pe join addresses a on a.address = pe.address group by pe.address having count(*) = 1
   ), people as (
    select a.address, jsonb_build_object('address', a.address, 'name', p.name, 'party_id', p.id,
     'internal', exists (select from work_addresses w where split_part(w.address, '@', 2) = split_part(a.address, '@', 2)),
     'client_party_ids', clients.ids,
     'role', case when jsonb_array_length(clients.ids) > 0 or exists (select from party_role r where r.party_id = p.id and r.role = 'client') then 'client'
      when exists (select from party_role r where r.party_id = p.id and r.role = 'attorney') then 'attorney'
      when exists (select from party_role r where r.party_id = p.id and r.role = 'lender') then 'lender'
      when exists (select from party_role r where r.party_id = p.id and r.role = 'landlord_rep') then 'landlord_side'
      when exists (select from party_role r where r.party_id = p.id and r.role = 'vendor') then 'other_vendor' else null end) as person
    from addresses a left join contacts c on c.address = a.address left join party p on p.id = c.party_id
    cross join lateral (select coalesce(jsonb_agg(distinct pc.company_id), '[]') as ids from party_company pc
     join party_role cr on cr.party_id = pc.company_id and cr.role = 'client' where pc.person_id = p.id and pc.ended_on is null) clients
   ), participants as (
    select m.id, s.person || jsonb_build_object('name', coalesce(s.person->>'name', m.sender_name)) as sender,
     coalesce((select jsonb_agg(p.person || jsonb_build_object('kind', r.kind) order by r.position)
      from email_recipient r join people p on p.address = r.address where r.activity_id = m.id), '[]') as recipients
    from mail m join people s on s.address = m.sender
   ), queued as (
    select e.id, e.happened_at, jsonb_build_object('activity_id', e.id, 'message_id', e.message_id,
     'happened_at', e.happened_at, 'outgoing', exists (select from party_email pe join app_user u on u.id = pe.party_id where pe.address = e.sender),
     'mailbox_user', ${userSlug}::text, 'subject', e.subject, 'body', e.body, 'conversation_id', e.conversation_id,
     'lead_source', exists (select from lead_email_source s where s.activity_id = e.id),
     'sender', p.sender, 'recipients', p.recipients,
     'about', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('deal_id', deal_id, 'party_id', party_id, 'property_id', property_id))) from activity_about where activity_id = e.id), '[]'),
     'suppressed_deal_ids', coalesce((select jsonb_agg(distinct removed.old_value->>'deal_id') from change removed
      where removed.table_name = 'activity_about' and removed.action = 'delete' and removed.changed_by_user_id is not null
       and removed.old_value->>'activity_id' = e.id::text and removed.old_value->>'deal_id' is not null
       and exists (select from change ins where ins.table_name = 'activity_about' and ins.action = 'insert'
        and ins.record = removed.record and ins.changed_by_job = 'mail_capture')), '[]'),
     'thread', coalesce((select jsonb_agg(jsonb_build_object('activity_id', old.id, 'deal_id', old.deal_id,
      'happened_at', old.happened_at, 'subject', old.subject, 'conversation_id', old.conversation_id,
      'sender', prior.sender, 'recipients', prior.recipients) order by old.happened_at, old.id)
      from thread_entries old join participants prior using (id)
      where old.queued_id = e.id), '[]'),
     'deals', coalesce((select jsonb_agg(jsonb_build_object('deal_id', d.deal_id, 'name', d.name, 'phase', d.phase, 'kind', d.kind)) from open_deals d join activity_about aa on aa.deal_id = d.deal_id where aa.activity_id = e.id), '[]')) as email
    from page e join participants p using (id)
   ) select jsonb_build_object('emails', coalesce((select jsonb_agg(email order by happened_at, id) from queued), '[]'),
    'open_deals', coalesce((select jsonb_agg(to_jsonb(d) order by deal_id) from open_deals d), '[]'),
    'next_cursor', case when (select count(*) from queued_mail) > ${limit} then (select id from page order by happened_at desc, id desc limit 1) end) as answer`.execute(
						tx,
					);
					return rows[0]?.answer ?? {};
				}),
			);
		} catch (error) {
			if (error instanceof SaveRefusal) return refuse(c, error.refusal);
			return refuse(c, new Refusal(503, "database_unavailable"));
		}
	},
);
