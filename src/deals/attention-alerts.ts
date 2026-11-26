import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { Refusal, refuse } from "../answer.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { fit } from "../request-shape.ts";
import { isUuid } from "../uuid.ts";
import { dealAttention } from "./attention.ts";
import { CLOSED_PHASES } from "./shared.ts";

type EvaluatedDeal = {
	deal_id: string;
	owner_user_id: string;
	reason: string | null;
	since: string | null;
	prior_reason: string | null;
	prior_owner: string | null;
};

type AlertTarget = {
	deal_id: string;
	owner_user_id: string;
	reason: string;
	since: string;
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

export async function sweepDealAttentionAlerts(
	tx: Transaction<DB>,
	now = new Date(),
): Promise<AttentionAlertSweep> {
	await sql`select pg_advisory_xact_lock(hashtextextended('deal_attention_alert', 0))`.execute(
		tx,
	);
	const { rows } = await sql<EvaluatedDeal>`
		with current_deals as (
			select d.id as deal_id,
				d.owner_user_id,
				case when owner.is_account_partner then ${dealAttention} end as attention
			from deal d
			join app_user owner on owner.id = d.owner_user_id
			left join imported_deal_board imported on imported.deal_id = d.id
			left join lateral (
				select pc.phase, pc.happened_at, pc.reason, pc.changed_at, pc.changed_by_job
				from deal_phase_change pc
				where pc.deal_id = d.id
				order by pc.happened_at desc
				limit 1
			) p on true
			left join lateral (
				select pc.happened_at
				from deal_phase_change pc
				where pc.deal_id = d.id and pc.phase = 'closed'
					and p.phase in (${sql.join(CLOSED_PHASES)})
				order by pc.happened_at desc
				limit 1
			) last_close on true
		)
		select c.deal_id,
			c.owner_user_id,
			c.attention ->> 'reason' as reason,
			c.attention ->> 'since' as since,
			a.reason as prior_reason,
			a.owner_user_id as prior_owner
		from current_deals c
		left join deal_attention_alert a on a.deal_id = c.deal_id
		where c.attention is not null or a.deal_id is not null
		order by c.deal_id
	`.execute(tx);

	const clearedIds: string[] = [];
	const toAlert: AlertTarget[] = [];
	let unchanged = 0;
	for (const row of rows) {
		if (row.reason === null || row.since === null) {
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
				since: row.since,
			});
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
		const { rows: inserted } = await sql<{
			id: string;
			deal_id: string;
			user_id: string;
		}>`
			insert into home_update (user_id, deal_id, what, held_until)
			select user_id, deal_id, what, held_until
			from unnest(
				${toAlert.map((target) => target.owner_user_id)}::uuid[],
				${toAlert.map((target) => target.deal_id)}::uuid[],
				${toAlert.map((target) => target.reason)}::text[],
				${toAlert.map((target) => holds.get(target.owner_user_id) ?? null)}::timestamptz[]
			) as rows(user_id, deal_id, what, held_until)
			returning id, deal_id, user_id
		`.execute(tx);
		const targetByDeal = new Map(
			toAlert.map((target) => [target.deal_id, target]),
		);
		await tx
			.insertInto("deal_attention_alert")
			.values(
				inserted.map((update) => {
					const target = targetByDeal.get(update.deal_id);
					if (!target) throw new Error("Inserted alert did not match a target");
					return {
						deal_id: update.deal_id,
						reason: target.reason,
						since: target.since,
						owner_user_id: update.user_id,
						home_update_id: update.id,
						alerted_at: sql<string>`now()`,
					};
				}),
			)
			.onConflict((oc) =>
				oc.column("deal_id").doUpdateSet({
					reason: (eb) => eb.ref("excluded.reason"),
					since: (eb) => eb.ref("excluded.since"),
					owner_user_id: (eb) => eb.ref("excluded.owner_user_id"),
					home_update_id: (eb) => eb.ref("excluded.home_update_id"),
					alerted_at: (eb) => eb.ref("excluded.alerted_at"),
				}),
			)
			.execute();
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
