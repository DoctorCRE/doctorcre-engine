import { createHash } from "node:crypto";
import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { filingReviewNeeded, filingScope } from "./activity/filing-evidence.ts";
import { lockEmail } from "./activity/next-record.ts";
import { answerNextRead, Refusal, refuse } from "./answer.ts";
import { isCalendarDate } from "./calendar-date.ts";
import type { JsonObject } from "./database.d.ts";
import { sourceInMailbox } from "./home-email-thread.ts";
import { readProposal } from "./home-inbox-review.ts";
import type { DB } from "./next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "./next-door.ts";
import { cancelCurrentStep, resolveStepOwner } from "./next-steps.ts";
import { saveOpenStep } from "./open-step.ts";
import {
	clearable,
	type Fitted,
	fit,
	fitting,
	isAmount,
	isInstant,
	isStoredText,
	isText,
	isUuid,
	optional,
	orNull,
} from "./request-shape.ts";
import { SaveRefusal } from "./save.ts";

const kinds = [
	"next_step",
	"next_step_done",
	"phase_move",
	"new_lead",
	"lead_stage_move",
	"file_to_deal",
	"possible_new_deal",
	"log_call",
] as const;
const shape = {
	idempotency_key: isUuid,
	kind: (v: unknown): v is (typeof kinds)[number] => kinds.some((k) => k === v),
	activity_id: isUuid,
	evidence: isText,
	deal_id: optional(isUuid),
	next_step_id: optional(isUuid),
	party_id: optional(isUuid),
	property_id: optional(isUuid),
	what: optional(isText),
	owner_party_id: optional(isUuid),
	owner: optional(isText),
	to: optional(isText),
	on: optional(isCalendarDate),
	due_on: optional(isCalendarDate),
	how_found: optional(isText),
	from_stage: optional(isText),
	to_stage: optional(isText),
	strength: optional(
		(v: unknown): v is "strong" | "weak" => v === "strong" || v === "weak",
	),
	reason: optional(isText),
};
const textWithin =
	(max: number, min = 1) =>
	(v: unknown): v is string =>
		typeof v === "string" &&
		(min === 0 || isText(v)) &&
		v.length >= min &&
		v.length <= max;
const emailLead = {
	idempotency_key: isUuid,
	address: textWithin(320),
	display_name: optional(orNull(textWithin(200, 0))),
	summary: textWithin(300),
	first_seen_at: isInstant,
	message_ref: textWithin(100),
	message_id: optional(
		(v): v is string => isStoredText(v) && v === v.trim() && !/[<>]/.test(v),
	),
	conversation_id: optional(isStoredText),
	applies_to: (v: unknown): v is "new_matter" => v === "new_matter",
	confidence: (v: unknown): v is number => isAmount(v) && v >= 0 && v <= 1,
	evidence_quote: optional(textWithin(500, 10)),
};
const edits = {
	what: optional(isText),
	owner_party_id: clearable(
		(value): value is string =>
			isUuid(value) || (typeof value === "string" && value.trim() === ""),
	),
	due_on: clearable(isCalendarDate),
};
const decision = {
	idempotency_key: isUuid,
	decision: (v: unknown): v is "accept" | "dismiss" =>
		v === "accept" || v === "dismiss",
	edits: optional(fitting(edits)),
	deal_id: optional(isUuid),
	vendor_id: optional(isUuid),
	reason: optional(isText),
};
const fail = (
	status: 400 | 404 | 409 | 422,
	error: Refusal["error"],
	extra: JsonObject = {},
): never => {
	throw new SaveRefusal(new Refusal(status, error, extra));
};

