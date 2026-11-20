import { sql, type Transaction } from "kysely";
import type { DB as NextDB } from "../next-database.d.ts";
import type { Reader } from "../reader.ts";
import {
	isServable,
	type OpportunityTiming,
	opportunityTiming,
	timingEvents,
} from "./opportunity-timing.ts";
import {
	type ContactInputs,
	EVIDENCE_LIMIT,
	type Finding,
	reachability,
} from "./reachability.ts";

// One `v_lead_workspace` row with its prospect fields and timing, as the old
// system serialized it. Only the fields the engine reads are named.
type WorkspaceLead = {
	[key: string]: unknown;
	id: string;
	base_version: number;
	stage: string;
	contact_state: string;
	est_lease_event: string | null;
	event_confidence: string | null;
	next_action_date: string | null;
	opportunity_timing: OpportunityTiming;
};
type Hold = { reason: "contact_ineligible" | "unsupported_stage" };

const CONTACTABLE_STATES = new Set(["active", "nurture"]);
const STAGE_ORDER = [
	"new",
	"qualified",
	"outreach_active",
	"engaged",
	"nurture",
	"opportunity",
	"archived",
];
const DEAL_OBJECTIVE =
	"Coordinate with the linked client and deal before creating competing follow-up.";
const OPEN_OBJECTIVES = new Map([
	[
		"new",
		"Verify identity and discover whether the practice has a real estate decision.",
	],
	[
		"qualified",
		"Confirm the decision window, decision makers and an appropriate introduction.",
	],
	[
		"outreach_active",
		"Follow the agreed next step and offer one useful reason to respond.",
	],
	[
		"engaged",
		"Understand requirements and agree the next decision with the practice.",
	],
	[
		"nurture_drip",
		"Respect the requested timing and return with useful, relevant information.",
	],
	["opportunity", DEAL_OBJECTIVE],
	["active_deal", DEAL_OBJECTIVE],
]);
const CLOSED_OBJECTIVES = new Map([
	[
		"closed_won",
		"Closed won. Coordinate any post-close follow-up with the owning partner.",
	],
	[
		"closed_lost",
		"Closed lost. Review the recorded close with the owning partner before any future outreach.",
	],
]);
const DISCOVERY = [
	"What has the practice already tried?",
	"What constraints and timing are firm?",
	"Who approves the decision?",
	"What would make the practice stop?",
	"What would success look like in 90 days?",
];

// Each list fetches one row past the limit so an overflow can refuse the board.
const partyFindings = sql<Finding[]>`coalesce((select jsonb_agg(to_jsonb(f)
		order by f.observed_at desc, f.flag_id)
	from (select flag_id, kind, found, expired, proposes_correction, source, observed_at,
		expires_on, value from v_record_flag_subject f
		where (f.subject_type = 'party' and f.subject_id = b.party_id)
			or exists (select from v_ref_index r where r.party_id = b.party_id
				and r.subject_type = f.subject_type and r.subject_id = f.subject_id)
		order by observed_at desc, flag_id limit ${EVIDENCE_LIMIT + 1}) f), '[]')`;
const contactInputs = sql<ContactInputs>`jsonb_build_object('party_id', b.party_id,
	'created_at', b.created_at, 'email', party.email, 'cell', null, 'phone', party.phone,
	'activities', coalesce((select jsonb_agg(to_jsonb(a) order by a.occurred_at desc, a.id)
	from (select id, lead_id, kind, connected, occurred_at, source, detail
		from v_lead_workspace_correspondence where lead_id = b.id
			and occurred_at >= b.created_at and occurred_at >= now() - interval '90 days'
			and occurred_at <= now()
		order by occurred_at desc, id limit ${EVIDENCE_LIMIT + 1}) a), '[]'))`;

// to_jsonb keeps the old key order (PostgreSQL's, by key length) and its
// number and timestamp text.
const leadsInBoardOrder = (db: Reader) =>
	db
		.selectFrom((eb) =>
			eb
				.selectFrom("v_lead_workspace as w")
				.leftJoin("v_lead_prospect_engagement as p", "p.lead_id", "w.id")
				.leftJoin(timingEvents.as("timing"), "timing.party_id", "w.party_id")
				.selectAll("w")
				.select([
					"p.prospect_client_id",
					"p.prospect_client_version",
					"p.prospect_engagement_status",
					opportunityTiming.as("opportunity_timing"),
				])
				.as("b"),
		)
		.innerJoin("party", "party.id", "b.party_id")
		.select(sql<WorkspaceLead>`to_jsonb(b)`.as("lead"))
		.select([partyFindings.as("findings"), contactInputs.as("contact")])
		.orderBy("b.stage_sort")
		.orderBy("b.score", (ob) => ob.desc().nullsLast())
		.orderBy("b.name")
		.orderBy("b.id")
		.execute();

// The view drops suppressed leads, and a do-not-contact stage is always
// suppressed, so neither old check can fail here.
function advise(lead: WorkspaceLead) {
	const contact_eligible = CONTACTABLE_STATES.has(lead.contact_state);
	const open = OPEN_OBJECTIVES.get(lead.stage);
	const closed = CLOSED_OBJECTIVES.get(lead.stage);
	const hold: Hold | null = !contact_eligible
		? { reason: "contact_ineligible" }
		: !open && !closed
			? { reason: "unsupported_stage" }
			: null;
	return {
		...lead,
		contact_eligible,
		handling_advice: hold
			? "Do not contact. Review the recorded restriction or terminal stage with the owning partner."
			: (closed ??
				`${open} Research the handed record before preparing an outreach draft.`),
		strategy: {
			basis: "stage_based_guidance",
			hold,
			objective: hold
				? "Resolve the recorded hold before any outreach."
				: (closed ?? open),
			discovery: DISCOVERY,
			decision_window: lead.est_lease_event,
			confidence: lead.event_confidence || "unrecorded",
			next_step: hold
				? "Ask the owning partner to review the hold."
				: lead.next_action_date
					? `Respect the recorded next action date ${lead.next_action_date}.`
					: "Agree a next step and date; silence is not consent.",
			channel:
				"Use a verified contact route. Keep outreach as a draft for a partner to send.",
			risk: "Do not infer personal circumstances, intent, or a confirmed lease expiry from a sourcing signal.",
			sent: false,
		},
	};
}

