import { sql, type Transaction } from "kysely";
import type { DB as NextDB } from "../next-database.d.ts";
import type { Reader } from "../reader.ts";
import {
	copiedLeadIdentity,
	lastRecordedContacts,
	openPartySteps,
} from "./follow-up-reads.ts";
import {
	isServable,
	type OpportunityTiming,
	opportunityTiming,
	timingEvents,
} from "./opportunity-timing.ts";
import {
	CONTACT_FRESHNESS_DAYS,
	type ContactInputs,
	EVIDENCE_LIMIT,
	type Finding,
	reachability,
} from "./reachability.ts";
import { leadVersions } from "./versions.ts";

// One `v_lead_workspace` row with its prospect fields and timing, as the old
// system serialized it. Only the fields the engine reads are named.
type WorkspaceLead = {
	[key: string]: unknown;
	id: string;
	base_version: number;
	stage: string;
	party_id?: string;
	stage_label?: string | null;
	owner_label?: string | null;
	new_from_email?: boolean;
	contact_state: string;
	est_lease_event: string | null;
	event_confidence: string | null;
	next_action_date: string | null;
	opportunity_timing: OpportunityTiming;
};
// The new read also places each lead in one market, or none.
type NextLead = WorkspaceLead & { market: { id: string; name: string } | null };
type Hold = { reason: "contact_ineligible" | "unsupported_stage" };

