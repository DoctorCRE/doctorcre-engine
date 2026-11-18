import { type RawBuilder, sql, type Transaction } from "kysely";
import { jsonObjectFrom } from "kysely/helpers/postgres";
import { isoMillis, Refusal } from "./answer.ts";
import type { DB } from "./next-database.d.ts";

type ReviewRow = {
	id: string;
	source_version: string;
	source_change_id: string;
	activity_at: string;
	title: string;
	context_label: string | null;
	open_url: string | null;
};

type DraftStatus = "pending" | "approved" | "failed" | "sent";

type Draft = ReviewRow & {
	status: DraftStatus;
	mail_group: string;
	member_ids: string[] | null;
	suggestions: SuggestionReference[] | null;
	due_on: string | null;
	sent_at: string | null;
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
		fallback_reply_draft: {
			id: string;
			version: string;
			status: "approved" | "failed";
			failure_reason: string | null;
		} | null;
		suggestions: SuggestionReference[];
		member_ids: string[];
	};

const mailGroup = sql`coalesce('conversation:' || e.conversation_id, 'email:' || e.activity_id)`;

function draftRows(userId: string) {
	return sql`
		with drafts as (
			select r.id, r.status, r.sent_at, r.failure_reason, r.revision::text as source_version,
				(select coalesce(max(id), 0) from change where table_name = 'reply_draft'
					and record = jsonb_build_object('id', r.id)) as draft_change_id,
				${mailGroup} as mail_group,
				coalesce(r.sent_at, r.changed_at) as activity_at, e.activity_id as email_activity_id, d.id as deal_id,
				'Reply to ' || coalesce(nullif(btrim(e.sender_name), ''), e.sender::text) || ': ' || r.subject as title,
				coalesce(d.name, nullif(btrim(e.sender_name), ''), e.sender::text) as context_label,
				'/deals?deal=' || d.id as open_url,
				row_number() over (
					partition by (r.status = 'sent'), e.conversation_id,
						case when e.conversation_id is null or r.status = 'sent' then e.activity_id end
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
			where r.owner_user_id = ${userId}::uuid and (
				r.status in ('pending', 'approved', 'failed')
				or r.sent_at >= now() - interval '7 days'
			)
		)
		select * from drafts where position = 1
	`;
}

const visibleSuggestion = (userId: string) => sql<boolean>`
	case
		when p.kind = 'next_step' and p.owner_party_id is not null then p.owner_party_id = ${userId}::uuid
		when p.kind = 'log_call' then ${userId}::uuid in (a.changed_by_user_id, a.changed_for_user_id)
		else p.changed_for_user_id = ${userId}::uuid
			or (p.status <> 'pending' and exists (
				select from change where table_name = 'proposal' and action = 'insert'
					and record = jsonb_build_object('id', p.id) and changed_for_user_id = ${userId}::uuid
			))
			or exists (select from email_mailbox m where m.activity_id = a.id and m.user_id = ${userId}::uuid)
			or (p.activity_kind in ('call', 'meeting')
				and ${userId}::uuid in (a.changed_by_user_id, a.changed_for_user_id))
	end
`;

export async function readProposal(
	db: Transaction<DB>,
	userId: string,
	id: string,
) {
	const proposal = await db
		.selectFrom("proposal as p")
		.innerJoin("activity as a", "a.id", "p.activity_id")
		.leftJoin("next_step as step", "step.id", "p.next_step_id")
		.leftJoin("deal as d", "d.id", "p.deal_id")
		.leftJoin("party", "party.id", "p.party_id")
		.leftJoin("property", "property.id", "p.property_id")
		.select([
			"p.id as proposal_id",
			"p.kind",
			"p.evidence",
			"p.next_step_id",
			"p.deal_id",
			"p.party_id",
			"p.property_id",
			"p.owner_party_id",
			"p.from_phase",
			"p.to_phase",
			"p.phase_on",
			"p.from_stage",
			"p.to_stage",
			"p.how_found",
			"p.strength",
			"p.reason",
		])
		.select((eb) => [
			eb.fn.coalesce("p.what", "step.what").as("what"),
			eb.fn.coalesce("p.due_on", "step.due_on").as("due_on"),
			eb.fn
				.coalesce("d.name", "party.name", "property.name", "property.address")
				.as("target_name"),
			jsonObjectFrom(
				eb
					.selectFrom("activity as source")
					.leftJoin("email as e", "e.activity_id", "source.id")
					.whereRef("source.id", "=", "a.id")
					.select((source) => [
						"source.id",
						"source.kind",
						"source.summary",
						"e.sender",
						"e.sender_name",
						"e.subject",
						"e.body",
						isoMillis(source.ref("source.happened_at")).as("happened_at"),
					]),
			).as("source_activity"),
		])
		.where("p.id", "=", id)
		.where("p.status", "=", "pending")
		.where(sql<boolean>`case when p.kind = 'next_step_done'
			then step.owner_party_id = ${userId}::uuid and step.status = 'open'
			else ${visibleSuggestion(userId)} end`)
		.executeTakeFirst();
	return proposal ?? new Refusal(404, "not_found");
}

