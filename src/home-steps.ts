import { sql, type Transaction } from "kysely";
import { isOpenBoardDeal, selectNextDeals } from "./deals/next-board.ts";
import {
	homeTitle,
	savedHomeTitle,
	stripHomeTitlePrefixes,
} from "./home-title.ts";
import type { DB } from "./next-database.d.ts";

const stepMetadata =
	/\b(?:[CL]-\d+|V-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d+|T\s*[-−]\s*\d+\s*(?:days?|weeks?|months?|years?)|loop\s*#\s*\d+)\b/gi;
const storedDate =
	/\b(?:(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) )?(\d{4}-\d{2}-\d{2})([T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?\b/g;
const edgePunctuation = /^[\s:;,·–—-]+|[\s:;,·–—-]+$/g;
const phoneNumber =
	/(?<!\w)(?:at\s+)?(?:\+[1-9](?:[ .-]?\d){7,14}|(?:\+?1[ .-]?)?(?:\(\d{3}\)\s*|\d{3}[ .-]?)\d{3}[ .-]?\d{4})(?:\s*(?:ext\.?|x)\s*\d+)?(?!\w)/gi;
const meetingSuffix =
	/\s*\|\s*([^|]+, (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\p{L}*,? \p{L}{3,9} \d{1,2}(?:,? \d{4},?)? \d{1,2}:\d{2}\s*[AP]M\.?)$/iu;
const vendorCadence = /^Relationship touch\b.*\b(\d+-day vendor cadence)\.?$/i;

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
	return stripHomeTitlePrefixes(homeDisplayText(text));
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

export function homeStepCopy(step: StepTitle, evidence?: StepEvidence) {
	const savedText = homeStepText(step.title.replace(/\(\s*T-\d+\s*\)/gi, " "));
	const target = homeDisplayText(step.context_label);
	const contact = homeDisplayText(step.call_contact);
	const due = step.due_on ? `Due ${homeDate(step.due_on)}` : null;
	const hold =
		step.status === "open" && step.hold_until
			? `Held until ${homeDate(step.hold_until)}`
			: null;
	const meeting = meetingSuffix.exec(savedText);
	const savedAction = meeting ? savedText.slice(0, meeting.index) : savedText;
	const wording = savedAction
		.replace(phoneNumber, " ")
		.replace(/\s+/g, " ")
		.replace(edgePunctuation, "");
	const cadence = vendorCadence.exec(savedText)?.[1];
	const title = cadence
		? homeTitle("vendor_check_in", target)
		: savedHomeTitle(wording) ||
			(contact
				? homeTitle("call_follow_up", contact)
				: homeTitle("follow_up", target));
	const instruction =
		title === wording
			? savedAction
					.match(phoneNumber)
					?.map((number) => number.replace(/^at\s+/i, ""))
					.join(", ")
			: savedAction;
	const titleWords = title.replace(/[\p{P}\s]+$/gu, "").split(/\s+/);
	const titlePrefix = new RegExp(
		`^${titleWords.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")}(?=$|[\\s\\p{P}])`,
		"iu",
	);
	const remaining = instruction
		?.replace(titlePrefix, "")
		.replace(/^[\s\p{P}]+/u, "");
	const detail =
		instruction && titlePrefix.test(instruction)
			? remaining
				? remaining.charAt(0).toUpperCase() + remaining.slice(1)
				: null
			: instruction;
	const details = homeWhy(cadence ?? detail ?? null, meeting?.[1] ?? null);
	const action = title.replace(/[.!?]+$/, "");
	const extraEvidence = (text: string) =>
		text.replace(/[.!?]+$/, "") === action ? null : text;
	if (step.call_at) {
		return {
			title,
			why: homeWhy(
				`Call${contact ? ` with ${contact}` : ""} on ${homeDate(step.call_at)}`,
				extraEvidence(
					homeDisplayText(evidence?.call_quote ?? null) ||
						homeDisplayText(evidence?.call_summary ?? null) ||
						"Call details unavailable",
				),
				details,
				hold,
				due,
			),
		};
	}
	if (!evidence) return { title, why: details };
	const setter = homeDisplayText(evidence.set_by);
	const set = evidence.source_kind
		? `Follow-up set from the ${evidence.source_kind}`
		: setter
			? `Follow-up set by ${setter}`
			: `Follow-up set on ${homeDate(evidence.created_at)}`;
	return {
		title,
		why: homeWhy(
			hold || set,
			extraEvidence(homeDisplayText(evidence.source_evidence)),
			due,
			details,
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

export function stepTargetFields(db: Transaction<DB>, today = homeDay) {
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
		exists (select from party_role r
			where r.role = 'vendor' and r.party_id in (
				select s.party_id
				union all
				select pc.company_id from party_company pc
				where pc.person_id = s.party_id
					and (pc.started_on is null or pc.started_on <= ${today})
					and (pc.ended_on is null or pc.ended_on > ${today})
			)) as has_vendor_role,
		exists (select from party_role r where r.party_id = s.party_id
			and r.role = 'lead' and r.stage = 'opportunity'
			and not exists (select from deal_party dp where dp.party_id = r.party_id)) as prospect
	`;
}

export const homeDayAt = (now = sql`now()`) =>
	sql<string>`(${now} at time zone 'America/Chicago')::date`;
export const homeDay = homeDayAt();

export const datedPartnerSteps = (now = sql`now()`) => sql`
	from next_step s
	join app_user u on u.id = s.owner_party_id and u.is_account_partner
	left join deal d on d.id = s.deal_id
	left join party p on p.id = s.party_id
	left join property on property.id = s.property_id
	left join activity c on c.id = s.call_activity_id
	left join party contact on contact.id = coalesce(s.call_contact_party_id, c.from_party_id)
	left join home_mark m on m.user_id = s.owner_party_id and m.item_id = s.id
		and m.item_kind = case when s.call_activity_id is null then 'next_step' else 'call_follow_up' end
	where s.status = 'open' and isfinite(s.due_on)
		and (s.hold_until is null or s.hold_until <= ${homeDayAt(now)})
		and m.disposition is distinct from 'dropped'
		and (m.snoozed_until is null or m.snoozed_until <= ${now})
`;

export type HomeStepTarget = {
	deal_id: string | null;
	building_deal_id: string | null;
	property_id: string | null;
	has_vendor_role: boolean;
};

export function homeStepTarget(step: HomeStepTarget) {
	if (step.deal_id || step.building_deal_id) return "deal";
	if (step.has_vendor_role) return "vendor";
	if (step.property_id) return "building";
	return "other";
}

export const homeStepShown = (step: HomeStepTarget) =>
	["deal", "vendor", "building"].includes(homeStepTarget(step));

export function homeStepEligible(
	step: HomeStepTarget & { due_on: string | null },
	today: string,
) {
	return homeStepShown(step) && (!step.due_on || step.due_on <= today);
}

export const lateLabel = (days: number) =>
	`${days} ${days === 1 ? "day" : "days"} late`;

export const stepItemId = (step: { id: string; call_id: string | null }) =>
	`${step.call_id ? "capture_post_call_action" : "next_action"}:${step.id}`;

export function dealStepUrl(dealId: string, stepId: string) {
	return `/deals?deal=${dealId}&focus=next-step&step=${stepId}`;
}

type StepTarget = Pick<
	HomeStepTarget,
	"deal_id" | "building_deal_id" | "has_vendor_role"
> & {
	id: string;
	party_id: string | null;
	prospect: boolean;
};

export function stepRecordUrl(step: StepTarget) {
	if (step.deal_id) return dealStepUrl(step.deal_id, step.id);
	if (step.party_id) {
		return step.prospect && !step.has_vendor_role
			? `/deals?prospect=${step.party_id}&focus=follow-up&step=${step.id}`
			: `/relationships?node=party:${step.party_id}&step=${step.id}`;
	}
	return step.building_deal_id && `/deals?deal=${step.building_deal_id}`;
}

export function stepOpenUrl(step: StepTarget & { call_id: string | null }) {
	return step.call_id ? `/calls?session=${step.call_id}` : stepRecordUrl(step);
}
