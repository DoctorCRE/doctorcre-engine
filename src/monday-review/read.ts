import { Hono } from "hono";
import { type Expression, sql, type Transaction } from "kysely";
import { answerNextRead, checkFields, Refusal, refuse } from "../answer.ts";
import { isCalendarDate } from "../calendar-date.ts";
import { isOpenBoardDeal, selectNextDeals } from "../deals/next-board.ts";
import { ENDED_PHASES } from "../deals/shared.ts";
import type { DB } from "../next-database.d.ts";
import { prospectQuery } from "../prospects/read.ts";

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
	const target = sql`jsonb_strip_nulls(jsonb_build_object('week_of', ${week}::date,
		'deal_id', ${deal}::uuid, 'party_id', ${prospect}::uuid))`;
	return sql<number>`(select coalesce(max(id), 0)::float8 from change
		where table_name = 'weekly_review' and (new_value @> ${target} or old_value @> ${target}))`;
}

function reviewItems(db: Transaction<DB>, week: string) {
	const board = selectNextDeals(db)
		.where("c.party_id", "is not", null)
		.select([
			"d.created_at as arrived_at",
			"p.happened_at as phase_at",
			"p.changed_at as phase_saved_at",
		]);
	const prospects = prospectQuery(db, { includeDropped: true });
	return sql`
		with bounds as (
			select day, day::timestamp at time zone 'America/Chicago' as starts_at,
				(day + 7)::timestamp at time zone 'America/Chicago' as ends_at
			from (select ${week}::date as day) week
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
		select d.id as deal_id, null::uuid as party_id, d.state, d.name,
			coalesce(converted.party_id, d.id) as sort_id,
			case when converted.party_id is not null then converted.entered_at else d.arrived_at end as arrived_at,
			case when converted.party_id is not null then
				case when converted.entered_at >= d.starts_at then 3 else 2 end
				when d.operating_state = 'parked' then 4 when d.arrived_at >= d.starts_at then 3 else 1 end as section,
			array_position(array[${sql.join(boardPhases)}]::text[], d.monday_phase) as phase_order,
			to_jsonb(d) - array['id','arrived_at','phase_at','phase_saved_at','starts_at','ends_at',
				'monday_phase','state','ended_this_week'] as fields
		from deal_items d cross join bounds w
		-- Conversion creates the client or client-contact link in the deal's own save.
		left join lateral (
			select link.party_id, entry.entered_at
			from deal_party link
			join party_role lead on lead.party_id = link.party_id and lead.role = 'lead'
			left join lateral (
				select c.new_value->>'stage' as stage,
					coalesce((c.new_value->>'created_at')::timestamptz, c.changed_at) as entered_at
				from change c where c.table_name = 'party_role'
					and c.record = jsonb_build_object('party_id', link.party_id, 'role', 'lead')
					and c.new_value ? 'stage' and c.changed_at <= d.arrived_at
				order by c.id desc limit 1
			) entry on true
			where d.arrived_at >= d.starts_at and link.deal_id = d.id
				and link.role in ('client', 'client_contact') and link.created_at = d.arrived_at
				and coalesce(entry.stage, lead.stage) = 'opportunity'
				and not exists (select from deal_party earlier where earlier.party_id = link.party_id
					and earlier.created_at < d.arrived_at)
			order by link.role desc, link.party_id limit 1
		) converted on true
		where d.state = 'open' or ((d.monday_phase is null or d.monday_phase not in (${sql.join(ENDED_PHASES)}))
			and (d.ended_this_week or d.closed_on::date between w.day and w.day + 6
				or d.invoiced_on::date between w.day and w.day + 6))
		union all
		select null, p.party_id, case when p.dropped is null then 'open' else 'dropped' end,
			p.name, p.party_id, p.entered_at, case when p.entered_at >= w.starts_at then 3 else 2 end, null,
			(to_jsonb(p) - array['notes', 'entered_at', 'dropped'])
				|| jsonb_build_object('latest_note', (p.notes->0) - 'activity_id')
				|| case when p.dropped is null then '{}'::jsonb else jsonb_build_object('dropped', p.dropped) end
		from (${prospects}) p cross join bounds w
		where (p.entered_at is null or p.entered_at < w.ends_at)
			and (p.dropped is null or ((p.dropped->>'at')::timestamptz >= w.starts_at
				and (p.dropped->>'at')::timestamptz < w.ends_at))
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
			case when i.section in (1, 4) then i.name end, i.sort_id
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
