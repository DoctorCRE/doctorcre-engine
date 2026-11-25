import { sql, type Transaction } from "kysely";
import { isOpenBoardDeal, selectNextDeals } from "./deals/next-board.ts";
import { shortHomeTitle, stripHomeTitlePrefixes } from "./home-title.ts";
import type { DB } from "./next-database.d.ts";

const stepMetadata =
	/\b(?:[CL]-\d+|V-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d+|T\s*[-−]\s*\d+\s*(?:days?|weeks?|months?|years?)|loop\s*#\s*\d+)\b/gi;
const storedDate =
	/\b(?:(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) )?(\d{4}-\d{2}-\d{2})([T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?\b/g;
const edgePunctuation = /^[\s:;,·–—-]+|[\s:;,·–—-]+$/g;
const markdownLink = /\[([^\]]+)\]\(((?:[^\s()]|\([^\s()]*\))+)\)/g;

export function homeDisplayText(text: string | null) {
	return (text ?? "")
		.replace(/(^|\n)[ \t]*(?:#{1,6}|[-+*]|\d+[.)]|>)[ \t]+/g, "$1")
		.replace(markdownLink, "$1")
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

type StepWording = {
	what: string;
	item_title: string | null;
};

export type HomeStep = StepWording & {
	context_label: string | null;
	status: string | null;
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

function stepInstruction(what: string) {
	const urls: string[] = [];
	let marker = "\uE000";
	while (what.includes(marker)) marker += "\uE000";
	const mask = (link: string) => `${marker}${urls.push(link) - 1}${marker}`;
	const linkStart = /https?:\/\/\S+|\[((?:\\.|[^[\]\\])*)\]\(/gi;
	let masked = "";
	let sectionStart = 0;
	for (let match = linkStart.exec(what); match; match = linkStart.exec(what)) {
		masked += what.slice(sectionStart, match.index);
		const [link, label] = match;
		if (label === undefined) {
			masked += mask(link);
		} else {
			const before = what[match.index - 1];
			if (!label || /[\\\r\n]/.test(label) || before === "\\" || before === "!")
				return what;
			const start = linkStart.lastIndex;
			let end = start;
			let depth = 1;
			while (depth > 0 && end < what.length) {
				const character = what.charAt(end);
				if (/[\s\\<>]/.test(character)) return what;
				if (character === "(") depth++;
				if (character === ")") depth--;
				end++;
			}
			if (depth !== 0 || end === start + 1) return what;
			masked += mask(`${label} (${what.slice(start, end - 1)})`);
			linkStart.lastIndex = end;
		}
		sectionStart = linkStart.lastIndex;
	}
	masked += what.slice(sectionStart);
	if (masked.includes("](")) return what;
	return homeStepText(masked.replace(/\(\s*T-\d+\s*\)/gi, " ")).replace(
		new RegExp(`${marker}(\\d+)${marker}`, "g"),
		(_, index: string) => urls[Number(index)] ?? "",
	);
}

export function stepCopy({ what, item_title }: StepWording) {
	const instruction = stepInstruction(what);
	const title =
		item_title?.trim() || shortHomeTitle(instruction) || "Next step";
	return {
		title,
		instruction: instruction && instruction !== title ? instruction : null,
	};
}

export function homeStepCopy(step: HomeStep, evidence: StepEvidence) {
	const { title, instruction } = stepCopy(step);
	const hold =
		step.status === "open" && step.hold_until
			? `Held until ${homeDate(step.hold_until)}`
			: null;
	const withoutEnd = (text: string) => text.replace(/[.!?]+$/, "");
	const extraEvidence = (text: string) => {
		const wording = withoutEnd(text);
		return wording === withoutEnd(title) ||
			(instruction && wording === withoutEnd(instruction))
			? null
			: text;
	};
	const setter = homeDisplayText(evidence.set_by);
	const set = evidence.source_kind
		? `Follow-up set from the ${evidence.source_kind}`
		: setter
			? `Follow-up set by ${setter}`
			: `Follow-up set on ${homeDate(evidence.created_at)}`;
	const contact = homeDisplayText(step.call_contact);
	const details = step.call_at
		? homeWhy(
				`Call${contact ? ` with ${contact}` : ""} on ${homeDate(step.call_at)}`,
				extraEvidence(
					homeDisplayText(evidence.call_quote) ||
						homeDisplayText(evidence.call_summary) ||
						"Call details unavailable",
				),
				hold,
			)
		: homeWhy(
				hold || set,
				extraEvidence(homeDisplayText(evidence.source_evidence)),
			);
	return { title, why: homeWhy(instruction, details) };
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

export const stepItemId = (step: { id: string; call_follow_up: boolean }) =>
	`${step.call_follow_up ? "capture_post_call_action" : "next_action"}:${step.id}`;

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