type Row = Awaited<ReturnType<typeof leadsInBoardOrder>>[number];

// The served lead: the row as `to_jsonb` printed it, then the old projection.
type BoardLead = WorkspaceLead &
	ReturnType<typeof advise> & {
		reachability: Awaited<ReturnType<typeof reachability>>;
	};

// The old projection threw on bad timing at once but on a limit only after an
// await, so bad timing on any lead beat a limit on an earlier one.
function refusal(rows: Row[]) {
	if (!rows.every(({ lead }) => isServable(lead.opportunity_timing)))
		return "invalid_lead_opportunity_timing";
	for (const { findings, contact } of rows) {
		if (findings.length > EVIDENCE_LIMIT)
			return "research_evidence_limit_exceeded";
		if (contact.activities.length > EVIDENCE_LIMIT)
			return "contact_evidence_limit_exceeded";
	}
	return null;
}

export async function readLeadBoard(db: Reader) {
	return leadBoard(await leadsInBoardOrder(db));
}

export async function readNextLeadBoard(db: Transaction<NextDB>) {
	const { rows } = await sql<Row>`
		with board as (
			select coalesce(legacy.value, p.id::text) as id,
				p.id as party_id, p.name, p.name as entity_name,
				case when p.kind = 'person' then p.name end as doctor_name,
				(select company.name from party_company pc join party company on company.id = pc.company_id
					where pc.person_id = p.id and pc.ended_on is null
					order by pc.started_on desc nulls last, company.id limit 1) as practice_name,
				p.city, (select s.label from party_specialty ps join specialty s on s.slug = ps.specialty
					where ps.person_id = p.id order by s.slug limit 1) as specialty,
				r.created_at, r.changed_at as updated_at,
				case when r.stage = 'nurture' then 'nurture_drip' else r.stage end as stage,
				s.label as stage_label, array_position(${STAGE_ORDER}::text[], r.stage) as stage_sort,
				r.lane, r.segment, r.estimated_lease_on as est_lease_event,
				r.lease_estimate_confidence as event_confidence,
				u.slug as owner, owner.name as owner_label,
				(select max(c.id) from change c where c.table_name = 'party_role'
					and c.record = jsonb_build_object('party_id', p.id, 'role', 'lead')) as base_version,
				dnc.party_id is not null as do_not_contact,
				case when dnc.party_id is null then 'active' else 'do_not_contact' end as contact_state,
				client.party_id is not null as is_client,
				exists (select from deal_party d where d.party_id = p.id
					and d.role in ('client', 'client_contact')) as is_deal,
				(select min(due_on) from next_step n where n.party_id = p.id and n.status = 'open') as next_action_date,
				(select max(a.happened_at) from activity_about link join activity a on a.id = link.activity_id
					where link.party_id = p.id and a.kind in ('email', 'call', 'meeting')) as last_touch,
				false as suppressed, '[]'::jsonb as possible_clients,
				null as score, null as score_reason, null as last_stage_move,
				null as state, null as county, null as registry_ref, null as prospect_client_id,
				null as prospect_client_version, null as prospect_engagement_status,
				client.party_id as client_id, client.party_id is not null as linked_client,
				jsonb_build_object('contract', 'lead-opportunity-timing.v1', 'record_added_at', r.created_at,
					'status', 'unknown', 'events', '[]'::jsonb) as opportunity_timing
			from party_role r join party p on p.id = r.party_id
			join stage s on s.role = r.role and s.slug = r.stage
			left join app_user u on u.id = r.owner_user_id
			left join party owner on owner.id = u.id
			left join active_do_not_contact dnc on dnc.party_id = p.id
			left join client on client.party_id = p.id
			left join lateral (
				select min(value) as value from outside_id where source = 'old_system_lead' and party_id = p.id
			) legacy on true
			where r.role = 'lead'
		)
		select to_jsonb(b) as lead, '[]'::jsonb as findings,
			jsonb_build_object('party_id', b.party_id, 'created_at', b.created_at,
				'email', (select address from party_email where party_id = b.party_id and is_primary),
				'phone', (select number from party_phone where party_id = b.party_id and is_primary),
				'cell', null, 'activities', '[]'::jsonb) as contact
		from board b order by b.stage_sort, b.name, b.id`.execute(db);
	return leadBoard(rows);
}

async function leadBoard(rows: Row[]) {
	const error = refusal(rows);
	if (error) return { error } as const;
	const now = Date.now();
	return {
		schema_version: "lead-workspace.v1",
		generated_at: new Date(now).toISOString(),
		leads: await Promise.all(
			rows.map(async ({ lead, findings, contact }): Promise<BoardLead> => {
				const advised = advise(lead);
				return {
					...advised,
					reachability: await reachability(advised, findings, contact, now),
				};
			}),
		),
		last_search_at: null,
		search_run_coverage: "unavailable",
	};
}