function suggestionRows(userId: string, forMail: boolean) {
	return sql`
		with visible as (
			select p.id, p.status, p.activity_id, p.activity_kind, p.created_at as activity_at, p.due_on,
				(select coalesce(max(id), 0) from change where table_name = 'proposal'
					and record = jsonb_build_object('id', p.id)) as proposal_version,
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
				${mailGroup} as mail_group,
				jsonb_build_object(
					'id', p.id, 'kind', p.kind, 'activity_id', p.activity_id,
					'activity_kind', p.activity_kind, 'deal_id', p.deal_id, 'party_id', p.party_id,
					'property_id', p.property_id, 'candidate_id', p.candidate_id
				) as reference
			from proposal p
			left join activity a on a.id = p.activity_id
			left join email e on e.activity_id = a.id
			left join party contact on contact.id = a.from_party_id
			left join deal d on d.id = p.deal_id
			left join party on party.id = p.party_id
			left join property on property.id = p.property_id
			left join phase on phase.slug = p.to_phase
			where p.kind not in ('next_step_done', 'email_lead')
				and ${visibleSuggestion(userId)}
		), grouped as (
			select visible.*,
				coalesce(first_value(email_title) over latest_source, suggestion_title) as title,
				first_value(activity_id) over latest_source as latest_activity_id,
				row_number() over same_source as position,
				max(proposal_version) over source_group as suggestion_change_id,
				array_agg(id) over all_members as member_ids,
				md5(string_agg(id::text, ':') filter (where status = 'pending') over all_members) as source_version,
				jsonb_agg(${forMail ? sql`reference || jsonb_build_object('suggestion_title', suggestion_title, 'due_on', due_on)` : sql`reference`})
					filter (where status = 'pending') over all_members as suggestions
			from visible
			window source_group as (
				partition by activity_kind, conversation_id,
					case when conversation_id is null then coalesce(activity_id, id) end
			), latest_source as (source_group order by (status = 'pending') desc, source_at desc, activity_id desc),
			same_source as (source_group order by (status = 'pending') desc, activity_at desc, id),
			all_members as (same_source rows between unbounded preceding and unbounded following)
		)
		select * from grouped where position = 1 and status = 'pending'
	`;
}

function homeReviewGroups(userId: string, forMail = false) {
	return sql`
		with draft_groups as (${draftRows(userId)}),
		suggestion_groups as (${suggestionRows(userId, forMail)}),
		draft_cards as (
			select d.*, greatest(d.draft_change_id, s.suggestion_change_id) as source_change_id,
				s.suggestions, s.member_ids, s.due_on
			from draft_groups d
			left join suggestion_groups s on s.mail_group = d.mail_group and d.status <> 'sent'
			where d.status in ('pending', 'sent') or s.id is null
		), suggestion_cards as (
			select s.*, greatest(s.suggestion_change_id, d.draft_change_id) as source_change_id,
				case when d.id is not null then jsonb_build_object('id', d.id, 'version', d.source_version,
					'status', d.status, 'failure_reason', d.failure_reason) end as fallback_reply_draft
			from suggestion_groups s
			left join draft_groups d on d.mail_group = s.mail_group and d.status <> 'sent'
			where d.status is distinct from 'pending'
		)
	`;
}

function draftCards(userId: string, limit: number, itemId?: string) {
	return sql<Draft>`
		${homeReviewGroups(userId)}
		select * from draft_cards
		${itemId ? sql`where id = ${itemId} and status <> 'sent'` : sql``}
		order by (status = 'sent'), activity_at desc, id limit ${limit}
	`;
}

function suggestionCards(userId: string, limit: number, itemId?: string) {
	return sql<Suggestion>`
		${homeReviewGroups(userId)}
		select * from suggestion_cards
		${itemId ? sql`where id = ${itemId}` : sql``}
		order by activity_at desc, id limit ${limit}
	`;
}

type ReviewSource = "email_proposal" | "capture_session" | "notification";
type ReviewState = "working" | "failed" | "needs_attention" | "done";
type ReviewKind = "proposal" | "reply_draft";
type ReviewMark = {
	mark_item_id: string;
	mark_version: string | null;
	settled: boolean;
	snoozed_until: string | null;
};

