import { sql, type Transaction } from "kysely";
import type { DB } from "../next-database.d.ts";
import {
	copiedLeadIdentity,
	lastRecordedContacts,
	openPartySteps,
} from "./follow-up-reads.ts";

export type Cadence = { lead_days: number; vendor_days: number };
export const DEFAULT_CADENCE: Cadence = { lead_days: 45, vendor_days: 90 };

type Proposal = {
	subject_type: "lead" | "vendor";
	subject_id: string;
	party_id: string;
	ref: string | null;
	name: string;
	owner_id: string | null;
	anchor_on: string;
	basis: "created_at" | "last_contact";
	last_contact_on: string | null;
	next_action_date: string | null;
	client_id: string | null;
	interval_days: number;
	due_on: string;
	owner: string | null;
	days_overdue: number;
};

const LIMIT = 1000;
const OPEN_STAGES = [
	"new",
	"qualified",
	"outreach_active",
	"engaged",
	"nurture",
];

const today = sql`(now() at time zone 'America/Chicago')::date`;

const dueProposals = (cadence: Cadence, ownerSlug: string | null) =>
	sql<Proposal>`with subjects as (
		select r.role as subject_type, coalesce(legacy.value, p.id::text) as subject_id, p.id as party_id,
			coalesce(legacy.registry_ref, vendor.ref, legacy.value, p.id::text) as ref,
			p.name, r.owner_user_id as owner_id, u.slug as owner, c.party_id as client_id,
			(r.created_at at time zone 'America/Chicago')::date as created_on,
			(recorded.happened_at at time zone 'America/Chicago')::date as last_contact_on,
			steps.next_action_date,
			case r.role when 'lead' then ${cadence.lead_days}::int else ${cadence.vendor_days}::int end as interval_days
		from party_role r
		join party p on p.id = r.party_id
		left join app_user u on u.id = r.owner_user_id
		left join (${lastRecordedContacts}) recorded on recorded.party_id = p.id
		left join client c on r.role = 'lead' and c.party_id = coalesce(r.lead_client_id, p.id)
		left join lateral (${copiedLeadIdentity(sql.ref("p.id"))}) legacy on r.role = 'lead'
		left join lateral (
			select min(value) as ref from outside_id
			where party_id = p.id and source = 'old_system_ref' and value like 'V-%'
		) vendor on r.role = 'vendor'
		cross join lateral (
			select min(n.due_on) filter (where hint.value is not null) as next_action_date,
				count(*) filter (where hint.value is null) > 0 as has_open_step
			from (${openPartySteps(sql.ref("p.id"))}) n
			-- Only an untouched copied date overrides cadence.
			left join outside_id hint on r.role = 'lead' and hint.party_id = p.id
				and hint.source = 'old_system_lead'
				and n.id = md5('old_system:lead:' || hint.value || ':follow_up')::uuid
				and not exists (
					select from change ch where ch.table_name = 'next_step' and ch.action = 'update'
						and ch.record = jsonb_build_object('id', n.id)
				)
		) steps
		where ((r.role = 'lead' and r.stage = any(${OPEN_STAGES}::text[]))
			or (r.role = 'vendor' and r.disposition is null))
			and not exists (select from active_do_not_contact dnc where dnc.party_id = p.id)
			and coalesce(c.status, '') not in ('cold', 'paused')
			and (${ownerSlug}::text is null or u.slug = ${ownerSlug}::text)
			and not steps.has_open_step
			and (c.party_id = p.id or not exists (${openPartySteps(sql.ref("c.party_id"))}))
	), due as (
		select s.*, coalesce(last_contact_on, created_on) as anchor_on,
			coalesce(next_action_date, coalesce(last_contact_on, created_on) + interval_days) as due_on
		from subjects s
	)
	select d.subject_type, d.subject_id, d.party_id, d.ref, d.name, d.owner_id,
		to_char(d.anchor_on, 'YYYY-MM-DD') as anchor_on,
		case when d.last_contact_on is null then 'created_at' else 'last_contact' end as basis,
		to_char(d.last_contact_on, 'YYYY-MM-DD') as last_contact_on,
		d.next_action_date, d.client_id, d.interval_days,
		to_char(d.due_on, 'YYYY-MM-DD') as due_on, d.owner,
		${today} - d.due_on as days_overdue
	from due d
	where d.due_on <= ${today}
	order by d.due_on, d.subject_type, d.subject_id`;

// The parties of the vendors Quiet follow-ups proposes at the default cadence.
export const quietVendorParties = sql<{
	party_id: string;
}>`select q.party_id from (${dueProposals(DEFAULT_CADENCE, null)}) q where q.subject_type = 'vendor'`;

export async function readQuietFollowUps(
	db: Transaction<DB>,
	cadence: Cadence,
	ownerSlug: string | null,
) {
	const { rows } =
		await sql<Proposal>`${dueProposals(cadence, ownerSlug)} limit ${LIMIT + 1}`.execute(
			db,
		);
	if (rows.length > LIMIT) return { error: "limit_exceeded" } as const;
	return {
		schema_version: "quiet-follow-ups.v1",
		cadence,
		proposals: rows,
		sent: false,
		tasks_created: false,
	};
}
