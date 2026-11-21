import { type RawBuilder, sql, type Transaction } from "kysely";
import { isCalendarDate } from "../calendar-date.ts";
import type { DB as NextDB } from "../next-database.d.ts";
import { inJsonbOrder, type Reader } from "../reader.ts";
import { UUID } from "../uuid.ts";
import { readLeadBoard, readNextLeadBoard } from "./board.ts";

type CorrespondenceCursor = { occurred_at: string; id: string };
export type HistoryCursors = {
	correspondence: CorrespondenceCursor | null;
	stageHistory: string | null;
};
type Page<Cursor> = {
	total: number;
	has_more: boolean;
	next_cursor: Cursor | null;
};

// One captured activity and one stage change, as `jsonb` printed them.
type Correspondence = CorrespondenceCursor & {
	kind: string;
	summary: string | null;
	detail: string | null;
	source: string | null;
	connected: boolean | null;
};
type StageChange = {
	event_id: string;
	mutation_order: string;
	occurred_at: string;
	prior_stage: string | null;
	stage: string;
	[key: string]: unknown;
};
type DetailFields = {
	phone: string | null;
	email: string | null;
	notes: string | null;
	correspondence_coverage: "captured_entries_only";
	history_limit: 100;
	correspondence: Correspondence[];
	stage_history: StageChange[];
	correspondence_page: Page<CorrespondenceCursor>;
	stage_history_page: Page<string>;
};

type Board = Exclude<
	Awaited<ReturnType<typeof readLeadBoard>>,
	{ error: string }
>;
type BoardLead = Board["leads"][number];

const INSTANT =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const BIGINT_MAX = 9223372036854775807n;
const NEXT_STEP: Record<BoardLead["reachability"]["research_state"], string> = {
	needs_review:
		"Review discrepancies against original sources before working this record.",
	verified:
		"Read the cited sources and confirm the practice decision before drafting outreach.",
	needs_research:
		"Check practice website, professional registry and public filings; record sourced findings with record-finding, including nothing found.",
};