const CONTACTABLE_STATES = new Set(["active", "nurture"]);
export const STAGE_ORDER = [
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
function advise<Lead extends WorkspaceLead>(lead: Lead) {
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

type Row<Lead extends WorkspaceLead = WorkspaceLead> = Omit<
	Awaited<ReturnType<typeof leadsInBoardOrder>>[number],
	"lead"
> & { lead: Lead };

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

// The city half of the deal copy's market rule; county matching waits for a lead county (#1370).
// A city that names no market or town, or towns in more than one market, places the lead nowhere.
const marketByCity = sql`select case when count(*) = 1
	then jsonb_build_object('id', min(m.id::text), 'name', min(m.name)) end
	from market m where lower(btrim(m.name)) = lower(btrim(p.city))
		or exists (select from market_city c where c.market_id = m.id and lower(c.city) = lower(btrim(p.city)))`;

export async function readNextLeadBoard(db: Transaction<NextDB>) {
	const { rows } = await sql<Row<NextLead>>`
		with board as (
			select coalesce(legacy.value, p.id::text) as id,
				p.id as party_id, p.name, p.name as entity_name,
				case when p.kind = 'person' then p.name end as doctor_name,
				(select company.name from party_company pc join party company on company.id = pc.company_id
					where pc.person_id = p.id and pc.ended_on is null
					order by pc.started_on desc nulls last, company.id limit 1) as practice_name,
				p.city, (${marketByCity}) as market,
				(select s.label from party_specialty ps join specialty s on s.slug = ps.specialty
					where ps.person_id = p.id order by s.slug limit 1) as specialty,
				r.created_at, r.changed_at as updated_at,
				case when r.stage = 'nurture' then 'nurture_drip' else r.stage end as stage,
				s.label as stage_label, array_position(${STAGE_ORDER}::text[], r.stage) as stage_sort,
				r.lane, r.segment, r.estimated_lease_on as est_lease_event,
				r.lease_estimate_confidence as event_confidence,
				u.slug as owner, owner.name as owner_label,
				exists (select from lead_email_attention a where a.party_id = p.id
					and a.acknowledged_at is null) as new_from_email,
				versions.base_version,
				dnc.party_id is not null as do_not_contact,
				case when dnc.party_id is null then 'active' else 'do_not_contact' end as contact_state,
				client.party_id is not null as is_client,
				exists (select from deal_party d where d.party_id = p.id
					and d.role in ('client', 'client_contact')) as is_deal,
				(select min(due_on) from (${openPartySteps(sql.ref("p.id"))}) steps) as next_action_date,
				recorded.happened_at as last_touch,
				false as suppressed,
				case when client.party_id is null and r.lead_client_id is null
					and dnc.party_id is null then coalesce(matches.items, '[]') else '[]' end as possible_clients,
				null as score, null as score_reason, null as last_stage_move,
				null as state, null as county, legacy.registry_ref, null as prospect_client_id,
				null as prospect_client_version, null as prospect_engagement_status,
				coalesce(client.party_id, r.lead_client_id) as client_id,
				coalesce(client.party_id, r.lead_client_id) is not null as linked_client,
				jsonb_build_object('contract', 'lead-opportunity-timing.v1', 'record_added_at', r.created_at,
					'status', 'unknown', 'events', '[]'::jsonb) as opportunity_timing
			from party_role r join party p on p.id = r.party_id
			left join (${leadVersions}) versions on versions.party_id = p.id::text
			join stage s on s.role = r.role and s.slug = r.stage
			left join app_user u on u.id = r.owner_user_id
			left join party owner on owner.id = u.id
			left join active_do_not_contact dnc on dnc.party_id = p.id
			left join (${lastRecordedContacts}) recorded on recorded.party_id = p.id
			left join client on client.party_id = p.id
			-- A lead that is not itself a client never matches its own party.
			left join (
				select lower(btrim(cp.name)) as name_key,
					jsonb_agg(jsonb_build_object('client_id', cp.id, 'name', cp.name) order by cp.id) as items
				from client match join party cp on cp.id = match.party_id group by 1
			) matches on matches.name_key = lower(btrim(p.name))
				and client.party_id is null and r.lead_client_id is null and dnc.party_id is null
			left join lateral (${copiedLeadIdentity(sql.ref("p.id"))}) legacy on true
			where r.role = 'lead'
		)
		select to_jsonb(b) as lead, '[]'::jsonb as findings,
			jsonb_build_object('party_id', b.party_id, 'created_at', b.created_at,
				'email', (select address from party_email where party_id = b.party_id and is_primary),
				'phone', (select concat(number, ' x' || extension) from party_phone
					where party_id = b.party_id and is_primary),
				'cell', (select concat(number, ' x' || extension) from party_phone
					where party_id = b.party_id and label = 'mobile'
					order by is_primary desc, created_at desc, id limit 1),
				'activities', coalesce((select jsonb_agg(to_jsonb(a) order by a.occurred_at desc, a.id)
					from (select a.id, b.id as lead_id, a.kind, a.reached as connected,
						a.happened_at as occurred_at, coalesce(a.changed_by_job, u.slug) as source,
						null as detail
					from activity_about link join activity a on a.id = link.activity_id
					left join app_user u on u.id = a.changed_by_user_id
					where link.party_id = b.party_id and a.kind in ('email', 'call', 'meeting')
						and a.happened_at >= greatest(b.created_at, now() - make_interval(days => ${CONTACT_FRESHNESS_DAYS}))
						and a.happened_at <= now()
					order by a.happened_at desc, a.id limit ${EVIDENCE_LIMIT + 1}) a), '[]')) as contact
		from board b order by b.stage_sort, b.name, b.id`.execute(db);
	const board = await leadBoard(rows);
	if (board.error) return { error: board.error } as const;
	const markets = await db
		.selectFrom("market")
		.select(["id", "name"])
		.orderBy("name")
		.orderBy("id")
		.execute();
	const counts = Map.groupBy(board.leads, (lead) => lead.market?.id);
	return {
		...board,
		market_counts: markets.map((market) => ({
			...market,
			count: counts.get(market.id)?.length ?? 0,
		})),
	};
}

async function leadBoard<Lead extends WorkspaceLead>(rows: Row<Lead>[]) {
	const error = refusal(rows);
	if (error) return { error } as const;
	const now = Date.now();
	return {
		schema_version: "lead-workspace.v1",
		generated_at: new Date(now).toISOString(),
		leads: await Promise.all(
			rows.map(async ({ lead, findings, contact }) => {
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
