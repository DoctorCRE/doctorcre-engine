import { sql, type Transaction } from "kysely";
import { isOpenBoardDeal, selectNextDeals } from "./deals/next-board.ts";
import type { DB } from "./next-database.d.ts";

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
			? `/deals?deal=${step.deal_id}&focus=next-step${done ? "" : `&step=${step.id}`}`
			: step.party_id
				? step.prospect
					? `/deals?prospect=${step.party_id}&focus=follow-up`
					: `/relationships?node=party:${step.party_id}`
				: step.building_deal_id && `/deals?deal=${step.building_deal_id}`;
}
