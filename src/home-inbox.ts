import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { answerNextRead, checkFields, Refusal, refuse } from "./answer.ts";
import { isCalendarDate } from "./calendar-date.ts";
import {
	type HomeReviewLink,
	readHomeMailPriorities,
	readHomeReviewCards,
	readHomeReviewDisposition,
} from "./home-inbox-review.ts";
import {
	completionReviewCard,
	readCompletionReviews,
	readHomeUpdates,
} from "./home-inbox-reviews-updates.ts";
import {
	type HomeStep,
	type HomeStepTarget,
	homeDay,
	homeDisplayText,
	homeStepCopy,
	homeStepEligible,
	homeStepTarget,
	lateLabel,
	stepItemId,
	stepOpenUrl,
	stepTargetFields,
} from "./home-steps.ts";
import type { DB } from "./next-database.d.ts";
import type { DatabaseEnv } from "./reader.ts";
import { isUuid } from "./request-shape.ts";

const LIMIT = 1000;

interface Step extends HomeStep, HomeStepTarget {
	id: string;
	party_id: string | null;
	prospect: boolean;
	created_at: string;
	set_by: string | null;
	activity_at: string;
	completed_at: string | null;
	snoozed_until: string | null;
	waiting_reason: string | null;
	step_version: string;
	undo_completion: boolean;
	mark_version: string | null;
	call_id: string | null;
	call_summary: string | null;
	call_quote: string | null;
	source_id: string | null;
	source_kind: "call" | "email" | "meeting" | null;
	source_evidence: string | null;
}

function stepRows(db: Transaction<DB>, userId: string, dashboard: boolean) {
	return sql<Step>`
		select s.id, s.what, s.item_title, s.status, s.deal_id, s.party_id, s.property_id,
			${stepTargetFields(db)},
			s.due_on, s.created_at, setter.name as set_by,
			coalesce(s.done_at, s.changed_at) as activity_at, s.done_at as completed_at,
			case when s.hold_until > ${homeDay}
				then s.hold_until::timestamp at time zone 'America/Chicago' end as hold_until,
			case when m.snoozed_until > now() then m.snoozed_until end as snoozed_until,
			m.waiting_reason,
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
			and (s.status = 'open' ${
				dashboard
					? sql``
					: sql`or
				(s.status = 'done' and s.done_at >= now() - interval '7 days')`
			})
		order by (s.status = 'done'), activity_at desc, s.id
		${dashboard ? sql`` : sql`limit ${LIMIT + 1}`}
	`;
}

const iso = (timestamp: string) => new Date(timestamp).toISOString();
const optionalIso = (timestamp: string | null) =>
	timestamp === null ? null : iso(timestamp);

