import { sql, type Transaction } from "kysely";
import type { DB } from "../next-database.d.ts";
import { STAGE_ORDER } from "./board.ts";
import { DEFAULT_CADENCE, quietProposals } from "./quiet-follow-ups.ts";

// The Leads board's stages before any filter; Archived shows only when chosen.
const BOARD_STAGES = STAGE_ORDER.filter((stage) => stage !== "archived");

// The board's New from email and Follow-up late badges, counted over the
// leads it shows unfiltered, as the app's leadBadgeCounts did.
export async function readLeadCounts(db: Transaction<DB>) {
	const { rows } = await sql<{
		new_from_email: number;
		follow_ups_late: number;
	}>`with late as (
			select q.party_id from (${quietProposals(DEFAULT_CADENCE, null)}) q
			where q.subject_type = 'lead' and q.days_overdue > 0
		)
		select count(*) filter (where exists (select from lead_email_attention a
				where a.party_id = r.party_id and a.acknowledged_at is null))::int as new_from_email,
			count(*) filter (where r.party_id in (select party_id from late))::int as follow_ups_late
		from party_role r
		where r.role = 'lead' and r.stage = any(${BOARD_STAGES}::text[])
			and r.lead_client_id is null
			and not exists (select from client c where c.party_id = r.party_id)
			and not exists (select from deal_party d where d.party_id = r.party_id
				and d.role in ('client', 'client_contact'))
			and not exists (select from active_do_not_contact dnc where dnc.party_id = r.party_id)`.execute(
		db,
	);
	return { schema_version: "lead-counts.v1", ...rows[0] };
}
