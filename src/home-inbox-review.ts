import { sql, type Transaction } from "kysely";
import type { DB } from "./next-database.d.ts";
import { pendingProposals } from "./pending-proposals.ts";

type ReviewRow = {
	id: string;
	source_version: string;
	activity_at: string;
	title: string;
	context_label: string | null;
	open_url: string | null;
};

type Draft = ReviewRow & {
	status: "pending" | "approved" | "failed";
	failure_reason: string | null;
	email_activity_id: string;
	deal_id: string | null;
};

type SuggestionReference = {
	id: string;
	kind: string;
	activity_id: string | null;
	activity_kind: "email" | "call" | "meeting" | null;
	deal_id: string | null;
	party_id: string | null;
	property_id: string | null;
	candidate_id: string | null;
};

type Suggestion = ReviewRow &
	Pick<SuggestionReference, "activity_id" | "activity_kind"> & {
		due_on: string | null;
		suggestions: SuggestionReference[];
	};

function draftRows(userId: string, limit: number) {
	return sql<Draft>`
		with drafts as (
			select r.id, r.status, r.revision::text as source_version, r.failure_reason,
				r.changed_at as activity_at, e.activity_id as email_activity_id, d.id as deal_id,
				'Reply to ' || coalesce(nullif(btrim(e.sender_name), ''), e.sender::text) || ': ' || r.subject as title,
				coalesce(d.name, nullif(btrim(e.sender_name), ''), e.sender::text) as context_label,
				'/deals?deal=' || d.id as open_url,
				row_number() over (
					partition by e.conversation_id, case when e.conversation_id is null then e.activity_id end
					order by (r.status = 'approved') desc, a.happened_at desc, a.id desc
				) as position
			from reply_draft r
			join email e on e.activity_id = r.email_activity_id
			join activity a on a.id = e.activity_id
			left join deal d on d.id = (
				select (array_agg(about.deal_id))[1]
				from activity_about about
				where about.activity_id = a.id and about.deal_id is not null
				having count(*) = 1
			)
			where r.owner_user_id = ${userId}::uuid and r.status in ('pending', 'approved', 'failed')
		)
		select * from drafts where position = 1
		order by activity_at desc, id
		limit ${limit}
	`;
}

function suggestionRows(db: Transaction<DB>, userId: string, limit: number) {
	return sql<Suggestion>`
		with pending as (
			select p.id, p.activity_id, p.activity_kind, p.created_at as activity_at, p.due_on,
				coalesce(d.name, party.name, property.name, property.address,
					nullif(btrim(e.sender_name), ''), e.sender::text) as context_label,
				case when p.activity_kind = 'call' then '/calls?session=' || a.id
					when d.id is not null then '/deals?deal=' || d.id
					when party.id is not null then '/relationships?node=party:' || party.id end as open_url,
				case
					when p.activity_kind = 'call' then 'Call' || coalesce(' with ' || contact.name, '')
						|| ' on ' || to_char(a.happened_at at time zone 'America/Chicago', 'Dy, Mon FMDD')
					when p.kind = 'next_step' then p.what
					when p.kind = 'phase_move' then 'Move to ' || phase.label
					when p.kind = 'file_to_deal' then 'File email to ' || d.name
					when p.kind = 'possible_new_deal' then 'Review possible new deal'
					when p.kind = 'lead_stage_move' then 'Review lead stage'
					else 'Review new lead'
				end as suggestion_title,
				case when e.activity_id is not null then
					concat_ws(' · ', coalesce(nullif(btrim(e.sender_name), ''), e.sender::text), nullif(btrim(e.subject), ''))
				end as email_title,
				a.happened_at as source_at,
				e.conversation_id,
				jsonb_build_object(
					'id', p.id, 'kind', p.kind, 'activity_id', p.activity_id,
					'activity_kind', p.activity_kind, 'deal_id', p.deal_id, 'party_id', p.party_id,
					'property_id', p.property_id, 'candidate_id', p.candidate_id
				) as reference
			from ${pendingProposals(db).selectAll().as("p")}
			left join activity a on a.id = p.activity_id
			left join email e on e.activity_id = a.id
			left join party contact on contact.id = a.from_party_id
			left join deal d on d.id = p.deal_id
			left join party on party.id = p.party_id
			left join property on property.id = p.property_id
			left join phase on phase.slug = p.to_phase
			where p.kind not in ('next_step_done', 'email_lead')
				and case
					when p.kind = 'next_step' and p.owner_party_id is not null then p.owner_party_id = ${userId}::uuid
					when p.kind = 'log_call' then ${userId}::uuid in (a.changed_by_user_id, a.changed_for_user_id)
					else p.changed_for_user_id = ${userId}::uuid
						or exists (select from email_mailbox m where m.activity_id = e.activity_id and m.user_id = ${userId}::uuid)
						or (p.activity_kind in ('call', 'meeting')
							and ${userId}::uuid in (a.changed_by_user_id, a.changed_for_user_id))
				end
		), grouped as (
			select pending.*,
				coalesce(first_value(email_title) over (source_group order by source_at desc, activity_id desc), suggestion_title) as title,
				row_number() over same_source as position,
				md5(string_agg(id::text, ':') over all_members) as source_version,
				jsonb_agg(reference) over all_members as suggestions
			from pending
			window source_group as (
				partition by activity_kind, conversation_id,
					case when conversation_id is null then coalesce(activity_id, id) end
			), same_source as (source_group order by activity_at desc, id),
			all_members as (same_source rows between unbounded preceding and unbounded following)
		)
		select * from grouped where position = 1
		order by activity_at desc, id
		limit ${limit}
	`;
}

