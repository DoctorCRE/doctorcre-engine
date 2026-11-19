import { Hono } from "hono";
import { type Expression, sql, type Transaction } from "kysely";
import { answerNextRead, checkFields, Refusal, refuse } from "../answer.ts";
import { isCalendarDate } from "../calendar-date.ts";
import { isOpenBoardDeal, selectNextDeals } from "../deals/next-board.ts";
import { ENDED_PHASES } from "../deals/shared.ts";
import type { DB } from "../next-database.d.ts";
import { isProspect, prospectQuery } from "../prospects/read.ts";

import type { DatabaseEnv } from "../reader.ts";

export const isMonday = (day: unknown): day is string =>
	isCalendarDate(day) &&
	// PostgreSQL dates have no year zero.
	!day.startsWith("0000") &&
	new Date(`${day}T00:00:00Z`).getUTCDay() === 1;

const boardPhases = [
	"pending",
	"research",
	"site_selection",
	"negotiation",
	"legal",
	"due_diligence",
	"closing",
];

export function reviewVersion(
	week: Expression<unknown>,
	deal: Expression<unknown>,
	prospect: Expression<unknown>,
) {
	return sql<number>`(select coalesce(max(id), 0)::float8 from change
		where table_name = 'weekly_review' and coalesce(new_value, old_value) @>
			jsonb_strip_nulls(jsonb_build_object('week_of', ${week}::date,
				'deal_id', ${deal}::uuid, 'party_id', ${prospect}::uuid)))`;
}

function reviewItems(db: Transaction<DB>, week: string) {
	const board = selectNextDeals(db)
		.where("c.party_id", "is not", null)
		.select([
			"d.created_at as arrived_at",
			"p.happened_at as phase_at",
			"p.changed_at as phase_saved_at",
		]);
	const prospects = prospectQuery({
		qualifies: sql<boolean>`p.id in (select party_id from lead_items)`,
	});
	return sql`
		with bounds as (
			select day, day::timestamp at time zone 'America/Chicago' as starts_at,
				(day + 7)::timestamp at time zone 'America/Chicago' as ends_at
			from (select ${week}::date as day) week
		), lead_items as materialized (
			select r.party_id, history.entered_at as arrived_at,
				case when r.stage = 'archived' then 'dropped' else 'open' end as state
			from party_role r cross join bounds w
			cross join lateral (
				select max(c.changed_at) filter (where c.new_value->>'stage' = 'opportunity') as entered_at,
					max(c.changed_at) filter (where c.new_value->>'stage' = 'archived'
						and c.old_value->>'stage' = 'opportunity') as dropped_at
				from change c where c.table_name = 'party_role'
					and c.record = jsonb_build_object('party_id', r.party_id, 'role', 'lead')
			) history
			where r.role = 'lead' and (${isProspect} or
				(r.stage = 'archived' and history.dropped_at >= w.starts_at and history.dropped_at < w.ends_at
					and not exists (select from deal_party d where d.party_id = r.party_id
						and d.created_at <= history.dropped_at)))
		), deal_items as (
			select board.*, prior.monday_phase, w.starts_at, w.ends_at,
				case when ${isOpenBoardDeal} then 'open'
					when outcome = 'lost' or board.phase = 'dead' then 'lost' else 'closed' end as state,
				-- A lone terminal phase can be a copied observation, with no known date for the move.
				board.phase_saved_at >= w.starts_at and board.phase_saved_at < w.ends_at
					and board.phase in (${sql.join(ENDED_PHASES)})
					and exists (select from deal_phase_change earlier where earlier.deal_id = board.id
						and earlier.happened_at < board.phase_at
						and earlier.phase not in (${sql.join(ENDED_PHASES)})) as ended_this_week
			from (${board}) board cross join bounds w
			left join lateral (
				select phase as monday_phase from deal_phase_change
				where deal_id = board.id and happened_at < w.starts_at and changed_at < w.starts_at
				order by happened_at desc limit 1
			) prior on true
			where board.arrived_at < w.ends_at
		)
		select d.id as deal_id, null::uuid as party_id, d.state, d.name, d.arrived_at,
			case when d.operating_state = 'parked' then 4 when d.arrived_at >= d.starts_at then 3 else 1 end as section,
			array_position(array[${sql.join(boardPhases)}]::text[], d.monday_phase) as phase_order,
			to_jsonb(d) - array['id','arrived_at','phase_at','phase_saved_at','starts_at','ends_at',
				'monday_phase','state','ended_this_week'] as fields
		from deal_items d cross join bounds w
		where d.state = 'open' or ((d.monday_phase is null or d.monday_phase not in (${sql.join(ENDED_PHASES)}))
			and (d.ended_this_week or d.closed_on::date between w.day and w.day + 6
				or d.invoiced_on::date between w.day and w.day + 6))
		union all
		select null, p.party_id, l.state, p.name, l.arrived_at,
			case when l.arrived_at >= w.starts_at then 3 else 2 end, null,
			(to_jsonb(p) - 'notes') || jsonb_build_object('latest_note', (p.notes->0) - 'activity_id')
		from (${prospects}) p join lead_items l using (party_id) cross join bounds w
		where l.arrived_at is null or l.arrived_at < w.ends_at
	`;
}

async function readReview(db: Transaction<DB>, week: string) {
	const { rows } = await sql<{ item: object }>`
		select i.fields || jsonb_strip_nulls(jsonb_build_object('deal_id', i.deal_id, 'party_id', i.party_id))
			|| jsonb_build_object('state', i.state, 'seen_change_id', ${reviewVersion(sql.val(week), sql`i.deal_id`, sql`i.party_id`)},
				'reviewed', case when mark.id is not null then
					jsonb_build_object('review_id', mark.id, 'by', reviewer.slug, 'at', mark.changed_at) end) as item
		from (${reviewItems(db, week)}) i
		left join weekly_review mark on mark.week_of = ${week}::date
			and (mark.deal_id = i.deal_id or mark.party_id = i.party_id)
		left join app_user reviewer on reviewer.id = mark.changed_by_user_id
		order by i.section, case when i.section in (1, 4) then i.phase_order end nulls last,
			case when i.section in (2, 3) then i.arrived_at end,
			case when i.section in (1, 4) then i.name end, coalesce(i.deal_id, i.party_id)
	`.execute(db);
	return { items: rows.map(({ item }) => item) };
}

export const mondayReviewReads = new Hono<DatabaseEnv>().get(
	"/weekly-reviews",
	async (c): Promise<Response> => {
		const params = new URL(c.req.url).searchParams;
		const error = checkFields(params, ["week_of"]);
		if (error) return refuse(c, error);
		const [week, extra] = params.getAll("week_of");
		if (extra !== undefined || !isMonday(week))
			return refuse(
				c,
				new Refusal(400, "invalid_field_value", { fields: ["week_of"] }),
			);
		return answerNextRead(c, "read-weekly-reviews", (db) =>
			readReview(db, week),
		);
	},
);