function stepCard(step: Step) {
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
	const open_url = stepOpenUrl(step);

	return {
		item_id: stepItemId(step),
		source_type,
		source_id: step.id,
		source_version,
		source_state: done ? "done" : "needs_attention",
		base_version: `${source_version}:${step.mark_version ?? "0"}:${disposition}`,
		...homeStepCopy(step, step),
		primary_action: done ? "Open" : "Mark done",
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

async function readHomeDay(db: Transaction<DB>) {
	const { today } = await db
		.selectNoFrom(sql<string>`${homeDay}::text`.as("today"))
		.executeTakeFirstOrThrow();
	return today;
}

type HomeCardTiming = {
	item_id: string;
	snoozed_until: string | null;
	hold_until: string | null;
	section: string;
	due_on: string | null;
	late_target?: boolean;
	card_id?: string;
	waiting_reason?: string | null;
};

function homeCardTiming<Item extends HomeCardTiming>(
	item: Item,
	today: string,
) {
	const {
		late_target = false,
		card_id = item.item_id,
		waiting_reason = null,
		...card
	} = item;
	const reason = card.snoozed_until
		? "Snoozed"
		: card.hold_until
			? "On hold"
			: card.section === "working"
				? "Waiting for Outlook to confirm delivery"
				: waiting_reason;
	const { due_on } = card;
	const days_late =
		!reason &&
		card.section !== "done" &&
		late_target &&
		isCalendarDate(due_on) &&
		due_on < today
			? (Date.parse(today) - Date.parse(due_on)) / 86_400_000
			: null;
	return { card, card_id, reason, days_late };
}

function dashboardCard<Item extends HomeCardTiming>(item: Item, today: string) {
	const { card, card_id, reason, days_late } = homeCardTiming(item, today);
	const returns_at =
		[card.snoozed_until, card.hold_until]
			.filter((at) => at !== null)
			.sort()
			.at(-1) ?? null;
	return {
		...card,
		...(reason && { primary_action: null }),
		card_id,
		waiting_reason: reason,
		returns_at,
		days_late,
		late_label: days_late === null ? null : lateLabel(days_late),
	};
}

async function readHomeInbox(
	db: Transaction<DB>,
	userId: string,
	dashboard: boolean,
) {
	const today = await readHomeDay(db);
	const { rows } = await stepRows(db, userId, dashboard).execute(db);
	const eligibleSteps = dashboard
		? rows.filter((step) => homeStepEligible(step, today))
		: rows;
	const reviews = await readCompletionReviews(
		db,
		eligibleSteps
			.filter((step) => step.status === "open")
			.map((step) => step.id),
	);
	const steps = eligibleSteps.map((step) => {
		const review = reviews.get(step.id);
		const card = stepCard(step);
		const waiting = dashboard && (step.hold_until || step.waiting_reason);
		const visible =
			review && !step.snoozed_until && !waiting
				? completionReviewCard(review, card)
				: card;
		return {
			...visible,
			waiting_reason: homeDisplayText(step.waiting_reason) || null,
			late_target:
				!step.hold_until && ["deal", "vendor"].includes(homeStepTarget(step)),
		};
	});
	const limit = dashboard ? null : LIMIT + 1;
	const checklistSteps = new Set(
		eligibleSteps.map((step) => `deal-item:${step.id}`),
	);
	const updates = (
		await readHomeUpdates(db, userId, limit, dashboard ? "dashboard" : "inbox")
	).filter(
		(update) =>
			!dashboard ||
			!update.checklist_item_ref ||
			!checklistSteps.has(update.checklist_item_ref),
	);
	const items = [
		...steps,
		...updates,
		...(await readHomeReviewCards(db, userId, limit, dashboard)),
	].sort(
		(a, b) =>
			Number(a.source_state === "done") - Number(b.source_state === "done") ||
			b.activity_at.localeCompare(a.activity_at) ||
			a.item_id.localeCompare(b.item_id),
	);
	const contract = {
		ok: true,
		schema_version: "home-inbox.v5",
		home_mark_drop: true,
		home_proposal_drop: true,
	};
	if (dashboard) {
		const cards = items.map((item) => dashboardCard(item, today));
		const reminders = cards.filter((card) => !card.waiting_reason);
		const waiting = cards.filter((card) => card.waiting_reason);
		return {
			...contract,
			reminders: { count: reminders.length, items: reminders },
			waiting: { count: waiting.length, items: waiting },
		};
	}
	return {
		...contract,
		items: items.slice(0, LIMIT).map((item) => {
			const { card, days_late } = homeCardTiming(item, today);
			return { ...card, days_late };
		}),
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
	const params = new URL(c.req.url).searchParams;
	const refused = checkFields(params, ["view"], {
		vocabularies: { view: ["dashboard"] },
	});
	if (refused) return refuse(c, refused);
	return answerNextRead(c, "read-home-inbox-v5", (db, userId) =>
		readHomeInbox(db, userId, params.get("view") === "dashboard"),
	);
});

homeInbox.get("/home/cards/:item_id", (c) => {
	if (c.env.HOME_INBOX_READ_SCHEMA !== "next") return c.notFound();
	const [kind, id, extra] = c.req.param("item_id").toLowerCase().split(":");
	if (
		(kind !== "reply_draft" && kind !== "suggestion") ||
		!isUuid(id) ||
		extra !== undefined
	)
		return refuse(c, new Refusal(404, "not_found"));
	const refused = checkFields(new URL(c.req.url).searchParams, []);
	if (refused) return refuse(c, refused);
	return answerNextRead(c, "read-home-card", async (db, userId) => {
		const link: HomeReviewLink = { kind, id };
		const [card] = await readHomeReviewCards(db, userId, null, true, link);
		if (!card) return readHomeReviewDisposition(db, userId, link);
		const requested_item_id = `${kind}:${id}`;
		return {
			...dashboardCard(card, await readHomeDay(db)),
			...(kind === "suggestion" &&
				card.item_id !== requested_item_id && { requested_item_id }),
		};
	});
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
