import { type RawBuilder, sql, type Transaction } from "kysely";
import { jsonObjectFrom } from "kysely/helpers/postgres";
import { filingReviewNeeded } from "./activity/filing-evidence.ts";
import { isoMillis, Refusal } from "./answer.ts";
import {
	readHomeEmailThread,
	senderLabel,
	sourceInMailbox,
} from "./home-email-thread.ts";
import {
	homeDate,
	homeDisplayText,
	homeStepText,
	homeWhy,
} from "./home-steps.ts";
import { homeTitle } from "./home-title.ts";
import type { DB } from "./next-database.d.ts";

type ReviewRow = {
	id: string;
	source_version: string;
	source_change_id: string;
	activity_at: string;
	context_label: string | null;
	open_url: string | null;
	mail_card_id: string | null;
};

type DraftStatus = "pending" | "approved" | "failed" | "sent";

type EmailContext = {
	email_sender: string | null;
	email_at: string | null;
	email_summary: string | null;
	email_quote: string | null;
};

type Draft = ReviewRow &
	EmailContext & {
		status: DraftStatus;
		mail_group: string;
		member_ids: string[] | null;
		suggestions: SuggestionReference[] | null;
		due_on: string | null;
		late_target: boolean;
		sent_at: string | null;
		failure_reason: string | null;
		email_activity_id: string;
		email_at: string;
		deal_id: string | null;
	};

type SuggestionReference = {
	id: string;
	kind: keyof typeof emailActions;
	activity_id: string | null;
	activity_kind: "email" | "call" | "meeting" | null;
	deal_id: string | null;
	party_id: string | null;
	property_id: string | null;
	candidate_id: string | null;
};

type Suggestion = ReviewRow &
	EmailContext &
	Pick<SuggestionReference, "activity_kind" | "kind"> & {
		activity_id: string | null;
		source_at: string | null;
		contact_name: string | null;
		source_summary: string | null;
		evidence: string;
		decision_label: string | null;
		suggestion_title: string | null;
		due_on: string | null;
		late_target: boolean;
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
				${mailGroup} as mail_group, 'email:' || md5(${mailGroup}) as mail_card_id,
				coalesce(r.sent_at, r.changed_at) as activity_at, e.activity_id as email_activity_id, d.id as deal_id,
				a.happened_at as email_at, ${senderLabel("e")} as email_sender,
				case when strpos(e.body, r.evidence) > 0 then r.evidence end as email_quote,
				coalesce(d.name, ${senderLabel("e")}) as context_label,
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
			where r.owner_user_id = ${userId}::uuid
				and ${sourceInMailbox(sql.ref("r.email_activity_id"), userId)}
				and (
					r.status in ('pending', 'approved', 'failed')
					or r.sent_at >= now() - interval '7 days'
				)
		)
		select * from drafts where position = 1
	`;
}

const visibleSuggestion = (userId: string) => sql<boolean>`
	case
		when p.kind = 'file_to_deal' and p.status = 'pending'
			and not (${filingReviewNeeded(sql.ref("p.activity_id"), sql.ref("p.deal_id"))}) then false
		when p.kind = 'next_step' and p.owner_party_id is not null then p.owner_party_id = ${userId}::uuid
		when p.kind = 'email_lead' then p.changed_for_user_id = ${userId}::uuid
		when p.kind = 'log_call' then ${userId}::uuid in (a.changed_by_user_id, a.changed_for_user_id)
			or (p.proposed_by_job = 'old_system'
				and a.changed_by_user_id is null and a.changed_for_user_id is null
				and p.changed_for_user_id = ${userId}::uuid)
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
		.leftJoin("activity as a", "a.id", "p.activity_id")
		.leftJoin("candidate", "candidate.id", "p.candidate_id")
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
			sql<
				string | null
			>`case when p.activity_kind = 'email' then p.activity_id end`.as(
				"email_source_id",
			),
			eb.fn.coalesce("p.what", "step.what").as("what"),
			eb.fn.coalesce("p.due_on", "step.due_on").as("due_on"),
			eb.fn
				.coalesce(
					"d.name",
					"party.name",
					"property.name",
					"property.address",
					"candidate.name",
				)
				.as("target_name"),
			sql<
				string | null
			>`candidate.source_row #>> '{reading,evidence_quote}'`.as(
				"evidence_quote",
			),
			sql<string | null>`candidate.source_row #>> '{reading,applies_to}'`.as(
				"applies_to",
			),
			sql`case when candidate.id is not null then json_build_object(
					'kind', 'email', 'id', null, 'summary', null, 'subject', null, 'body', null,
					'sender', candidate.source_row->>'address', 'sender_name', candidate.name,
					'happened_at', candidate.source_row->>'first_seen_at'
				) else ${jsonObjectFrom(
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
				)} end`.as("source_activity"),
		])
		.where("p.id", "=", id)
		.where("p.status", "=", "pending")
		.where(sourceInMailbox(sql.ref("p.activity_id"), userId))
		.where(sql<boolean>`case when p.kind = 'next_step_done'
			then step.owner_party_id = ${userId}::uuid and step.status = 'open'
			else ${visibleSuggestion(userId)} end`)
		.executeTakeFirst();
	if (!proposal) return new Refusal(404, "not_found");
	const { email_source_id, ...detail } = proposal;
	return email_source_id
		? {
				...detail,
				thread: await readHomeEmailThread(db, userId, email_source_id),
			}
		: detail;
}