function correspondenceCursor(text: string) {
	let cursor: unknown;
	try {
		cursor = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (
		typeof cursor !== "object" ||
		cursor === null ||
		Array.isArray(cursor) ||
		Object.keys(cursor).length !== 2 ||
		!("id" in cursor && "occurred_at" in cursor)
	)
		return undefined;
	const { id, occurred_at } = cursor;
	return typeof id === "string" &&
		UUID.test(id) &&
		typeof occurred_at === "string" &&
		INSTANT.test(occurred_at) &&
		isCalendarDate(occurred_at.slice(0, 10)) &&
		Number.isFinite(Date.parse(occurred_at))
		? { occurred_at, id }
		: undefined;
}

const isStageCursor = (text: string) =>
	/^[0-9]{1,19}$/.test(text) && BigInt(text) <= BIGINT_MAX;

// The correspondence cursor is the JSON of the last page's `next_cursor`.
// A cursor is refused when malformed, or sent without a lead to open.
export function historyCursors(
	params: URLSearchParams,
): HistoryCursors | undefined {
	const correspondence = params.get("correspondence_cursor");
	const stageHistory = params.get("stage_history_cursor");
	if (correspondence === null && stageHistory === null)
		return { correspondence: null, stageHistory: null };
	if (!params.get("lead_id") || params.get("workspace") !== "leads")
		return undefined;
	const parsed =
		correspondence === null ? null : correspondenceCursor(correspondence);
	return parsed === undefined ||
		(stageHistory !== null && !isStageCursor(stageHistory))
		? undefined
		: { correspondence: parsed, stageHistory };
}

// Each page fetches one row past 100 to tell whether an older page exists.
// The old detail also re-sent `est_lease_event` and `segment` from `lead`,
// the same values the board row already carries.
const detailFields = (
	db: Reader | Transaction<NextDB>,
	sources: {
		lead: RawBuilder<unknown>;
		correspondence: RawBuilder<unknown>;
		stages: RawBuilder<unknown>;
	},
	{ correspondence, stageHistory }: HistoryCursors,
	stageOrder: "mutation_order" | "occurred_at" = "mutation_order",
) => {
	const byTime = stageOrder === "occurred_at";
	const stageDescending = byTime
		? sql`occurred_at desc, mutation_order desc`
		: sql`mutation_order desc`;
	const stageAscending = byTime
		? sql`e.occurred_at, e.mutation_order`
		: sql`e.mutation_order`;
	const beforeStageCursor = byTime
		? sql`(occurred_at, mutation_order) < (select occurred_at, mutation_order
			from stage_history where mutation_order = ${stageHistory}::bigint)`
		: sql`mutation_order < ${stageHistory}::bigint`;
	return sql<{
		id: string;
		fields: DetailFields;
	}>`with opened_lead as materialized (${sources.lead}),
	correspondence as materialized (
		${sources.correspondence}
	), correspondence_tail as materialized (
		select * from correspondence where ${correspondence?.occurred_at ?? null}::timestamptz is null
			or (occurred_at, id) < (${correspondence?.occurred_at ?? null}::timestamptz, ${correspondence?.id ?? null}::uuid)
		order by occurred_at desc, id desc limit 101
	), correspondence_page as materialized (
		select * from correspondence_tail order by occurred_at desc, id desc limit 100
	), stage_history as materialized (
		${sources.stages}
	), stage_tail as materialized (
		select * from stage_history where ${stageHistory}::bigint is null or ${beforeStageCursor}
		order by ${stageDescending} limit 101
	), stage_page as materialized (
		select * from stage_tail order by ${stageDescending} limit 100
	) select l.id, jsonb_build_object('phone', l.phone, 'email', l.email, 'notes', l.notes,
		'correspondence_coverage', 'captured_entries_only', 'history_limit', 100,
		'correspondence', coalesce((select jsonb_agg(to_jsonb(a) - 'lead_id' order by a.occurred_at desc, a.id desc)
			from correspondence_page a), '[]'),
		'stage_history', coalesce((select jsonb_agg(to_jsonb(e) - 'lead_id'
				|| jsonb_build_object('mutation_order', e.mutation_order::text)
				order by ${stageDescending}) from stage_page e), '[]'),
		'correspondence_page', jsonb_build_object('total', (select count(*) from correspondence),
			'has_more', (select count(*) > 100 from correspondence_tail),
			'next_cursor', case when (select count(*) > 100 from correspondence_tail) then
				(select jsonb_build_object('occurred_at', a.occurred_at, 'id', a.id)
				from correspondence_page a order by a.occurred_at, a.id limit 1) end),
		'stage_history_page', jsonb_build_object('total', (select count(*) from stage_history),
			'has_more', (select count(*) > 100 from stage_tail),
			'next_cursor', case when (select count(*) > 100 from stage_tail) then
				(select e.mutation_order::text from stage_page e order by ${stageAscending} limit 1) end)
	) as fields
	from opened_lead l`.execute(db);
};

const legacyDetail = (leadId: string) => ({
	lead: sql`select l.id, p.phone, p.email, l.notes
		from lead l join party p on p.id = l.party_id where l.id = ${leadId}::uuid`,
	correspondence: sql`select * from v_lead_workspace_correspondence where lead_id = ${leadId}::uuid`,
	stages: sql`select * from v_lead_workspace_stage_history where lead_id = ${leadId}::uuid`,
});

const nextDetail = (leadId: string) => ({
	lead: sql`select r.party_id as id,
		(select concat(number, ' x' || extension) from party_phone
			where party_id = r.party_id and is_primary) as phone,
		(select address from party_email where party_id = r.party_id and is_primary) as email,
		(select a.summary from activity_about link join activity a on a.id = link.activity_id
			where link.party_id = r.party_id and a.kind = 'note' and a.summary is not null
			order by a.happened_at desc, a.id desc limit 1) as notes
	from party_role r where r.role = 'lead' and r.party_id = coalesce(
		(select party_id from outside_id where source = 'old_system_lead' and value = ${leadId}),
		${leadId}::uuid)`,
	correspondence: sql`select a.id, a.kind, a.happened_at as occurred_at, a.reached as connected,
		coalesce(es.text, a.summary, e.subject) as summary, e.body as detail, a.changed_by_job as source
	from opened_lead l join activity_about link on link.party_id = l.id
	join activity a on a.id = link.activity_id
	left join email e on e.activity_id = a.id
	left join email_current_summary es on es.activity_id = a.id
	where a.kind in ('email', 'call', 'meeting')`,
	stages: sql`with moves as (
		select m.id::text as event_id, c.id as mutation_order, m.changed_at as occurred_at,
			m.from_stage as prior_stage, m.to_stage as stage, m.reason
		from opened_lead l join lead_stage_move m on m.party_id = l.id
		join change c on c.table_name = 'lead_stage_move' and c.record = jsonb_build_object('id', m.id)
			and c.action = 'insert'
	), history as (
		select c.id::text as event_id, c.id as mutation_order, c.changed_at as occurred_at,
			c.old_value->>'stage' as prior_stage, c.new_value->>'stage' as stage,
			c.new_value->>'reason' as reason
		from opened_lead l join change c on c.table_name = 'party_role'
			and c.record = jsonb_build_object('party_id', l.id, 'role', 'lead')
		where c.new_value->>'stage' is not null and (c.action = 'update' or c.new_value ? 'reason')
	), entries as (
		select * from moves union all
		select h.* from history h where not exists (select from moves m
			where m.occurred_at = h.occurred_at and m.prior_stage = h.prior_stage and m.stage = h.stage)
	)
	select event_id, mutation_order, occurred_at, reason,
		case when prior_stage = 'nurture' then 'nurture_drip' else prior_stage end as prior_stage,
		case when stage = 'nurture' then 'nurture_drip' else stage end as stage
	from entries`,
});

// The old detail merged the board row and the detail fields as one jsonb
// object, then appended the advice, the label and the research summary.
function openLead(lead: BoardLead, fields: DetailFields) {
	const { handling_advice, strategy, reachability, ...row } = lead;
	return {
		...inJsonbOrder({ ...row, ...fields }),
		handling_advice,
		strategy,
		reachability,
		research: {
			state: reachability.research_state,
			evidence: reachability.evidence,
			coverage: "recorded_findings_only",
			external_search_performed: false,
			next_step: NEXT_STEP[reachability.research_state],
		},
	};
}

// The whole board with one lead opened. A lead off the board opens as null.
export async function readLeadDetail(
	db: Reader,
	leadId: string,
	cursors: HistoryCursors,
) {
	// The id cast runs first, so a malformed id is refused before any board
	// limit, as in the old single statement.
	const [opened] = (await detailFields(db, legacyDetail(leadId), cursors)).rows;
	const board = await readLeadBoard(db);
	if ("error" in board) return board;
	const lead = board.leads.find((l) => l.id === opened?.id);
	return {
		...board,
		detail: opened && lead ? openLead(lead, opened.fields) : null,
	};
}

export async function readNextLeadDetail(
	db: Transaction<NextDB>,
	leadId: string,
	cursors: HistoryCursors,
) {
	const [opened] = (
		await detailFields(
			db,
			nextDetail(leadId.toLowerCase()),
			cursors,
			"occurred_at",
		)
	).rows;
	const board = await readNextLeadBoard(db);
	if ("error" in board) return board;
	const lead = board.leads.find((l) => l.party_id === opened?.id);
	if (!opened || !lead) return { ...board, detail: null };
	const detail = openLead({ ...lead, id: leadId }, opened.fields);
	return {
		...board,
		detail: {
			...detail,
			plans: (detail.notes ?? "")
				.replace(
					/^[ \t]*(?:\[(?:web sweep \d{1,2}\/\d{1,2} · finder conf (?:LOW|MEDIUM|HIGH) · verify: UNVERIFIED(?: \([^)\r\n]*\))?|finder conf (?:LOW|MEDIUM|HIGH))\](?=[ \t]|\r?$)[ \t]*)+/gim,
					"",
				)
				.trim(),
			handling_advice: null,
			research: {
				...detail.research,
				next_step:
					detail.research.state === "needs_research"
						? "Check the practice website, professional registry and public filings. Save what you find."
						: detail.research.next_step,
			},
		},
	};
}
