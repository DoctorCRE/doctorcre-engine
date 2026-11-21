import { sql, type Transaction } from "kysely";
import { isOpenBoardDeal, selectNextDeals } from "./deals/next-board.ts";
import type { DB } from "./next-database.d.ts";

const stepMetadata =
	/\b(?:[CL]-\d+|V-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d+|T\s*[-−]\s*\d+\s*(?:days?|weeks?|months?|years?)|loop\s*#\s*\d+)\b/gi;
const storedDate =
	/\b(?:(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) )?(\d{4}-\d{2}-\d{2})([T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?\b/g;
const edgePunctuation = /^[\s:;,·–—-]+|[\s:;,·–—-]+$/g;
const decisionPrefix = /^(?:[A-Z][A-Z'.-]* )+DECIDE\s*:\s*/;
const unknownSendDecision =
	/^send status unknown\s*[,—–-]\s*re-touch or drop\.?$/i;
const phoneNumber =
	/(?<!\w)(?:at\s+)?(?:\+[1-9](?:[ .-]?\d){7,14}|(?:\+?1[ .-]?)?(?:\(\d{3}\)\s*|\d{3}[ .-]?)\d{3}[ .-]?\d{4})(?:\s*(?:ext\.?|x)\s*\d+)?(?!\w)/gi;

export function homeDisplayText(text: string | null) {
	return (text ?? "")
		.replace(/(^|\n)[ \t]*(?:#{1,6}|[-+*]|\d+[.)]|>)[ \t]+/g, "$1")
		.replace(/\[([^\]]+)\]\([^\s)]+\)/g, "$1")
		.replace(/(\*{1,3}|`{1,3}|~~)(?=\S)(.+?)(?<=\S)\1/g, "$2")
		.replace(/(?<!\w)(_{1,3})(?=\S)(.+?)(?<=\S)\1(?!\w)/g, "$2")
		.replace(/\([^()]*\)|\[[^[\]]*\]/g, (aside) => {
			const cleaned = aside.replace(stepMetadata, "");
			if (cleaned === aside) return aside;
			const label = cleaned
				.slice(1, -1)
				.replace(/^[\s,;:·–—-]+|[\s,;:·–—-]+$/g, "");
			return label ? `${aside[0]}${label}${aside.at(-1)}` : "";
		})
		.replace(stepMetadata, "")
		.replace(/\s+/g, " ")
		.replace(storedDate, (original, weekday, date, time) => {
			const timestamp = time
				? new Date(date + time)
				: new Date(`${date}T12:00:00Z`);
			if (!Number.isFinite(timestamp.getTime())) return original;
			return time
				? dateTimeLabel.format(timestamp)
				: `${weekday ? `${weekday}, ` : ""}${dateLabel.format(timestamp)}`;
		})
		.replace(/ +([,.;:!?])/g, "$1")
		.replace(edgePunctuation, "");
}

export function homeStepText(text: string) {
	const savedText = homeDisplayText(text).replace(
		/^(?:NONE|HOLD)(?:\s*[—–:-]\s*|$)/i,
		"",
	);
	const prompt = savedText.replace(decisionPrefix, "");
	if (unknownSendDecision.test(prompt))
		return { savedText, action: "Decide whether to follow up or drop" };
	const withoutNumber = prompt.replace(phoneNumber, " ");
	if (withoutNumber === prompt && !/^(?:please )?call\b/i.test(prompt))
		return { savedText, action: prompt };
	const [firstSentence = ""] = withoutNumber
		.replace(/\s+/g, " ")
		.replace(edgePunctuation, "")
		.split(/(?<!\b(?:Dr|Mr|Mrs|Ms)\.)(?<=[.!?])\s+/i, 1);
	return { savedText, action: firstSentence.replace(/\.$/, "") };
}

const titleLength = 90;

function shorten(text: string, width: number) {
	if (text.length <= width) return text;
	const start = text.slice(0, width - 1);
	const word = text[width - 1] === " " ? start : start.replace(/\s+\S*$/, "");
	return `${(word || start).trimEnd()}…`;
}

export function homeTitle(event: string, action = "", fallbackEvent = event) {
	if (!action) return shorten(event, titleLength);
	const separator = " — ";
	if (event.length + separator.length + action.length <= titleLength)
		return event + separator + action;
	const decision = shorten(
		action,
		titleLength - separator.length - Math.min(fallbackEvent.length, 35),
	);
	return (
		shorten(fallbackEvent, titleLength - separator.length - decision.length) +
		separator +
		decision
	);
}

export type StepTitle = {
	title: string;
	status: string | null;
	context_label: string | null;
	due_on: string | null;
	hold_until: string | null;
	call_at: string | null;
	call_contact: string | null;
};

type StepEvidence = {
	call_quote: string | null;
	call_summary: string | null;
	created_at: string;
	set_by: string | null;
	source_kind: "call" | "email" | "meeting" | null;
	source_evidence: string | null;
};

const leaseEvent =
	/^Lease event [—–-] (.+?), est\. (\w+ \d{1,2}, \d{4})(?:\.\s*|$)(.*)$/i;
const leaseAction =
	/^(?:please )?(?:ask|call|check|confirm|contact|decide|discuss|follow up|reach out|relocate|renew|review|schedule|send)\b/i;

export function homeStepCopy(step: StepTitle, evidence?: StepEvidence) {
	const { action, savedText } = homeStepText(step.title);
	const target = homeDisplayText(step.context_label);
	const forTarget = target ? ` for ${target}` : "";
	const due = step.due_on ? `Due ${homeDate(step.due_on)}` : null;
	if (step.status === "open" && step.hold_until) {
		return {
			title: homeTitle(`Follow-up on hold${forTarget}`),
			why: homeWhy(`Held until ${homeDate(step.hold_until)}`, savedText),
		};
	}
	const [, name, date, details = ""] = savedText.match(leaseEvent) ?? [];
	if (step.status === "open" && name && date) {
		const label = target || name;
		const dateLabel = date.replace(/^(\w{3})\w*/, "$1");
		const event = `${label} lease event est. ${dateLabel}`;
		const sentences = details.split(/(?<=[.!?])\s+/);
		const savedAction = sentences.find((sentence) =>
			leaseAction.test(sentence),
		);
		const cleanedAction = homeStepText(savedAction ?? "").action;
		const decision =
			cleanedAction
				.replace(/^./, (first) => first.toLowerCase())
				.replace(/\.$/, "") || "decide on renewal or relocation";
		const title = homeTitle(
			event,
			decision,
			`Lease event est. ${dateLabel} for ${label}`,
		);
		return {
			title,
			why: homeWhy(
				title.startsWith(event) ? null : event,
				...sentences.filter(
					(sentence) =>
						sentence !== savedAction ||
						cleanedAction !== savedAction ||
						!title.endsWith(decision),
				),
				due,
			),
		};
	}
	if (step.call_at) {
		const contact = homeDisplayText(step.call_contact);
		const date = homeDate(step.call_at);
		const call = contact
			? `Call with ${contact}`
			: `Call${forTarget} on ${date}`;
		const title = homeTitle(
			`${call} left a follow-up`,
			action || "open the saved step",
		);
		return {
			title,
			why: homeWhy(
				`Call on ${date}`,
				homeDisplayText(evidence?.call_quote ?? null) ||
					homeDisplayText(evidence?.call_summary ?? null) ||
					"Call details unavailable",
				savedText !== action || title.endsWith("…") ? savedText : null,
				due,
			),
		};
	}
	const event = `${step.status === "done" ? "Follow-up completed" : due ? "Follow-up due" : "Follow-up set"}${forTarget}`;
	const title = homeTitle(event, action || "open the saved step");
	if (!evidence) return { title, why: "" };
	const setter = homeDisplayText(evidence.set_by);
	const set = evidence.source_kind
		? `Follow-up set from the ${evidence.source_kind}`
		: setter
			? `Follow-up set by ${setter}`
			: `Follow-up set on ${homeDate(evidence.created_at)}`;
	return {
		title,
		why: homeWhy(
			set,
			homeDisplayText(evidence.source_evidence),
			due,
			savedText !== action ||
				!title.endsWith(action) ||
				(!evidence.source_kind && !setter && !due)
				? savedText
				: null,
		),
	};
}

const dateLabel = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeZone: "America/Chicago",
});
const dateTimeLabel = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeStyle: "short",
	timeZone: "America/Chicago",
});

export function homeDate(date: string) {
	return dateLabel.format(
		new Date(date.length === 10 ? `${date}T12:00:00Z` : date),
	);
}

export function homeWhy(...facts: (string | null)[]) {
	return facts
		.filter((fact): fact is string => Boolean(fact))
		.map((fact) => (/[.!?]$/.test(fact) ? fact : `${fact}.`))
		.join(" ");
}

export function stepTargetFields(db: Transaction<DB>) {
	const openDeals = db
		.selectFrom(selectNextDeals(db).as("board"))
		.select("id")
		.where(isOpenBoardDeal);
	return sql`
		case when s.property_id is not null then (
			select (array_agg(dp.deal_id))[1] from deal_property dp
			where dp.property_id = s.property_id and dp.deal_id in (${openDeals})
			having count(*) = 1
		) end as building_deal_id,
		coalesce(d.name, p.name, property.name, property.address) as context_label,
		exists (select from party_role r where r.party_id = s.party_id
			and r.role = 'lead' and r.stage = 'opportunity'
			and not exists (select from deal_party dp where dp.party_id = r.party_id)) as prospect
	`;
}

export const datedPartnerSteps = sql`
	from home_next_step s
	join app_user u on u.id = s.owner_party_id and u.is_account_partner
	left join deal d on d.id = s.deal_id
	left join party p on p.id = s.party_id
	left join property on property.id = s.property_id
	left join activity c on c.id = s.call_activity_id
	left join party contact on contact.id = coalesce(s.call_contact_party_id, c.from_party_id)
	left join home_mark m on m.user_id = s.owner_party_id and m.item_id = s.id
		and m.item_kind = case when s.call_activity_id is null then 'next_step' else 'call_follow_up' end
	where isfinite(s.due_on)
		and m.disposition is distinct from 'dropped'
		and (m.snoozed_until is null or m.snoozed_until <= now())
`;

export const stepItemId = (step: { id: string; call_id: string | null }) =>
	`${step.call_id ? "capture_post_call_action" : "next_action"}:${step.id}`;

export function dealStepUrl(dealId: string, stepId: string) {
	return `/deals?deal=${dealId}&focus=next-step&step=${stepId}`;
}

type StepTarget = {
	id: string;
	deal_id: string | null;
	party_id: string | null;
	prospect: boolean;
	building_deal_id: string | null;
};

export function stepRecordUrl(step: StepTarget) {
	if (step.deal_id) return dealStepUrl(step.deal_id, step.id);
	if (step.party_id) {
		return step.prospect
			? `/deals?prospect=${step.party_id}&focus=follow-up&step=${step.id}`
			: `/relationships?node=party:${step.party_id}&step=${step.id}`;
	}
	return step.building_deal_id && `/deals?deal=${step.building_deal_id}`;
}

export function stepOpenUrl(step: StepTarget & { call_id: string | null }) {
	return step.call_id ? `/calls?session=${step.call_id}` : stepRecordUrl(step);
}