// A quote advances only one milestone, using the deal's present phase and kind.
function phaseMove(phase: string | null, kind: string | null, quote: string) {
	const loi = /\b(?:l\.?o\.?i\b\.?|letter of intent\b)/i.test(quote);
	const signed = /\b(signed|executed)\b/i.test(quote);
	if (
		phase === "research" &&
		/\btours?\b/i.test(quote) &&
		/\b(scheduled|confirmed|set)\b/i.test(quote)
	)
		return "site_selection";
	if (phase === "site_selection" && loi) return "negotiation";
	const lease = kind === "lease" && !loi && /\blease\b/i.test(quote);
	if (
		phase === "negotiation" &&
		((loi && signed) ||
			(lease &&
				/\b(sent|issued|circulated|out for (legal )?review)\b/i.test(quote)))
	)
		return "legal";
	if (phase === "legal" && lease && signed) return "closing";
	return null;
}
async function dealNow(tx: Transaction<DB>, id: string) {
	const deal = await tx
		.selectFrom("deal")
		.select("kind")
		.where("id", "=", id)
		.forUpdate()
		.executeTakeFirst();
	if (!deal) return fail(404, "not_found");
	const phase = await tx
		.selectFrom("deal_phase_change")
		.select([
			"phase",
			sql<string>`to_char(happened_at at time zone 'America/Chicago', 'YYYY-MM-DD')`.as(
				"started_on",
			),
		])
		.where("deal_id", "=", id)
		.orderBy("happened_at", "desc")
		.executeTakeFirst();
	return {
		kind: deal.kind,
		phase: phase?.phase ?? null,
		startedOn: phase?.started_on,
	};
}

async function statedTarget(
	tx: Transaction<DB>,
	{
		to,
		on,
		reason,
	}: Pick<Fitted<typeof shape>, "on" | "reason"> & { to: string },
	{ phase, startedOn }: Awaited<ReturnType<typeof dealNow>>,
) {
	if (
		to === phase ||
		(to === "dead" && !reason) ||
		(on && startedOn && on < startedOn)
	)
		return fail(422, "phase_not_eligible");
	const target = await tx
		.selectFrom("phase")
		.select("slug")
		.where("slug", "=", to)
		.executeTakeFirst();
	return target?.slug ?? fail(422, "phase_not_eligible");
}