function suggestionRows(userId: string, forMail: boolean, dashboard: boolean) {
	return sql`
		with visible as (
			select p.id, p.kind, p.status, a.id as activity_id,
				case when lead_email.activity_id is not null then 'email' else a.kind end as activity_kind,
				p.created_at as activity_at, p.due_on,
				p.deal_id is not null or exists (
					select from party_role where party_id = p.party_id and role = 'vendor'
				) as late_target,
				contact.name as contact_name, a.summary as source_summary, p.evidence,
				coalesce(phase.label, lead_stage.label) as decision_label,
				(select coalesce(max(id), 0) from change where table_name = 'proposal'
					and record = jsonb_build_object('id', p.id)) as proposal_version,
				coalesce(d.name, party.name, property.name, property.address, candidate.name,
					${senderLabel("e")}) as context_label,
				case when p.activity_kind = 'call' then '/calls?session=' || a.id
					when d.id is not null then '/deals?deal=' || d.id
					when party.id is not null then '/relationships?node=party:' || party.id end as open_url,
				case
					when p.kind in ('next_step', 'log_call') then p.what
					when p.kind = 'phase_move' and a.kind in ('call', 'meeting')
						then 'Move ' || d.name || ' to ' || phase.label
					when p.kind = 'lead_stage_move' and a.kind in ('call', 'meeting')
						then 'Move ' || party.name || ' to ' || lead_stage.label
					when p.kind = 'new_lead' and a.kind in ('call', 'meeting')
						then 'Add ' || party.name || ' as a lead'
					when p.kind = 'phase_move' then 'Move to ' || phase.label
					when p.kind = 'file_to_deal' then 'File email to ' || d.name
					when p.kind = 'possible_new_deal' then 'Review possible new deal'
					when p.kind = 'lead_stage_move' then 'Review lead stage'
					when p.kind = 'email_lead' then candidate.name || ' · Possible lead'
					else 'Review new lead'
				end as suggestion_title,
				coalesce(${senderLabel("e")}, nullif(btrim(candidate.name), ''), candidate.source_row->>'address') as email_sender,
				case when strpos(e.body, p.evidence) > 0 then p.evidence end as email_quote,
				a.happened_at as source_at,
				coalesce(a.happened_at::text, candidate.source_row->>'first_seen_at') as email_at,
				coalesce(${mailGroup}, 'conversation:' || lead_email.conversation_id) as mail_group,
				'email:' || md5(${mailGroup}) as mail_card_id,
				coalesce(lead_email.activity_id, a.id) as group_activity_id,
				coalesce(lead_email.happened_at, a.happened_at) as group_source_at,
				case when p.kind in ('file_to_deal', 'possible_new_deal')
					then p.kind || ':' || coalesce(p.deal_id::text, '') else p.id::text end as decision_key,
				jsonb_build_object(
					'id', p.id, 'kind', p.kind, 'activity_id', p.activity_id,
					'activity_kind', p.activity_kind, 'deal_id', p.deal_id, 'party_id', p.party_id,
					'property_id', p.property_id, 'candidate_id', p.candidate_id
				) as reference
			from proposal p
			left join candidate on candidate.id = p.candidate_id
			left join lateral (
				select matched.activity_id, matched.conversation_id, mail.happened_at,
					matched.message_id = candidate.source_row->>'message_id' as exact_message
				from email matched
				join email_mailbox m on m.activity_id = matched.activity_id and m.user_id = ${userId}::uuid
				join activity mail on mail.id = matched.activity_id
				where p.kind = 'email_lead' and (
					matched.message_id = candidate.source_row->>'message_id'
					or matched.conversation_id = candidate.source_row->>'conversation_id'
				)
				order by exact_message desc nulls last, mail.happened_at desc, matched.activity_id
				limit 1
			) lead_email on true
			left join activity a on a.id = coalesce(p.activity_id,
				case when lead_email.exact_message then lead_email.activity_id end)
			left join email e on e.activity_id = a.id
			left join party contact on contact.id = a.from_party_id
			left join deal d on d.id = p.deal_id
			left join party on party.id = p.party_id
			left join property on property.id = p.property_id
			left join phase on phase.slug = p.to_phase
			left join stage lead_stage on lead_stage.role = 'lead' and lead_stage.slug = p.to_stage
			where p.kind <> 'next_step_done'
				and ${visibleSuggestion(userId)}
				and ${sourceInMailbox(sql.ref("p.activity_id"), userId)}
				and (p.kind <> 'email_lead' or not exists (
					select from party_email pe left join app_user u on u.id = pe.party_id
					where pe.address = candidate.source_row->>'address'
					having count(*) = 1 and bool_or(u.is_account_partner)
				))
		), sourced as (
			select visible.*, coalesce(mail_group, activity_id::text, id::text) as source_key from visible
		), decisions as (
			select sourced.*, row_number() over (
				partition by activity_kind, source_key, decision_key
				order by (status = 'pending') desc, activity_at desc, id
			) as decision_position
			from sourced
		), grouped as (
			select decisions.*,
				first_value(group_activity_id) over latest_source as latest_activity_id,
				row_number() over same_source as position,
				max(proposal_version) over source_group as suggestion_change_id,
				array_agg(id) over all_members as member_ids,
				md5(string_agg(id::text, ':') filter (where status = 'pending') over all_members) as source_version,
				jsonb_agg(${forMail ? sql`reference || jsonb_build_object('suggestion_title', suggestion_title, 'due_on', due_on)` : sql`reference`})
					filter (where status = 'pending' and decision_position = 1 ${dashboard ? sql`and kind <> 'email_lead'` : sql``}) over all_members as suggestions
			from decisions
			window source_group as (partition by activity_kind, source_key), latest_source as (source_group order by (status = 'pending') desc, group_source_at desc, group_activity_id desc),
			same_source as (source_group order by (status = 'pending') desc, (kind = 'email_lead'), activity_at desc, id),
			all_members as (same_source rows between unbounded preceding and unbounded following)
		)
		select * from grouped where position = 1 and status = 'pending'
	`;
}

