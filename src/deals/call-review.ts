import { type Expression, sql, type Transaction } from "kysely";
import { visibleSuggestion } from "../home-inbox-review.ts";
import type { DB } from "../next-database.d.ts";
import { ACTING_USER } from "../next-save.ts";

export const visibleCall = (userId: string | Expression<string> | null) =>
	sql<boolean>`call_visible_to(a.changed_by_user_id, a.changed_by_job,
		a.changed_for_user_id, ${userId}::uuid)`;

const sharedCopiedCall = visibleCall(null);

export const visibleCallProposal = (userId: string | Expression<string>) =>
	sql<boolean>`(${visibleCall(userId)}
		and (not (${sharedCopiedCall}) or p.proposed_by_job = 'old_system')
		and case when p.kind = 'next_step_done' then
			step.owner_party_id = ${userId}::uuid and (p.status <> 'pending' or step.status = 'open')
		else p.decided_by_user_id = ${userId}::uuid or ${visibleSuggestion(userId)} end)`;

export const copiedCallStep = sql<boolean>`p.kind = 'next_step'
	and p.proposed_by_job = 'old_system' and p.activity_kind in ('call', 'meeting')
	and p.deal_id is not null`;

export const privateCallLog = sql<boolean>`p.kind = 'log_call' and not (${sharedCopiedCall})`;

export const stepTextKey = (what: string) =>
	what.replace(/\s+/gu, " ").trim().toLowerCase();

const openDealStep = (
	dealId: string | Expression<string | null>,
	ownerId: Expression<string>,
) => sql`from next_step existing
	where existing.deal_id = ${dealId}::uuid and existing.owner_party_id = ${ownerId}
		and existing.status = 'open' and existing.item_title is null and existing.property_id is null`;

export async function lockOpenDealStep(
	tx: Transaction<DB>,
	{
		dealId,
		owner,
		what,
	}: { dealId: string; owner: string | null; what: string | null },
) {
	await sql`select from deal where id = ${dealId}::uuid for no key update`.execute(
		tx,
	);
	const {
		rows: [existing],
	} = await sql<{ id: string; what: string }>`
		select existing.id, existing.what
		${openDealStep(dealId, sql<string>`coalesce(${owner}::uuid, ${ACTING_USER})`)}
		for no key update`.execute(tx);
	return (
		existing && {
			id: existing.id,
			matches:
				what !== null && stepTextKey(existing.what) === stepTextKey(what),
		}
	);
}

export const openCopiedCallStepText = (userId: string) => sql<string | null>`
	case when p.status = 'pending' and (${copiedCallStep}) then (
		select existing.what
		${openDealStep(sql.ref("p.deal_id"), sql<string>`coalesce(p.owner_party_id, ${userId}::uuid)`)}
	) end`;
