import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { jsonBuildObject } from "kysely/helpers/postgres";
import { Refusal, refuse } from "../answer.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { fit } from "../request-shape.ts";
import { isUuid } from "../uuid.ts";
import { activeOpenDeal, dealAttention } from "./attention.ts";
import { selectDealState } from "./next-board.ts";
import { hasForecastDate, planFactsOf, planForRead } from "./plan-read.ts";

type EvaluatedDeal = {
	deal_id: string;
	owner_user_id: string;
	reason: string | null;
	prior_reason: string | null;
	prior_owner: string | null;
};

type AlertTarget = {
	deal_id: string;
	owner_user_id: string;
	reason: string;
};

type AttentionAlertSweep = {
	alerted: number;
	unchanged: number;
	cleared: number;
};

async function quietHolds(
	tx: Transaction<DB>,
	ownerIds: string[],
	now: Date,
): Promise<Map<string, string | null>> {
	const { rows } = await sql<{
		owner_user_id: string;
		held_until: string | null;
	}>`
		select owners.owner_user_id,
			case
				when p.quiet_from is null or p.quiet_until is null then null
				when p.quiet_from < p.quiet_until
					and local_clock.local_now::time >= p.quiet_from
					and local_clock.local_now::time < p.quiet_until
					then nullif(greatest((local_clock.local_now::date + p.quiet_until) at time zone clock.zone, clock.now_at), clock.now_at)
				when p.quiet_from > p.quiet_until
					and local_clock.local_now::time >= p.quiet_from
					then nullif(greatest(((local_clock.local_now::date + 1) + p.quiet_until) at time zone clock.zone, clock.now_at), clock.now_at)
				when p.quiet_from > p.quiet_until
					and local_clock.local_now::time < p.quiet_until
					then nullif(greatest((local_clock.local_now::date + p.quiet_until) at time zone clock.zone, clock.now_at), clock.now_at)
			end::text as held_until
		from unnest(${ownerIds}::uuid[]) as owners(owner_user_id)
		left join user_preference p on p.user_id = owners.owner_user_id
		cross join lateral (
			select coalesce(p.time_zone, 'America/Chicago') as zone,
				${now.toISOString()}::timestamptz as now_at
		) clock
		cross join lateral (
			select clock.now_at at time zone clock.zone as local_now
		) local_clock
	`.execute(tx);
	return new Map(rows.map((row) => [row.owner_user_id, row.held_until]));
}

async function evaluateDeals(
	tx: Transaction<DB>,
	dealIds?: string[],
): Promise<EvaluatedDeal[]> {
	const current = selectDealState(tx)
		.select((eb) => [
			"d.owner_user_id",
			eb
				.case()
				.when("owner.is_account_partner", "=", true)
				.then(dealAttention)
				.end()
				.as("attention"),
			eb
				.and([
					eb("owner.is_account_partner", "=", true),
					activeOpenDeal,
					hasForecastDate(eb.ref("d.id")),
				])
				.as("forecast_candidate"),
		])
		.$if(dealIds !== undefined, (query) =>
			query.where(sql<boolean>`d.id = any(${dealIds}::uuid[])`),
		);
	const rows = await tx
		.selectFrom(current.as("d"))
		.leftJoin("deal_attention_alert as a", "a.deal_id", "d.id")
		.selectAll("d")
		.select((eb) => [
			"a.reason as prior_reason",
			"a.owner_user_id as prior_owner",
			eb
				.case()
				.when(
					eb.and([
						eb("d.attention", "is", null),
						eb("d.forecast_candidate", "=", true),
					]),
				)
				.then(
					jsonBuildObject(planFactsOf(tx, eb.ref("d.id"), eb.ref("d.kind"))),
				)
				.end()
				.as("facts"),
		])
		.where((eb) =>
			eb.or([
				eb("d.attention", "is not", null),
				eb("a.deal_id", "is not", null),
				eb("d.forecast_candidate", "=", true),
			]),
		)
		.orderBy("d.id")
		.execute();
	return rows.flatMap(({ facts, prior_reason, prior_owner, ...deal }) => {
		const attention = facts
			? planForRead({ ...deal, ...facts, steps: [] }).attention
			: deal.attention;
		if (!attention && !prior_reason) return [];
		return [
			{
				deal_id: deal.id,
				owner_user_id: deal.owner_user_id,
				reason: attention?.reason ?? null,
				prior_reason,
				prior_owner,
			},
		];
	});
}

export async function sweepDealAttentionAlerts(
	tx: Transaction<DB>,
	now = new Date(),
): Promise<AttentionAlertSweep> {
	const initial = await evaluateDeals(tx);
	const actionIds: string[] = [];
	let unchanged = 0;
	for (const row of initial) {
		if (
			row.reason !== null &&
			row.prior_reason === row.reason &&
			row.prior_owner === row.owner_user_id
		) {
			unchanged += 1;
		} else {
			actionIds.push(row.deal_id);
		}
	}

	const clearedIds: string[] = [];
	const toAlert: AlertTarget[] = [];
	if (actionIds.length > 0) {
		// Row locks on acted-on deals in id order serialize sweeps and deal edits without a global advisory lock.
		const { rows: locked } = await sql<{ id: string }>`
			select id from deal where id = any(${actionIds}::uuid[]) order by id for update
		`.execute(tx);
		const lockedIds = locked.map((row) => row.id);
		const current =
			lockedIds.length > 0 ? await evaluateDeals(tx, lockedIds) : [];
		for (const row of current) {
			if (row.reason === null) {
				clearedIds.push(row.deal_id);
			} else if (
				row.prior_reason === row.reason &&
				row.prior_owner === row.owner_user_id
			) {
				unchanged += 1;
			} else {
				toAlert.push({
					deal_id: row.deal_id,
					owner_user_id: row.owner_user_id,
					reason: row.reason,
				});
			}
		}
	}

	if (clearedIds.length > 0) {
		await sql`delete from deal_attention_alert where deal_id = any(${clearedIds}::uuid[])`.execute(
			tx,
		);
	}

	if (toAlert.length > 0) {
		const holds = await quietHolds(
			tx,
			[...new Set(toAlert.map((target) => target.owner_user_id))],
			now,
		);
		await sql`
			with inserted as (
				insert into home_update (user_id, deal_id, what, held_until)
				select user_id, deal_id, what, held_until
				from unnest(
					${toAlert.map((target) => target.owner_user_id)}::uuid[],
					${toAlert.map((target) => target.deal_id)}::uuid[],
					${toAlert.map((target) => target.reason)}::text[],
					${toAlert.map((target) => holds.get(target.owner_user_id) ?? null)}::timestamptz[]
				) as rows(user_id, deal_id, what, held_until)
				returning deal_id, user_id, what
			)
			insert into deal_attention_alert (deal_id, reason, owner_user_id)
			select deal_id, what, user_id
			from inserted
			on conflict (deal_id) do update set
				reason = excluded.reason,
				owner_user_id = excluded.owner_user_id,
				alerted_at = excluded.alerted_at
		`.execute(tx);
	}

	return {
		alerted: toAlert.length,
		unchanged,
		cleared: clearedIds.length,
	};
}

export const attentionAlertJobs = new Hono<NextSaveEnv>().post(
	"/deals/attention-alerts",
	async (c) => {
		if (c.get("stamp").job !== "attention_alerts")
			return refuse(c, new Refusal(403, "unknown_job"));
		return answerNextSave(
			c,
			"sweep-deal-attention-alerts",
			(body) => fit(body, { idempotency_key: isUuid }, ["idempotency_key"]),
			(tx) => sweepDealAttentionAlerts(tx),
		);
	},
);
