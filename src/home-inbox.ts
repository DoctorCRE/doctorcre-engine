import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { answerNextRead, checkFields, refuse } from "./answer.ts";
import {
	completionReviewCard,
	readCompletionReviews,
	readHomeUpdates,
} from "./home-inbox-reviews-updates.ts";
import type { DB } from "./next-database.d.ts";
import type { DatabaseEnv } from "./reader.ts";

const LIMIT = 1000;

type Step = {
	id: string;
	title: string;
	status: string | null;
	deal_id: string | null;
	party_id: string | null;
	context_label: string;
	due_on: string | null;
	activity_at: string;
	completed_at: string | null;
	hold_until: string | null;
	snoozed_until: string | null;
	settled: boolean;
	step_version: number;
	mark_version: string | null;
	call_id: string | null;
	call_at: string | null;
	call_contact: string | null;
	call_summary: string | null;
	call_quote: string | null;
	source_id: string | null;
	source_kind: string | null;
};

function stepRows(userId: string) {
	return sql<Step>`
		select s.id, s.what as title, s.status, s.deal_id, s.party_id,
			coalesce(d.name, p.name, property.name, property.address) as context_label,
			s.due_on, coalesce(s.done_at, s.changed_at) as activity_at, s.done_at as completed_at,
			case when s.hold_until > (now() at time zone 'America/Chicago')::date
				then s.hold_until::timestamp at time zone 'America/Chicago' end as hold_until,
			case when m.snoozed_until > now() then m.snoozed_until end as snoozed_until,
			coalesce(m.disposition = 'settled' and mark_change.id >= step_change.id, false) as settled,
			step_change.id::float8 as step_version, mark_change.id as mark_version,
			c.id as call_id, c.happened_at as call_at, contact.name as call_contact,
			c.summary as call_summary, s.call_evidence_quote as call_quote,
			accepted.activity_id as source_id, accepted.activity_kind as source_kind
		from next_step s
		left join deal d on d.id = s.deal_id
		left join party p on p.id = s.party_id
		left join property on property.id = s.property_id
		left join activity c on c.id = s.call_activity_id
		left join party contact on contact.id = coalesce(s.call_contact_party_id, c.from_party_id)
		left join proposal accepted on accepted.id = s.id and accepted.kind = 'next_step'
			and accepted.status = 'accepted'
		left join home_mark m on m.user_id = ${userId}::uuid
			and m.item_id = s.id
			and m.item_kind = case when c.id is null then 'next_step' else 'call_follow_up' end
		cross join lateral (
			select max(id) as id from change where table_name = 'next_step'
				and record = jsonb_build_object('id', s.id)
		) step_change
		left join lateral (
			select max(id) as id from change where table_name = 'home_mark'
				and record = jsonb_build_object('user_id', m.user_id, 'item_kind', m.item_kind, 'item_id', m.item_id)
		) mark_change on m.item_id is not null
		where s.owner_party_id = ${userId}::uuid
			and (s.status = 'open' or (s.status = 'done' and s.done_at >= now() - interval '7 days'))
		order by (s.status = 'done'), activity_at desc, s.id
		limit ${LIMIT + 1}
	`;
}

const iso = (timestamp: string) => new Date(timestamp).toISOString();
const optionalIso = (timestamp: string | null) =>
	timestamp === null ? null : iso(timestamp);

function stepCard(step: Step) {
	const completed_at = optionalIso(step.completed_at);
	const done = step.status === "done";
	const auto_settled = done && !step.settled;
	const snoozed_until = done ? null : optionalIso(step.snoozed_until);
	const hold_until = done ? null : optionalIso(step.hold_until);
	const disposition =
		done || step.settled ? "settled" : snoozed_until ? "snoozed" : "inbox";
	const source_type = step.call_id ? "capture_post_call_action" : "next_action";
	const source_version = String(step.step_version);
	const open_url = step.call_id
		? `/calls?session=${step.call_id}`
		: step.deal_id
			? `/deals?deal=${step.deal_id}&focus=next-step`
			: step.party_id
				? `/relationships?node=party:${step.party_id}`
				: null;

	return {
		item_id: `${source_type}:${step.id}`,
		source_type,
		source_id: step.id,
		source_version,
		source_state: done ? "done" : "needs_attention",
		base_version: `${source_version}:${step.mark_version ?? "0"}:${disposition}`,
		title: step.title,
		activity_at: iso(step.activity_at),
		completed_at,
		hold_until,
		due_on: step.due_on,
		snoozed_until,
		disposition,
		section: disposition === "inbox" && hold_until ? "held" : disposition,
		unseen: false,
		explicit_unsettle: false,
		auto_settled,
		context_label: step.context_label,
		open_url,
		kind_label: step.call_id ? "Call follow-up" : "Task",
		action_id: step.id,
		action_version: step.step_version,
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
	const { rows } = await stepRows(userId).execute(db);
	const reviews = await readCompletionReviews(
		db,
		rows.filter((step) => step.status === "open").map((step) => step.id),
	);
	const steps = rows.map((step) => {
		const review = reviews.get(step.id);
		if (!review || step.settled || step.snoozed_until) return stepCard(step);
		return completionReviewCard(review, step.step_version, step.mark_version);
	});
	const updates = await readHomeUpdates(db, userId, LIMIT + 1);
	const items = [...steps, ...updates].sort(
		(a, b) =>
			Number(a.source_state === "done") - Number(b.source_state === "done") ||
			b.activity_at.localeCompare(a.activity_at) ||
			a.item_id.localeCompare(b.item_id),
	);
	return {
		ok: true,
		schema_version: "home-inbox.v5",
		items: items.slice(0, LIMIT),
		truncated: rows.length > LIMIT || items.length > LIMIT,
		limit: LIMIT,
		working_collapsed: true,
		auto_settle_enabled: true,
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
