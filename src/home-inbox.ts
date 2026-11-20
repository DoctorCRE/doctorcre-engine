import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { answerNextRead, checkFields, refuse } from "./answer.ts";
import {
	readHomeMailPriorities,
	readHomeReviewCards,
} from "./home-inbox-review.ts";
import {
	completionReviewCard,
	readCompletionReviews,
	readHomeUpdates,
} from "./home-inbox-reviews-updates.ts";
import {
	homeDate,
	homeDisplayText,
	homeWhy,
	stepItemId,
	stepOpenUrl,
	stepTargetFields,
	undatedPartyStep,
} from "./home-steps.ts";
import type { DB } from "./next-database.d.ts";
import type { DatabaseEnv } from "./reader.ts";

const LIMIT = 1000;

type Step = {
	id: string;
	title: string;
	status: string | null;
	deal_id: string | null;
	building_deal_id: string | null;
	party_id: string | null;
	prospect: boolean;
	context_label: string | null;
	due_on: string | null;
	created_at: string;
	set_by: string | null;
	activity_at: string;
	completed_at: string | null;
	hold_until: string | null;
	snoozed_until: string | null;
	step_version: string;
	undo_completion: boolean;
	mark_version: string | null;
	call_id: string | null;
	call_at: string | null;
	call_contact: string | null;
	call_summary: string | null;
	call_quote: string | null;
	source_id: string | null;
	source_kind: "call" | "email" | "meeting" | null;
	source_evidence: string | null;
};

function stepRows(db: Transaction<DB>, userId: string) {
	return sql<Step>`
		select s.id, s.what as title, s.status, s.deal_id, s.party_id,
			${stepTargetFields(db)},
			s.due_on, s.created_at, setter.name as set_by,
			coalesce(s.done_at, s.changed_at) as activity_at, s.done_at as completed_at,
			case when s.hold_until > (now() at time zone 'America/Chicago')::date
				then s.hold_until::timestamp at time zone 'America/Chicago' end as hold_until,
			case when m.snoozed_until > now() then m.snoozed_until end as snoozed_until,
			coalesce(step_change.id, 0) as step_version, mark_change.id as mark_version,
			coalesce(s.status = 'done' and step_change.changed_by_user_id = s.owner_party_id
				and step_change.old_value @> '{"resolution":null}'
				and step_change.new_value @> '{"resolution":"done"}'
				and not exists (
					select from proposal p where p.next_step_id = s.id and p.kind = 'next_step_done'
						and p.status = 'accepted' and p.decided_at = s.done_at
				), false) as undo_completion,
			c.id as call_id, c.happened_at as call_at, contact.name as call_contact,
			c.summary as call_summary, s.call_evidence_quote as call_quote,
			accepted.activity_id as source_id, accepted.activity_kind as source_kind,
			accepted.evidence as source_evidence
		from next_step s
		left join deal d on d.id = s.deal_id
		left join party p on p.id = s.party_id
		left join property on property.id = s.property_id
		left join activity c on c.id = s.call_activity_id
		left join party contact on contact.id = coalesce(s.call_contact_party_id, c.from_party_id)
		left join proposal accepted on accepted.id = s.id and accepted.kind = 'next_step'
			and accepted.status = 'accepted'
		left join lateral (
			select changed_by_user_id from change
			where table_name = 'next_step' and record = jsonb_build_object('id', s.id) and action = 'insert'
			order by id limit 1
		) origin on true
		left join party setter on setter.id = origin.changed_by_user_id
		left join home_mark m on m.user_id = ${userId}::uuid
			and m.item_id = s.id
			and m.item_kind = case when c.id is null then 'next_step' else 'call_follow_up' end
		left join lateral (
			select id, changed_by_user_id, old_value, new_value from change
			where table_name = 'next_step' and record = jsonb_build_object('id', s.id)
			order by id desc limit 1
		) step_change on true
		left join lateral (
			select max(id) as id
			from change where table_name = 'home_mark'
				and record = jsonb_build_object('user_id', s.owner_party_id, 'item_id', s.id,
					'item_kind', case when c.id is null then 'next_step' else 'call_follow_up' end)
		) mark_change on true
		where s.owner_party_id = ${userId}::uuid
			and m.disposition is distinct from 'dropped'
			and (s.status = 'open' or (s.status = 'done' and s.done_at >= now() - interval '7 days'))
		order by (s.status = 'done'), activity_at desc, s.id
		limit ${LIMIT + 1}
	`;
}

const iso = (timestamp: string) => new Date(timestamp).toISOString();
const optionalIso = (timestamp: string | null) =>
	timestamp === null ? null : iso(timestamp);

