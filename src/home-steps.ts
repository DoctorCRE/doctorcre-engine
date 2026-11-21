import { sql, type Transaction } from "kysely";
import { isOpenBoardDeal, selectNextDeals } from "./deals/next-board.ts";
import type { DB } from "./next-database.d.ts";

const stepMetadata =
	/\b(?:[CL]-\d+|V-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d+|T\s*[-−]\s*\d+\s*(?:days?|weeks?|months?|years?)|loop\s*#\s*\d+)\b/gi;
const storedDate =
	/\b(?:(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) )?(\d{4}-\d{2}-\d{2})([T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?\b/g;

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
		.replace(/^[\s:;,·–—-]+|[\s:;,·–—-]+$/g, "");
}

export function homeStepText(text: string) {
	return homeDisplayText(text).replace(/^(?:NONE|HOLD)(?:\s*[—–:-]\s*|$)/i, "");
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
	left join home_mark m on m.user_id = s.owner_party_id and m.item_id = s.id
		and m.item_kind = case when s.call_activity_id is null then 'next_step' else 'call_follow_up' end
	where s.due_on is not null
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