function homeReviewGroups(userId: string, forMail = false, dashboard = false) {
	return sql`
		with draft_groups as (${draftRows(userId)}),
		suggestion_groups as (${suggestionRows(userId, forMail, dashboard)}),
		draft_cards as (
			select d.*, greatest(d.draft_change_id, s.suggestion_change_id) as source_change_id,
				s.suggestions, s.member_ids, s.due_on, coalesce(s.late_target, false) as late_target
			from draft_groups d
			left join suggestion_groups s on s.mail_group = d.mail_group and d.status <> 'sent'
			where d.status in ('pending', 'sent') or s.id is null
				${dashboard ? sql`or s.kind = 'email_lead'` : sql``}
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

function draftCards(
	userId: string,
	limit: number | null,
	itemId?: string,
	dashboard = false,
) {
	return sql<Draft>`
		${homeReviewGroups(userId, false, dashboard)}
		select card.*, summary.text as email_summary from draft_cards card
		left join email_current_summary summary on summary.activity_id = card.email_activity_id
		${itemId ? sql`where id = ${itemId} and status <> 'sent'` : sql``}
		order by (status = 'sent'), activity_at desc, id limit ${limit}
	`;
}

function suggestionCards(
	userId: string,
	limit: number | null,
	itemId?: string,
	dashboard = false,
) {
	return sql<Suggestion>`
		${homeReviewGroups(userId, false, dashboard)}
		select card.*, summary.text as email_summary from suggestion_cards card
		left join email_current_summary summary on summary.activity_id = card.activity_id
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
	snoozed_until: string | null;
	waiting_reason: string | null;
};