function stepText(step: Step, action: string) {
	const target = homeDisplayText(step.context_label);
	const forTarget = target ? ` for ${target}` : "";
	const primary_action = step.status === "done" ? "Open" : "Mark done";
	const due = step.due_on ? `Due ${homeDate(step.due_on)}` : null;
	if (step.call_at) {
		const contact = homeDisplayText(step.call_contact);
		const date = homeDate(step.call_at);
		const call = contact
			? `Call with ${contact}`
			: `Call${forTarget} on ${date}`;
		return {
			title: `${call} left a follow-up — ${action || "open the saved step"}`,
			why: homeWhy(
				`Call on ${date}`,
				homeDisplayText(step.call_quote) ||
					homeDisplayText(step.call_summary) ||
					"Call details unavailable",
				due,
			),
			primary_action,
		};
	}
	const setter = homeDisplayText(step.set_by);
	const set = step.source_kind
		? `Follow-up set from the ${step.source_kind}`
		: setter
			? `Follow-up set by ${setter}`
			: `Follow-up set on ${homeDate(step.created_at)}`;
	return {
		title: `${step.status === "done" ? "Follow-up completed" : due ? "Follow-up due" : "Follow-up set"}${forTarget} — ${action || "open the saved step"}`,
		why: homeWhy(set, homeDisplayText(step.source_evidence), due),
		primary_action,
	};
}

function stepCard(step: Step, action: string) {
	const completed_at = optionalIso(step.completed_at);
	const done = step.status === "done";
	const snoozed_until = done ? null : optionalIso(step.snoozed_until);
	const hold_until = done ? null : optionalIso(step.hold_until);
	const disposition = snoozed_until ? "snoozed" : "inbox";
	const section = done
		? "done"
		: disposition === "inbox" && hold_until
			? "held"
			: disposition;
	const source_type = step.call_id ? "capture_post_call_action" : "next_action";
	const source_version = step.step_version;
	const open_url = stepOpenUrl(step, done);

	return {
		item_id: stepItemId(step),
		source_type,
		source_id: step.id,
		source_version,
		source_state: done ? "done" : "needs_attention",
		base_version: `${source_version}:${step.mark_version ?? "0"}:${disposition}`,
		...stepText(step, action),
		activity_at: iso(step.activity_at),
		completed_at,
		hold_until,
		due_on: step.due_on,
		snoozed_until,
		disposition,
		section,
		unseen: false,
		context_label: step.context_label,
		open_url,
		kind_label: step.call_id ? "Call follow-up" : "Task",
		action_id: step.id,
		action_version: Number(step.step_version),
		undo_completion: step.undo_completion,
		deal_id: step.deal_id,
		merged_source_ids: [step.id],
		waiting_version: 0,
		waiting_on: null,
		source_activity:
			step.call_id && step.call_at
				? {
						kind: "call",
						id: step.call_id,
						happened_at: iso(step.call_at),
						contact: step.call_contact,
						summary: step.call_summary,
						quote: step.call_quote,
					}
				: step.source_id && step.source_kind
					? { kind: step.source_kind, id: step.source_id }
					: null,
	};
}

async function readHomeInbox(db: Transaction<DB>, userId: string) {
	const { rows } = await stepRows(db, userId).execute(db);
	const reviews = await readCompletionReviews(
		db,
		rows.filter((step) => step.status === "open").map((step) => step.id),
	);
	let unexplained_step_count = 0;
	const steps: (
		| ReturnType<typeof stepCard>
		| ReturnType<typeof completionReviewCard>
	)[] = [];
	for (const step of rows) {
		const review = reviews.get(step.id);
		const action = homeDisplayText(step.title);
		if (review && !step.snoozed_until) {
			steps.push(completionReviewCard(review, stepCard(step, action)));
			continue;
		}
		if (step.status === "open") {
			const partyStep =
				step.party_id && !step.due_on ? undatedPartyStep(action) : null;
			if (partyStep === "schedule") continue;
			if (
				!action ||
				partyStep === "unclear" ||
				(partyStep && !homeDisplayText(step.context_label))
			) {
				unexplained_step_count++;
				continue;
			}
		}
		steps.push(stepCard(step, action));
	}
	const updates = await readHomeUpdates(db, userId, LIMIT + 1);
	const items = [
		...steps,
		...updates,
		...(await readHomeReviewCards(db, userId, LIMIT + 1)),
	].sort(
		(a, b) =>
			Number(a.source_state === "done") - Number(b.source_state === "done") ||
			b.activity_at.localeCompare(a.activity_at) ||
			a.item_id.localeCompare(b.item_id),
	);
	return {
		ok: true,
		schema_version: "home-inbox.v5",
		home_mark_drop: true,
		home_proposal_drop: true,
		unexplained_step_count,
		items: items.slice(0, LIMIT),
		truncated: rows.length > LIMIT || items.length > LIMIT,
		limit: LIMIT,
		working_collapsed: true,
	};
}

export const homeInbox = new Hono<
	DatabaseEnv & { Bindings: { HOME_INBOX_READ_SCHEMA?: string } }
>();

homeInbox.get("/home/inbox", (c) => {
	if (c.env.HOME_INBOX_READ_SCHEMA !== "next") return c.notFound();
	const refused = checkFields(new URL(c.req.url).searchParams, []);
	if (refused) return refuse(c, refused);
	return answerNextRead(c, "read-home-inbox-v5", readHomeInbox);
});

homeInbox.get("/home/mail-priorities", (c) => {
	if (c.env.HOME_INBOX_READ_SCHEMA !== "next") return c.notFound();
	const refused = checkFields(new URL(c.req.url).searchParams, []);
	if (refused) return refuse(c, refused);
	return answerNextRead(
		c,
		"read-home-mail-priorities-v1",
		readHomeMailPriorities,
	);
});
