import { sql, type Transaction } from "kysely";
import { isOpenBoardDeal, selectNextDeals } from "./deals/next-board.ts";
import type { DB } from "./next-database.d.ts";

const stepMetadata =
	/\b(?:[CL]-\d+|V-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d+|T\s*[-−]\s*\d+\s*(?:days?|weeks?|months?|years?)|loop\s*#\s*\d+)\b/gi;

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
		.replace(/ +([,.;:!?])/g, "$1")
		.replace(/^[\s:;,·–—-]+|[\s:;,·–—-]+$/g, "");
}

const dateLabel = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
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

export const stepItemId = (step: { id: string; call_id: string | null }) =>
	`${step.call_id ? "capture_post_call_action" : "next_action"}:${step.id}`;

export function dealStepUrl(dealId: string, stepId?: string) {
	return `/deals?deal=${dealId}&focus=next-step${stepId ? `&step=${stepId}` : ""}`;
}

export function stepOpenUrl(
	step: {
		id: string;
		call_id: string | null;
		deal_id: string | null;
		party_id: string | null;
		prospect: boolean;
		building_deal_id: string | null;
	},
	done = false,
) {
	return step.call_id
		? `/calls?session=${step.call_id}`
		: step.deal_id
			? dealStepUrl(step.deal_id, done ? undefined : step.id)
			: step.party_id
				? step.prospect
					? `/deals?prospect=${step.party_id}&focus=follow-up&step=${step.id}`
					: `/relationships?node=party:${step.party_id}&step=${step.id}`
				: step.building_deal_id && `/deals?deal=${step.building_deal_id}`;
}