export const proposalJobs = new Hono<NextSaveEnv>()
	.post("/proposals/email-lead", async (c) => {
		const stamp = c.get("stamp");
		if (stamp.job !== "mail_capture")
			return refuse(c, new Refusal(403, "unknown_job"));
		const owner = stamp.for_user;
		if (!owner) return refuse(c, new Refusal(422, "actor_not_provisioned"));
		return answerNextSave(
			c,
			"email-lead-proposal",
			(b) =>
				fit(b, emailLead, [
					"idempotency_key",
					"address",
					"summary",
					"first_seen_at",
					"message_ref",
					"applies_to",
					"confidence",
				]),
			async (tx, r) => {
				const address = r.address.trim().toLowerCase();
				const source = "outlook-intake";
				const sourceKey = `email-sha256:${owner}:${createHash("sha256").update(address).digest("hex")}`;
				const details = {
					message_ref: r.message_ref,
					message_id: r.message_id,
					conversation_id: r.conversation_id,
					first_seen_at: r.first_seen_at,
					reading: {
						applies_to: "new_matter",
						confidence: r.confidence,
						evidence_quote: r.evidence_quote ?? null,
					},
				};
				const {
					rows: [candidate],
				} = await sql<{ id: string }>`
					insert into candidate (source, source_key, source_row, name, qualification)
					select ${source}, ${sourceKey}, ${JSON.stringify(details)}::jsonb
						|| jsonb_build_object('address', ${address}::email_address),
						${r.display_name?.trim() || address}, ${r.summary}
					where not exists (select from party_email where address = ${address}::email_address)
					on conflict (source, source_key) do nothing returning id`.execute(tx);
				if (candidate) {
					return tx
						.insertInto("proposal")
						.values({
							kind: "email_lead",
							candidate_id: candidate.id,
							proposed_by_job: "mail_capture",
							evidence: r.summary,
							changed_at: sql<string>`now()`,
						})
						.returning(["id as proposal_id", "status"])
						.executeTakeFirstOrThrow();
				}
				const prior = await tx
					.selectFrom("candidate")
					.leftJoin("proposal", "proposal.candidate_id", "candidate.id")
					.select([
						"candidate.id as candidate_id",
						"proposal.id as proposal_id",
						"proposal.status",
					])
					.where("candidate.source", "=", source)
					.where("candidate.source_key", "=", sourceKey)
					.executeTakeFirst();
				if (!prior) return { status: "known_party" };
				if (!prior.proposal_id)
					return { candidate_id: prior.candidate_id, status: "already_queued" };
				return {
					proposal_id: prior.proposal_id,
					status: prior.status,
					existing: true,
				};
			},
			(result) => (result.status === "pending" && !result.existing ? 201 : 200),
		);
	})
	.post("/proposals", async (c) => {
		return answerNextSave(
			c,
			"proposal-store",
			(b) =>
				fit(b, shape, ["idempotency_key", "kind", "activity_id", "evidence"]),
			async (tx, r) => {
				const activity = await tx
					.selectFrom("activity")
					.select("kind")
					.where("id", "=", r.activity_id)
					.executeTakeFirst();
				if (!activity)
					return fail(404, "not_found", { activity_id: r.activity_id });
				const stated = r.to !== undefined;
				if (
					(stated &&
						(r.kind !== "phase_move" ||
							!["call", "meeting"].includes(activity.kind))) ||
					(r.on && !stated)
				)
					return fail(400, "invalid_field_value", { fields: ["to", "on"] });
				if (r.owner !== undefined && r.kind !== "next_step")
					return fail(400, "invalid_field_value", { fields: ["owner"] });
				const owner = await resolveStepOwner(tx, r);
				let from: string | null = null,
					to: string | null = null;
				if (r.kind === "phase_move" && r.deal_id) {
					const d = await dealNow(tx, r.deal_id);
					from = d.phase;
					to =
						r.to === undefined
							? phaseMove(from, d.kind, r.evidence)
							: await statedTarget(tx, { ...r, to: r.to }, d);
					if (!to) return fail(422, "phase_not_eligible");
				}
				const toStage = r.kind === "new_lead" ? "new" : (r.to_stage ?? null);
				const { rows } = await sql<{
					id: string;
					status: string;
					existing: boolean;
				}>`
   insert into proposal (kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, party_id, property_id,
    what, owner_party_id, due_on, from_phase, to_phase, phase_stated, phase_on, how_found, from_stage, to_stage, strength, reason, next_step_id)
   values (${r.kind}, ${r.activity_id}::uuid, ${activity.kind}, ${r.evidence}, current_setting('engine.job'),
    ${r.deal_id ?? null}::uuid, ${r.party_id ?? null}::uuid, ${r.property_id ?? null}::uuid,
    ${r.what ?? null}, ${owner ?? null}::uuid, ${r.due_on ?? null}::date, ${from}, ${to}, ${stated}, ${r.on ?? null}::date,
    ${r.how_found ?? null}, ${r.from_stage ?? null}, ${toStage}, ${r.strength ?? null}, ${r.reason ?? null}, ${r.next_step_id ?? null}::uuid)
   on conflict do nothing returning id, status, false as existing`.execute(tx);
				if (rows[0]) return { proposal_id: rows[0].id, status: rows[0].status };
				const prior = await tx
					.selectFrom("proposal")
					.select(["id", "status"])
					.where("activity_id", "=", r.activity_id)
					.where("kind", "=", r.kind)
					.where(sql<boolean>`deal_id is not distinct from ${r.deal_id ?? null}::uuid and party_id is not distinct from ${r.party_id ?? null}::uuid
    and property_id is not distinct from ${r.property_id ?? null}::uuid and from_phase is not distinct from ${from} and to_phase is not distinct from ${to}
    and phase_stated = ${stated} and phase_on is not distinct from ${r.on ?? null}::date
    and next_step_id is not distinct from ${r.next_step_id ?? null}::uuid
    and what is not distinct from ${r.what ?? null} and owner_party_id is not distinct from ${owner ?? null}::uuid
    and due_on is not distinct from ${r.due_on ?? null}::date and how_found is not distinct from ${r.how_found ?? null}
    and from_stage is not distinct from ${r.from_stage ?? null} and to_stage is not distinct from ${toStage}`)
					.executeTakeFirstOrThrow();
				return { proposal_id: prior.id, status: prior.status, existing: true };
			},
			(result) => (result.existing ? 200 : 201),
		);
	})
	.post("/proposals/:id/decision", (c) =>
		refuse(c, new Refusal(403, "user_decides")),
	);