function markedReviews<Row extends ReviewRow>(
	rows: RawBuilder<Row>,
	userId: string,
	kind: ReviewKind,
) {
	return sql<Row & ReviewMark>`
		select card.*, history.mark_version, coalesce(history.item_id, card.id) as mark_item_id,
			coalesce(m.disposition = 'settled' and history.settled_version >= card.source_change_id, false) as settled,
			case when m.snoozed_until > now() then m.snoozed_until end as snoozed_until
		from (${rows}) card
		left join lateral (
			select member.item_id, max(h.id) as mark_version,
				max(h.id) filter (where h.new_value ->> 'disposition' = 'settled') as settled_version
			from unnest(${kind === "proposal" ? sql`card.member_ids` : sql`array[card.id]`}) member(item_id)
			join change h on h.table_name = 'home_mark'
				and h.record = jsonb_build_object('user_id', ${userId}::uuid, 'item_kind', ${kind}::text, 'item_id', member.item_id)
			group by member.item_id order by mark_version desc limit 1
		) history on true
		left join home_mark m on m.user_id = ${userId}::uuid
			and m.item_kind = ${kind} and m.item_id = coalesce(history.item_id, card.id)
	`;
}

export async function lockHomeReview(
	tx: Transaction<DB>,
	kind: ReviewKind,
	id: string,
	userId: string,
) {
	const query = kind === "reply_draft" ? draftCards : suggestionCards;
	const {
		rows: [group],
	} = await query(userId, 1, id).execute(tx);
	if (!group) return;
	const draftId =
		"fallback_reply_draft" in group ? group.fallback_reply_draft?.id : group.id;
	if (draftId) {
		await tx
			.selectFrom("reply_draft")
			.select("id")
			.where("id", "=", draftId)
			.forNoKeyUpdate()
			.execute();
	}
	if (group.member_ids) {
		await tx
			.selectFrom("proposal")
			.select("id")
			.where("id", "in", group.member_ids)
			.orderBy("id")
			.forNoKeyUpdate()
			.execute();
	}
	const {
		rows: [card],
	} = await markedReviews<ReviewRow>(
		query(userId, 1, id),
		userId,
		kind,
	).execute(tx);
	return (
		card && {
			source_version: card.source_change_id,
			mark_item_id: card.mark_item_id,
		}
	);
}

