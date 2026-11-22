import { type Expression, sql } from "kysely";
import { visibleSuggestion } from "../home-inbox-review.ts";

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

export const copiedAssignedAction = sql<boolean>`p.kind = 'next_step'
	and p.proposed_by_job = 'old_system' and p.activity_kind in ('call', 'meeting')
	and p.deal_id is not null and p.owner_party_id is not null`;

export const callAcceptanceBlock = sql<
	"private_call" | "open_step_exists" | null
>`
	case when p.status = 'pending' then case
		when p.kind = 'log_call' and not (${sharedCopiedCall}) then 'private_call'
		when ${copiedAssignedAction} and exists (
			select from next_step existing
			where existing.deal_id = p.deal_id and existing.owner_party_id = p.owner_party_id
				and existing.status = 'open' and existing.item_title is null
				and existing.owner_party_id is not null and existing.property_id is null
		) then 'open_step_exists'
	end end`;