const filingKinds = ["file_to_deal", "possible_new_deal"];

// Filing decisions and mail jobs take the same email locks before changing proposals.
async function lockFiling(
	tx: Transaction<DB>,
	p: {
		id: string;
		kind: string;
		activity_id: string | null;
		deal_id: string | null;
		filing_scope: string | null;
	},
) {
	const { rows } = await sql<{ id: string; message_id: string | null }>`
		select sibling.id, coalesce(e.message_id, e.activity_id::text) as message_id
		from proposal sibling
		left join email e on e.activity_id = sibling.activity_id
		where sibling.id = ${p.id}::uuid or (${p.filing_scope}::text is null
			and ${filingScope("sibling")} is null and sibling.kind = ${p.kind}
			and sibling.deal_id is not distinct from ${p.deal_id}::uuid
			and sibling.status = 'pending'
			and sibling.activity_id in (
				select thread.activity_id from email source
				join email thread on thread.activity_id = source.activity_id
					or thread.conversation_id = source.conversation_id
				where source.activity_id = ${p.activity_id}::uuid
			)
			and ${sourceInMailbox(sql.ref("sibling.activity_id"), sql<string>`current_setting('engine.user_id')`)})
	`.execute(tx);
	for (const messageId of [
		...new Set(rows.map((row) => row.message_id)),
	].sort())
		if (messageId) await lockEmail(tx, messageId);
	const { rows: members } = await sql<{ id: string }>`
		select sibling.id from proposal sibling
		where sibling.id = any(${rows.map((row) => row.id)}::uuid[])
			and (sibling.id = ${p.id}::uuid or (sibling.status = 'pending' and
				(sibling.kind <> 'file_to_deal' or
					${filingReviewNeeded(sql.ref("sibling.activity_id"), sql.ref("sibling.deal_id"))})))
		order by sibling.id for update
	`.execute(tx);
	return members.map((row) => row.id);
}