function reviewCard(
	row: ReviewRow & ReviewMark,
	kind: ReviewKind,
	source_type: ReviewSource,
	source_state: ReviewState,
	completed_at: string | null = null,
) {
	const snoozed_until =
		row.snoozed_until && !completed_at
			? new Date(row.snoozed_until).toISOString()
			: null;
	const disposition =
		completed_at || row.settled
			? "settled"
			: snoozed_until
				? "snoozed"
				: "inbox";
	return {
		item_id: `${kind === "proposal" ? "suggestion" : kind}:${row.id}`,
		source_type,
		source_id: row.id,
		source_version: row.source_version,
		source_state,
		base_version: `${row.source_change_id}:${row.mark_version ?? "0"}:${disposition}`,
		title: row.title,
		activity_at: new Date(row.activity_at).toISOString(),
		completed_at: completed_at ? new Date(completed_at).toISOString() : null,
		hold_until: null,
		snoozed_until,
		disposition,
		section: source_state === "working" ? "working" : disposition,
		unseen: false,
		explicit_unsettle: false,
		auto_settled: source_state === "done",
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
	const drafts = await markedReviews(
		draftCards(userId, limit),
		userId,
		"reply_draft",
	).execute(db);
	const suggestions = await markedReviews(
		suggestionCards(userId, limit),
		userId,
		"proposal",
	).execute(db);
	return [
		...drafts.rows.map((draft) => ({
			...reviewCard(
				draft,
				"reply_draft",
				"email_proposal",
				draft.status === "sent"
					? "done"
					: draft.status === "approved"
						? "working"
						: draft.status === "failed"
							? "failed"
							: "needs_attention",
				draft.sent_at,
			),
			kind_label: "Reply draft",
			deal_id: null,
			due_on: draft.due_on,
			merged_source_ids: [
				draft.id,
				...(draft.suggestions?.map(({ id }) => id) ?? []),
			],
			...(draft.suggestions && { suggestions: draft.suggestions }),
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
				...reviewCard(suggestion, "proposal", sourceType, "needs_attention"),
				title: call
					? `${suggestion.title}: ${suggestion.suggestions.length} ${suggestion.suggestions.length === 1 ? "suggestion" : "suggestions"}`
					: suggestion.title,
				kind_label: call ? "Call" : "Task",
				deal_id: null,
				due_on: suggestion.due_on,
				proposal_id: suggestion.id,
				merged_source_ids: suggestion.suggestions.map(({ id }) => id),
				suggestions: suggestion.suggestions,
				...(suggestion.fallback_reply_draft && {
					fallback_reply_draft: suggestion.fallback_reply_draft,
				}),
				source_activity: suggestion.activity_id
					? { kind: suggestion.activity_kind, id: suggestion.activity_id }
					: null,
			};
		}),
	];
}

type MailPriority = {
	item_id: string;
	base_version: string;
	suggestion: string;
	due_on: string | null;
	review_activity_id: string;
	review_happened_at: string;
	conversation_id: string | null;
	sender: string;
	subject: string;
} & (
	| {
			kind: "next_step" | "file_to_deal" | "possible_new_deal" | "phase_move";
			proposal_id: string;
			reply_draft_id: null;
	  }
	| { kind: "reply_draft"; proposal_id: null; reply_draft_id: string }
);

export async function readHomeMailPriorities(
	db: Transaction<DB>,
	userId: string,
) {
	const limit = 25;
	const suggestions = markedReviews(
		sql<Suggestion>`select * from suggestion_cards`,
		userId,
		"proposal",
	);
	const drafts = markedReviews(
		sql<Draft>`select * from draft_cards`,
		userId,
		"reply_draft",
	);
	const { rows } = await sql<MailPriority>`
		${homeReviewGroups(userId, true)}, marked_drafts as (${drafts}),
		cards as (
			select case when draft.id is not null then 'reply_draft:' || draft.id
					else 'suggestion:' || card.id end as item_id,
				coalesce(draft.source_change_id, standalone.source_change_id) as source_change_id,
				case when draft.id is not null then draft.mark_version else standalone.mark_version end as mark_version,
				coalesce(draft.email_activity_id, card.latest_activity_id) as title_activity_id,
				case when draft.id is null then ref.id end as proposal_id, draft.id as reply_draft_id,
				case when draft.id is not null then 'reply_draft' else ref.kind end as kind,
				ref.activity_id, coalesce(draft.email_activity_id, ref.activity_id) as review_activity_id,
				ref.due_on,
				case when draft.id is not null then 'Review reply draft' else ref.suggestion_title end as suggestion
			from suggestion_groups card
			left join marked_drafts draft on draft.mail_group = card.mail_group and draft.status = 'pending'
			left join (${suggestions}) standalone on standalone.id = card.id
			cross join lateral jsonb_to_recordset(card.suggestions)
				ref(id uuid, kind text, activity_id uuid, due_on date, suggestion_title text)
			where card.activity_kind = 'email'
				and case when draft.id is not null then not draft.settled and draft.snoozed_until is null
					else not standalone.settled and standalone.snoozed_until is null end
				and ref.kind in ('next_step', 'file_to_deal', 'possible_new_deal', 'phase_move')
			union all
			select 'reply_draft:' || card.id, card.source_change_id, card.mark_version,
				card.email_activity_id, null, card.id, 'reply_draft', card.email_activity_id, card.email_activity_id, null, 'Review reply draft'
			from marked_drafts card
			where card.status = 'pending' and not card.settled and card.snoozed_until is null
		), ranked as (
			select cards.*, e.conversation_id, a.happened_at, review.happened_at as review_happened_at,
				coalesce(nullif(btrim(title_email.sender_name), ''), title_email.sender::text) as sender,
				coalesce(nullif(btrim(title_email.subject), ''), 'No subject') as subject,
				row_number() over (
					partition by e.conversation_id, case when e.conversation_id is null then e.activity_id end
					order by cards.due_on nulls last, a.happened_at, coalesce(cards.proposal_id, cards.reply_draft_id)
				) as position
			from cards
			join email e on e.activity_id = cards.activity_id
			join email title_email on title_email.activity_id = cards.title_activity_id
			join activity a on a.id = e.activity_id
			join activity review on review.id = cards.review_activity_id
			where not exists (
				select from party_email pe join app_user u on u.id = pe.party_id where pe.address = e.sender
			)
		)
		select item_id, source_change_id || ':' || coalesce(mark_version, 0) || ':inbox' as base_version,
			proposal_id, reply_draft_id, kind, suggestion, due_on,
			conversation_id, sender, subject, review_activity_id, review_happened_at
		from ranked where position = 1
		order by due_on nulls last, happened_at, item_id
		limit ${limit + 1}
	`.execute(db);
	return {
		ok: true,
		schema_version: "home-mail-priorities.v1",
		items: rows
			.slice(0, limit)
			.map(
				({
					review_activity_id,
					review_happened_at,
					sender,
					subject,
					...row
				}) => ({
					...row,
					title: `${sender} · ${subject}`,
					sender,
					subject,
					source_activity: {
						kind: "email",
						id: review_activity_id,
						happened_at: new Date(review_happened_at).toISOString(),
					},
				}),
			),
		more: rows.length > limit,
	};
}
