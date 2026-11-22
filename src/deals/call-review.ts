import { type Expression, sql, type Transaction } from "kysely";
import { visibleSuggestion } from "../home-inbox-review.ts";
import type { DB } from "../next-database.d.ts";
import { ACTING_USER } from "../next-save.ts";

const sharedCopiedCall = sql<boolean>`a.changed_by_job = 'old_system'
	and a.changed_by_user_id is null and a.changed_for_user_id is null`;

export const visibleCall = (userId: string | Expression<string>) =>
	sql<boolean>`(${userId}::uuid in (a.changed_by_user_id, a.changed_for_user_id)
		or (${sharedCopiedCall}))`;

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

const stepTextKey = (what: string | null | Expression<string | null>) =>
	sql<string>`lower(btrim(regexp_replace(${what}, ${"[\u0009-\u000d \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+"}, ' ', 'g')))`;

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
	} = await sql<{ id: string; matches: boolean }>`
		select existing.id, ${stepTextKey(sql.ref("existing.what"))} = ${stepTextKey(what)} as matches
		${openDealStep(dealId, sql<string>`coalesce(${owner}::uuid, ${ACTING_USER})`)}
		for no key update`.execute(tx);
	return existing;
}

export const callAcceptanceBlock = (userId: string) => sql<
	"private_call" | "open_step_exists" | null
>`
	case when p.status = 'pending' then case
		when ${privateCallLog} then 'private_call'
		when ${copiedCallStep} and exists (
			select ${openDealStep(sql.ref("p.deal_id"), sql<string>`coalesce(p.owner_party_id, ${userId}::uuid)`)}
				and ${stepTextKey(sql.ref("existing.what"))} <> ${stepTextKey(sql.ref("p.what"))}
		) then 'open_step_exists'
	end end`;
