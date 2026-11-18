import { sql, type Transaction } from "kysely";
import type { DB } from "./next-database.d.ts";

type DealNotice = {
	id: string;
	deal_id: string;
	deal_name: string;
	title: string;
	due_on: string | null;
	activity_at: string;
};

function noticeCard(
	notice: DealNotice,
	{
		item_id,
		open_url,
		kind_label,
		source_version,
		mark_version,
		snoozed_until = null,
		settled = false,
	}: {
		item_id: string;
		open_url: string;
		kind_label: "Task" | "Update";
		source_version: string;
		mark_version: string;
		snoozed_until?: string | null;
		settled?: boolean;
	},
) {
	const disposition = settled ? "settled" : snoozed_until ? "snoozed" : "inbox";
	return {
		item_id,
		source_type: "notification",
		source_id: notice.id,
		source_version,
		source_state: "needs_attention",
		base_version: `${source_version}:${mark_version}:${disposition}`,
		title: notice.title,
		activity_at: new Date(notice.activity_at).toISOString(),
		completed_at: null,
		hold_until: null,
		due_on: notice.due_on,
		snoozed_until: snoozed_until ? new Date(snoozed_until).toISOString() : null,
		disposition,
		section: disposition,
		unseen: true,
		explicit_unsettle: false,
		auto_settled: false,
		context_label: notice.deal_name,
		open_url,
		kind_label,
		action_id: null,
		action_version: null,
		deal_id: notice.deal_id,
		merged_source_ids: [notice.id],
		waiting_version: 0,
		waiting_on: null,
	};
}

type CompletionReview = DealNotice & {
	next_step_id: string;
	can_resolve: boolean;
	activity_id: string;
	activity_kind: "note" | "call" | "meeting";
	happened_at: string;
	summary: string | null;
	evidence: string;
};

export async function readCompletionReviews(
	db: Transaction<DB>,
	stepIds: string[],
) {
	const { rows } = await sql<CompletionReview>`
		with latest as (
			select distinct on (p.next_step_id) p.*
			from proposal p
			where p.kind = 'next_step_done' and p.next_step_id = any(${stepIds}::uuid[])
			order by p.next_step_id, p.created_at desc, p.id desc
		)
		select p.id, p.next_step_id, p.deal_id, d.name as deal_name,
			s.what as title, s.due_on, p.created_at as activity_at,
			s.changed_at = p.step_seen_at as can_resolve,
			a.id as activity_id, a.kind as activity_kind, a.happened_at, a.summary, p.evidence
		from latest p
		join next_step s on s.id = p.next_step_id
		join deal d on d.id = p.deal_id
		join activity a on a.id = p.activity_id
		where p.status = 'pending'
	`.execute(db);
	return new Map(rows.map((row) => [row.next_step_id, row]));
}

export function completionReviewCard(
	review: CompletionReview,
	stepVersion: string,
	markVersion: string | null,
) {
	return {
		...noticeCard(review, {
			item_id: `next_step_done:${review.id}`,
			open_url: `/deals?deal=${review.deal_id}&focus=next-step`,
			kind_label: "Task",
			source_version: stepVersion,
			mark_version: markVersion ?? "0",
		}),
		title: `Did this happen? ${review.title}`,
		completion_review: {
			proposal_id: review.id,
			next_step_id: review.next_step_id,
			can_resolve: review.can_resolve,
		},
		source_activity: {
			kind: review.activity_kind,
			id: review.activity_id,
			happened_at: new Date(review.happened_at).toISOString(),
			summary: review.summary,
			quote: review.evidence,
		},
	};
}

type HomeUpdate = DealNotice & {
	checklist_item_ref: string | null;
	source_version: string;
	mark_version: string;
	snoozed_until: string | null;
	settled: boolean;
};

export async function readHomeUpdates(
	db: Transaction<DB>,
	userId: string,
	limit: number,
) {
	const { rows } = await sql<HomeUpdate>`
		select u.id, u.deal_id, d.name as deal_name, u.what as title, u.due_on,
			u.created_at as activity_at, u.checklist_item_ref,
			coalesce(update_change.id, 0)::text as source_version,
			coalesce(mark_change.id, 0)::text as mark_version,
			case when m.snoozed_until > now() then m.snoozed_until end as snoozed_until,
			coalesce(m.disposition = 'settled'
				and coalesce(mark_change.disposition_id, 0) >= coalesce(update_change.id, 0), false) as settled
		from home_update u
		join deal d on d.id = u.deal_id
		left join home_mark m on (m.user_id, m.item_kind, m.item_id) = (u.user_id, 'home_update', u.id)
		cross join lateral (
			select max(id) as id from change
			where table_name = 'home_update' and record = jsonb_build_object('id', u.id)
		) update_change
		cross join lateral (
			select max(id) as id, max(id) filter (
				where old_value->>'disposition' is distinct from new_value->>'disposition'
			) as disposition_id from change
			where table_name = 'home_mark'
				and record = jsonb_build_object('user_id', u.user_id, 'item_kind', 'home_update', 'item_id', u.id)
		) mark_change
		where u.user_id = ${userId}::uuid and u.read_at is null
		order by u.created_at desc, u.id
		limit ${limit}
	`.execute(db);
	return rows.map((update) => ({
		...noticeCard(update, {
			item_id: `notification:${update.id}`,
			open_url: `/deals?deal=${update.deal_id}`,
			kind_label: "Update",
			source_version: update.source_version,
			mark_version: update.mark_version,
			snoozed_until: update.snoozed_until,
			settled: update.settled,
		}),
		checklist_item_ref: update.checklist_item_ref,
	}));
}