export const proposalDecisions = new Hono<NextSaveEnv>().post(
	"/proposals/:id/decision",
	(c) =>
		answerNextSave(
			c,
			"proposal-decide",
			(b) => {
				const proposal_id = c.req.param("id");
				if (!isUuid(proposal_id)) return new Refusal(404, "not_found");
				const parsed = fit(b, decision, ["idempotency_key", "decision"]);
				return parsed instanceof Refusal ? parsed : { ...parsed, proposal_id };
			},
			async (tx, r) => {
				const clicked = await tx
					.selectFrom("proposal")
					.select([
						"id",
						"kind",
						"activity_id",
						"deal_id",
						filingScope("proposal").as("filing_scope"),
					])
					.where("id", "=", r.proposal_id)
					.executeTakeFirst();
				const members =
					clicked && filingKinds.includes(clicked.kind)
						? await lockFiling(tx, clicked)
						: [r.proposal_id];
				const p = await tx
					.selectFrom("proposal")
					.selectAll()
					.where("id", "=", r.proposal_id)
					// A direct decision clears the mailbox stamp and records the owner as decider.
					.where(sql<boolean>`(kind <> 'email_lead' or coalesce(decided_by_user_id, changed_for_user_id)
						= nullif(current_setting('engine.user_id', true), '')::uuid)`)
					.where(sql<boolean>`(${filingScope("proposal")} is null or
						${sourceInMailbox(sql.ref("proposal.activity_id"), sql<string>`current_setting('engine.user_id')`)})`)
					.forUpdate()
					.executeTakeFirst();
				if (!p) return fail(404, "not_found");
				if (p.status !== "pending")
					return fail(409, "already_decided", {
						status: p.status,
						decided_by: p.decided_by_user_id,
					});
				const accepts = r.decision === "accept";
				const filing = filingKinds.includes(p.kind);
				if (
					(r.edits && p.kind !== "next_step") ||
					(r.deal_id && !filing) ||
					(r.vendor_id &&
						(!accepts ||
							!p.filing_scope ||
							p.filing_scope === "deal" ||
							r.deal_id)) ||
					(accepts && p.filing_scope === "vendor" && !r.vendor_id) ||
					(r.reason && accepts && !filing)
				)
					return fail(422, "invalid_field_value");
				if (r.decision === "accept" && p.kind === "phase_move" && p.deal_id) {
					const d = await dealNow(tx, p.deal_id);
					if (
						d.phase !== p.from_phase ||
						(!p.phase_stated &&
							phaseMove(d.phase, d.kind, p.evidence) !== p.to_phase)
					)
						return fail(409, "version_conflict", { current_phase: d.phase });
				}
				if (
					r.decision === "accept" &&
					p.kind === "lead_stage_move" &&
					p.party_id
				) {
					const lead = await tx
						.selectFrom("party_role")
						.select("stage")
						.where("party_id", "=", p.party_id)
						.where("role", "=", "lead")
						.forUpdate()
						.executeTakeFirst();
					if (lead?.stage !== p.from_stage)
						return fail(409, "version_conflict", {
							current_stage: lead?.stage ?? null,
						});
				}
				const filingDeal = r.deal_id ?? p.deal_id;
				if (r.decision === "accept" && filing && filingDeal) {
					await dealNow(tx, filingDeal);
				}

				const { owner_party_id: editedOwner, ...stepEdits } = r.edits ?? {};
				const ownerEdit = isUuid(editedOwner) ? editedOwner : undefined;
				const owner = ownerEdit ?? p.owner_party_id;
				const updateDecision = () =>
					sql<{
						id: string;
						status: string;
						decided_at: string;
						filed_deal_id: string | null;
					}>`update proposal
   set status = ${accepts ? "accepted" : "dismissed"}, filed_deal_id = ${accepts ? (r.deal_id ?? null) : null}::uuid,
	${r.vendor_id ? sql`filed_vendor_id = ${r.vendor_id}::uuid,` : sql``}
    filing_reason = ${accepts ? (r.reason ?? null) : null},
    dismiss_reason = ${accepts ? null : (r.reason?.trim() ?? null)} where id = any(${members}::uuid[])
   returning id, status, decided_at::text, filed_deal_id`.execute(tx);
				const { rows } =
					accepts && p.kind === "next_step"
						? await saveOpenStep(
								tx,
								{ ...p, owner_party_id: owner },
								async () => {
									if (
										p.deal_id &&
										(p.activity_kind === "call" ||
											p.activity_kind === "meeting")
									)
										await cancelCurrentStep(
											tx,
											{ kind: "deal", id: p.deal_id },
											owner,
										);
									if (ownerEdit)
										await sql`select set_config('engine.proposal_step_owner', ${ownerEdit}, true)`.execute(
											tx,
										);
									return updateDecision();
								},
							)
						: await updateDecision();
				const decided = rows.find((row) => row.id === p.id);
				if (accepts && Object.keys(stepEdits).length)
					await tx
						.updateTable("next_step")
						.set(stepEdits)
						.where("id", "=", p.id)
						.execute();
				const promoted =
					r.decision === "accept" && p.candidate_id
						? await tx
								.selectFrom("candidate")
								.select("promoted_party_id")
								.where("id", "=", p.candidate_id)
								.executeTakeFirstOrThrow()
						: undefined;
				const created =
					r.decision === "dismiss" || p.kind === "next_step_done"
						? {}
						: p.kind === "next_step"
							? { next_step_id: p.id }
							: p.kind === "phase_move"
								? { deal_id: p.deal_id }
								: promoted
									? { party_id: promoted.promoted_party_id }
									: {
											activity_id: p.kind === "log_call" ? p.id : p.activity_id,
										};
				return {
					proposal_id: p.id,
					status: decided?.status ?? null,
					decided_at: decided?.decided_at ?? null,
					created,
					...(p.next_step_id && { next_step_id: p.next_step_id }),
				};
			},
		),
);

proposalDecisions.get("/proposals/:id", async (c) => {
	const id = c.req.param("id");
	if (!isUuid(id)) return refuse(c, new Refusal(404, "not_found"));
	const dealId = c.req.query("deal_id");
	if (dealId !== undefined && !isUuid(dealId))
		return refuse(
			c,
			new Refusal(400, "invalid_field_value", { fields: ["deal_id"] }),
		);
	return answerNextRead(c, "read-proposal", (tx, userId) =>
		readProposal(tx, userId, id, dealId),
	);
});
