import { sql, type Transaction } from "kysely";
import {
	dealStepUrl,
	homeDate,
	homeDay,
	homeDisplayText,
	homeStepText,
	homeWhy,
} from "./home-steps.ts";
import { homeTitle } from "./home-title.ts";
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
		snoozed_until = null,
	}: {
		item_id: string;
		open_url: string;
		kind_label: "Task" | "Update" | "Tour feedback";
		source_version: string;
		snoozed_until?: string | null;
	},
) {
	const disposition = snoozed_until ? "snoozed" : "inbox";
	return {
		item_id,
		source_type: "notification",
		source_id: notice.id,
		source_version,
		source_state: "needs_attention",
		title: notice.title,
		activity_at: new Date(notice.activity_at).toISOString(),
		completed_at: null,
		hold_until: null,
		due_on: notice.due_on,
		snoozed_until: snoozed_until ? new Date(snoozed_until).toISOString() : null,
		disposition,
		section: disposition,
		unseen: true,
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

type CompletionReview = Omit<DealNotice, "title"> & {
	what: string;
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
			s.what, s.due_on, p.created_at as activity_at,
			s.changed_at = p.step_seen_at as can_resolve,
			a.id as activity_id, a.kind as activity_kind, a.happened_at, a.summary, p.evidence
		from latest p
		join next_step s on s.id = p.next_step_id
		join deal d on d.id = p.deal_id
		join activity a on a.id = p.activity_id
		where p.status = 'pending'
	`.execute(db);
	return new Map(
		rows.map((review) => [
			review.next_step_id,
			{ ...review, ...completionReviewText(review) },
		]),
	);
}

function completionReviewText(review: CompletionReview) {
	return {
		title: homeTitle("next_step_done", homeDisplayText(review.deal_name)),
		why: homeWhy(
			homeDisplayText(review.evidence) ||
				homeDisplayText(review.summary) ||
				`The ${review.activity_kind} was recorded on ${homeDate(review.happened_at)}`,
			homeStepText(review.what),
		),
	};
}

export function completionReviewCard(
	review: CompletionReview & { title: string; why: string },
	step: {
		item_id: string;
		base_version: string;
		source_version: string;
		action_version: number;
	},
) {
	const { item_id, base_version, source_version, action_version } = step;
	return {
		...noticeCard(review, {
			item_id,
			open_url: dealStepUrl(review.deal_id, review.next_step_id),
			kind_label: "Task",
			source_version,
		}),
		base_version,
		action_version,
		why: review.why,
		primary_action: "Review completion",
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
	kind: "update" | "tour_feedback";
	checklist_item_ref: string | null;
	checklist_item_title: string | null;
	property_id: string | null;
	property_label: string | null;
	source_version: string;
	mark_version: string;
	snoozed_until: string | null;
	waiting_reason: string | null;
};

function updateText(update: HomeUpdate) {
	const text = homeDisplayText(update.title);
	const deal = homeDisplayText(update.deal_name);
	if (update.kind === "tour_feedback") {
		const property = homeDisplayText(update.property_label);
		return {
			title: homeTitle("tour_feedback", deal, property),
			why: homeWhy(text, `Recorded ${homeDate(update.activity_at)}`),
			primary_action: "Review feedback",
		};
	}
	if (update.checklist_item_ref || update.due_on) {
		const item = homeStepText(update.checklist_item_title ?? update.title);
		return {
			title: homeTitle("checklist", deal),
			why: homeWhy(
				item,
				update.due_on ? `Due ${homeDate(update.due_on)}` : null,
			),
			primary_action: "Open checklist item",
		};
	}
	return {};
}

export async function readHomeUpdates(
	db: Transaction<DB>,
	userId: string,
	limit: number | null,
	dashboard: boolean,
) {
	const { rows } = await sql<HomeUpdate>`
		select u.id, u.deal_id, d.name as deal_name, u.kind, u.what as title, u.due_on,
			u.created_at as activity_at, u.checklist_item_ref, u.property_id,
			item.item_title as checklist_item_title,
			coalesce(property.name, property.address) as property_label,
			coalesce(update_change.id, 0)::text as source_version,
			coalesce(mark_change.id, 0)::text as mark_version,
			case when m.snoozed_until > now() then m.snoozed_until end as snoozed_until,
			m.waiting_reason
		from home_update u
		join deal d on d.id = u.deal_id
		left join next_step item on item.deal_id = u.deal_id
			and 'deal-item:' || item.id::text = u.checklist_item_ref
			and item.item_title is not null
		left join property on property.id = u.property_id
		left join home_mark m on (m.user_id, m.item_kind, m.item_id) = (u.user_id, 'home_update', u.id)
		cross join lateral (
			select max(id) as id from change
			where table_name = 'home_update' and record = jsonb_build_object('id', u.id)
		) update_change
		cross join lateral (
			select max(id) as id from change
			where table_name = 'home_mark'
				and record = jsonb_build_object('user_id', u.user_id, 'item_kind', 'home_update', 'item_id', u.id)
		) mark_change
		where u.user_id = ${userId}::uuid
			and u.read_at is null
			and m.disposition is distinct from 'dropped'
			${
				dashboard
					? sql`and (u.kind = 'tour_feedback' or u.checklist_item_ref is not null)
					and (item.status is null or item.status = 'open')
					and (item.due_on is null or item.due_on <= ${homeDay})`
					: sql`and (item.status is null or item.status not in ('done', 'cancelled'))`
			}
		order by u.created_at desc, u.id
		limit ${limit}
	`.execute(db);
	return rows.map((update) => {
		const tourFeedback = update.kind === "tour_feedback";
		const card = noticeCard(update, {
			item_id: `notification:${update.id}`,
			open_url:
				tourFeedback && update.property_id
					? `/deals?deal=${update.deal_id}&property=${update.property_id}`
					: `/deals?deal=${update.deal_id}`,
			kind_label: tourFeedback ? "Tour feedback" : "Update",
			source_version: update.source_version,
			snoozed_until: update.snoozed_until,
		});
		return {
			...card,
			...updateText(update),
			kind: update.kind,
			base_version: `${update.source_version}:${update.mark_version}:${card.disposition}`,
			checklist_item_ref: update.checklist_item_ref,
			...(dashboard && {
				waiting_reason: homeDisplayText(update.waiting_reason) || null,
				late_target: !tourFeedback,
			}),
			...(update.property_id && { property_id: update.property_id }),
		};
	});
}