function markedReviews<Row extends ReviewRow>(
	rows: RawBuilder<Row>,
	userId: string,
	kind: ReviewKind,
) {
	return sql<Row & ReviewMark>`
		select card.*, history.mark_version, coalesce(history.item_id, card.id) as mark_item_id,
			case when m.snoozed_until > now() then m.snoozed_until end as snoozed_until,
			m.waiting_reason
		from (${rows}) card
		left join lateral (
			select member.item_id, max(h.id) as mark_version
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
	const query =
		kind === "reply_draft"
			? (userId: string) => draftCards(userId, 1, id, true)
			: (userId: string) => suggestionCards(userId, 1, id);
	const {
		rows: [group],
	} = await query(userId).execute(tx);
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
	} = await markedReviews<ReviewRow>(query(userId), userId, kind).execute(tx);
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
	const disposition = snoozed_until ? "snoozed" : "inbox";
	const section =
		source_state === "done"
			? "done"
			: source_state === "working"
				? "working"
				: disposition;
	return {
		item_id: `${kind === "proposal" ? "suggestion" : kind}:${row.id}`,
		source_type,
		source_id: row.id,
		source_version: row.source_version,
		source_state,
		base_version: `${row.source_change_id}:${row.mark_version ?? "0"}:${disposition}`,
		activity_at: new Date(row.activity_at).toISOString(),
		completed_at: completed_at ? new Date(completed_at).toISOString() : null,
		hold_until: null,
		snoozed_until,
		disposition,
		section,
		unseen: false,
		context_label: row.context_label,
		open_url: row.open_url,
		action_id: null,
		action_version: null,
		waiting_version: 0,
		waiting_on: null,
	};
}

function conversationReviewText(
	suggestion: Suggestion,
	kind: "Call" | "Meeting",
) {
	const contact = homeDisplayText(suggestion.contact_name);
	const date = suggestion.source_at ? homeDate(suggestion.source_at) : null;
	const proposed = homeDisplayText(suggestion.suggestion_title);
	const evidence =
		homeDisplayText(suggestion.evidence) ||
		homeDisplayText(suggestion.source_summary);
	const count = suggestion.suggestions.length;
	return {
		title: suggestionTitle(suggestion, contact),
		why: homeWhy(
			date ? `${kind}${contact ? ` with ${contact}` : ""} on ${date}` : null,
			evidence || proposed || "Source details unavailable",
			proposed &&
				evidence &&
				evidence.replace(/\.$/, "") !== proposed.replace(/\.$/, "")
				? `Proposed: ${proposed}`
				: null,
			count > 1 ? `${count} decisions to review` : null,
		),
		primary_action: "Review suggestions",
	};
}

const requestStart =
	/^(?:please (?!note\b|see attached\b)|(?:can|could|would|will) you\b|(?:i|we) (?:need|would like)\b|(?:asked|requested|review|confirm|send|call|check|schedule)\b)/i;
const calendarDate =
	/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?) \d{1,2}\b/i;
const scheduleDecision =
	/\b(?:works?|confirmed|scheduled|set for|available)\b/i;

function shortEmailExcerpt(evidence: string | null) {
	const [body = ""] = (evidence ?? "").split(
		/^\s*(?:>|--|from:|sent:|to:|subject:|on .+ wrote:|(?:best|regards|thanks|thank you|sincerely)[,.!]?\s*$)/im,
	);
	let request = "";
	let fact = "";
	for (const sentence of body.split(/(?<=[.!?])\s+|\r?\n/)) {
		const text = homeDisplayText(sentence);
		if (
			!/[.!?]$/.test(text) ||
			/\b(?:From|Sent|Subject|To):|(?:\d[ ().+-]*){10}/i.test(text)
		)
			continue;
		if (requestStart.test(text)) {
			if (!request || text.length < request.length) request = text;
		} else if (
			((calendarDate.test(text) && scheduleDecision.test(text)) ||
				/\b(?:arrived|was received)\.$/i.test(text)) &&
			(!fact || text.length < fact.length)
		) {
			fact = text;
		}
	}
	return request || fact;
}

function emailRequest(email: EmailContext) {
	const summary = homeDisplayText(email.email_summary);
	return {
		summary,
		quote: summary ? "" : shortEmailExcerpt(email.email_quote),
	};
}

function receivedEmail(source: string, receivedAt: string | null) {
	return receivedAt && Number.isFinite(Date.parse(receivedAt))
		? `${source} received on ${homeDate(receivedAt)}`
		: source;
}

const emailActions = {
	next_step: "Review follow-up",
	file_to_deal: "Choose deal",
	possible_new_deal: "Choose deal",
	phase_move: "Review phase change",
	new_lead: "Review lead",
	email_lead: "Review lead",
	lead_stage_move: "Review lead stage",
	log_call: "Review call note",
} as const;

function suggestionTitle(suggestion: Suggestion, contact: string) {
	const { kind } = suggestion;
	const target =
		kind === "file_to_deal" || kind === "possible_new_deal"
			? contact
			: homeDisplayText(suggestion.context_label) || contact;
	return homeTitle(kind, target, homeDisplayText(suggestion.decision_label));
}

function emailSuggestionText(suggestion: Suggestion & ReviewMark) {
	const sender = homeDisplayText(suggestion.email_sender);
	const target = homeDisplayText(suggestion.context_label);
	const destination = homeDisplayText(suggestion.decision_label);
	const proposed = homeStepText(suggestion.suggestion_title ?? "");
	const evidence = suggestion.email_quote
		? ""
		: homeDisplayText(suggestion.evidence);
	const { summary, quote } = emailRequest(suggestion);
	const request = summary || quote;
	const source = sender ? `Email from ${sender}` : "Email";
	const action = emailActions[suggestion.kind];
	const details = {
		next_step: proposed && `Proposed follow-up: ${proposed}`,
		file_to_deal: target && `Suggested deal is ${target}`,
		possible_new_deal: null,
		phase_move: destination && `Proposed phase is ${destination}`,
		new_lead: target && `Proposed lead is ${target}`,
		email_lead: "Review the possible lead",
		lead_stage_move: destination && `Proposed lead stage is ${destination}`,
		log_call: proposed,
	}[suggestion.kind];
	const count = suggestion.suggestions.length;
	return {
		title: suggestionTitle(suggestion, sender),
		why: homeWhy(
			request || receivedEmail(source, suggestion.email_at),
			suggestion.kind !== "next_step" && evidence !== request ? evidence : null,
			details || (request ? null : action),
			count > 1 ? `${count} decisions to review` : null,
		),
		primary_action: suggestion.snoozed_until ? null : action,
	};
}

const unconfirmedDelivery = (reason: string | null) =>
	/^unconfirmed_after_\d+$/.test(reason ?? "");

function deliveryWhy(reason: string | null) {
	switch (reason) {
		case "aborted_before_dispatch":
			return "The send stopped before the reply went out.";
		case "submission_recipients_invalid":
			return "The reply's recipients were invalid.";
		case "submission_hash_mismatch":
			return "The reply did not match the approved draft.";
		case "submission_attachment_mismatch":
			return "The attachments did not match the approved draft.";
		case "attachment_missing":
			return "An attachment could not be found.";
		case "attachment_settings_missing":
		case "attachment_root_missing":
			return "The attachment folder was unavailable.";
		case "attachment_path_not_absolute":
		case "attachment_outside_root":
		case "attachment_not_regular_file":
		case "attachment_unreadable":
			return "An attachment could not be opened.";
		case "attachments_too_large":
			return "The attachments were too large to send.";
		case "invalid_submission":
			return "Outlook received an invalid reply submission.";
		case "failed:abort_cleanup_failed":
			return "Outlook could not clean up the interrupted send.";
		default:
			if (unconfirmedDelivery(reason))
				return "Outlook could not confirm that the reply was sent.";
			if (
				/^(?:failed:|refused:|draft:|[a-z]+(?:_[a-z]+)+:|[a-z\d]+(?:_[a-z\d]+)+$)/.test(
					reason ?? "",
				)
			)
				return "Outlook reported a delivery failure.";
			return homeWhy(
				homeDisplayText(reason) || "No delivery reason was recorded",
			);
	}
}

function draftReviewText(draft: Draft & ReviewMark, dashboard: boolean) {
	const sender = homeDisplayText(draft.email_sender);
	const target = draft.deal_id ? homeDisplayText(draft.context_label) : "";
	const source = sender ? `Email from ${sender}` : "Email";
	const { summary, quote } = emailRequest(draft);
	const request = summary || quote;
	const decisions = dashboard ? (draft.suggestions?.length ?? 0) : 0;
	const why = homeWhy(
		request || receivedEmail(source, draft.email_at),
		!request && draft.status === "pending" ? "Review the drafted reply" : null,
		decisions > 1 ? `${decisions} decisions to review` : null,
	);
	const action =
		draft.status === "pending"
			? "Review reply"
			: draft.status === "failed"
				? "Review delivery"
				: null;
	return {
		title: homeTitle(`reply_${draft.status}`, sender, target),
		why: draft.status === "failed" ? deliveryWhy(draft.failure_reason) : why,
		primary_action: draft.snoozed_until ? null : action,
	};
}

export async function readHomeReviewCards(
	db: Transaction<DB>,
	userId: string,
	limit: number | null,
	dashboard: boolean,
) {
	const drafts = await markedReviews(
		draftCards(userId, limit, undefined, dashboard),
		userId,
		"reply_draft",
	).execute(db);
	const suggestions = await markedReviews(
		suggestionCards(userId, limit, undefined, dashboard),
		userId,
		"proposal",
	).execute(db);
	const draftRows = dashboard
		? drafts.rows.filter(({ status }) => status !== "sent")
		: drafts.rows;
	const suggestionRows = dashboard
		? suggestions.rows.filter(({ kind }) => kind !== "email_lead")
		: suggestions.rows;
	return [
		...draftRows.map((draft) => ({
			...reviewCard(
				draft,
				"reply_draft",
				"email_proposal",
				draft.status === "sent"
					? "done"
					: draft.status === "approved" ||
							(dashboard && unconfirmedDelivery(draft.failure_reason))
						? "working"
						: draft.status === "failed"
							? "failed"
							: "needs_attention",
				draft.sent_at,
			),
			...draftReviewText(draft, dashboard),
			...(dashboard && {
				card_id: draft.mail_card_id ?? `reply_draft:${draft.id}`,
				late_target: draft.late_target,
				waiting_reason: homeDisplayText(draft.waiting_reason) || null,
			}),
			kind_label: "Reply draft",
			deal_id: null,
			due_on: dashboard && !draft.suggestions ? null : draft.due_on,
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
				happened_at: new Date(draft.email_at).toISOString(),
				deal_id: draft.deal_id,
			},
		})),
		...suggestionRows.map((suggestion) => {
			const call = suggestion.activity_kind === "call";
			const meeting = suggestion.activity_kind === "meeting";
			const sourceType = call
				? "capture_session"
				: meeting
					? "notification"
					: "email_proposal";
			const fallback = suggestion.fallback_reply_draft;
			const deliveryUnconfirmed =
				dashboard && fallback && unconfirmedDelivery(fallback.failure_reason);
			return {
				...reviewCard(
					suggestion,
					"proposal",
					sourceType,
					deliveryUnconfirmed ? "working" : "needs_attention",
				),
				...(dashboard && {
					card_id:
						suggestion.mail_card_id ??
						`${suggestion.activity_kind}:${suggestion.activity_id ?? suggestion.id}`,
					late_target: suggestion.late_target,
					waiting_reason: homeDisplayText(suggestion.waiting_reason) || null,
				}),
				...(call || meeting
					? conversationReviewText(suggestion, call ? "Call" : "Meeting")
					: emailSuggestionText(suggestion)),
				kind_label: call ? "Call" : "Suggestion",
				deal_id: null,
				due_on: suggestion.due_on,
				proposal_id: suggestion.id,
				merged_source_ids: suggestion.suggestions.map(({ id }) => id),
				suggestions: suggestion.suggestions,
				...(fallback && { fallback_reply_draft: fallback }),
				source_activity: suggestion.activity_id
					? {
							kind: suggestion.activity_kind,
							id: suggestion.activity_id,
							...(suggestion.source_at
								? {
										happened_at: new Date(suggestion.source_at).toISOString(),
									}
								: {}),
						}
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
				and case when draft.id is not null then draft.snoozed_until is null
					else standalone.snoozed_until is null end
				and ref.kind in ('next_step', 'file_to_deal', 'possible_new_deal', 'phase_move')
			union all
			select 'reply_draft:' || card.id, card.source_change_id, card.mark_version,
				card.email_activity_id, null, card.id, 'reply_draft', card.email_activity_id, card.email_activity_id, null, 'Review reply draft'
			from marked_drafts card
			where card.status = 'pending' and card.snoozed_until is null
		), ranked as (
			select cards.*, e.conversation_id, a.happened_at, review.happened_at as review_happened_at,
				${senderLabel("title_email")} as sender,
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