type ReviewSource = "email_proposal" | "capture_session" | "notification";
type ReviewState = "working" | "failed" | "needs_attention";

function reviewCard(
	row: ReviewRow,
	source_type: ReviewSource,
	source_state: ReviewState,
) {
	return {
		item_id: `${source_type}:${row.id}`,
		source_type,
		source_id: row.id,
		source_version: row.source_version,
		source_state,
		base_version: `${row.source_version}:0:inbox`,
		title: row.title,
		activity_at: new Date(row.activity_at).toISOString(),
		completed_at: null,
		hold_until: null,
		snoozed_until: null,
		disposition: "inbox",
		section: source_state === "working" ? "working" : "inbox",
		unseen: false,
		explicit_unsettle: false,
		auto_settled: false,
		context_label: row.context_label,
		open_url: row.open_url,
		action_id: null,
		action_version: null,
		waiting_version: 0,
		waiting_on: null,
	};
}

export async function readHomeReviewCards(
	db: Transaction<DB>,
	userId: string,
	limit: number,
) {
	const drafts = await draftRows(userId, limit).execute(db);
	const suggestions = await suggestionRows(db, userId, limit).execute(db);
	return [
		...drafts.rows.map((draft) => ({
			...reviewCard(
				draft,
				"email_proposal",
				draft.status === "approved"
					? "working"
					: draft.status === "failed"
						? "failed"
						: "needs_attention",
			),
			kind_label: "Reply draft",
			deal_id: null,
			due_on: null,
			merged_source_ids: [draft.id],
			reply_draft_id: draft.id,
			reply_draft_status: draft.status,
			failure_reason: draft.failure_reason,
			source_activity: {
				kind: "email",
				id: draft.email_activity_id,
				deal_id: draft.deal_id,
			},
		})),
		...suggestions.rows.map((suggestion) => {
			const call = suggestion.activity_kind === "call";
			const sourceType = call
				? "capture_session"
				: suggestion.activity_kind === "meeting"
					? "notification"
					: "email_proposal";
			return {
				...reviewCard(suggestion, sourceType, "needs_attention"),
				title: call
					? `${suggestion.title}: ${suggestion.suggestions.length} ${suggestion.suggestions.length === 1 ? "suggestion" : "suggestions"}`
					: suggestion.title,
				kind_label: call ? "Call" : "Task",
				deal_id: null,
				due_on: suggestion.due_on,
				proposal_id: suggestion.id,
				merged_source_ids: suggestion.suggestions.map(({ id }) => id),
				suggestions: suggestion.suggestions,
				source_activity: suggestion.activity_id
					? { kind: suggestion.activity_kind, id: suggestion.activity_id }
					: null,
			};
		}),
	];
}
