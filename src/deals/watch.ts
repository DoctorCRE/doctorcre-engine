import { Hono } from "hono";
import { z } from "zod";
import { failureKind } from "../failure.ts";
import { nextTransaction } from "../next-connection.ts";
import type { PartnerSessionEnv } from "../partner-session.ts";
import { isUuid } from "../uuid.ts";

const uuid = z.uuid();
const lowerUuid = uuid.refine((value) => value === value.toLowerCase());
const version = z.int32().positive();
const changeKind = z.enum([
	"reply_arrived",
	"lease_threshold_crossed",
	"listing_status_changed",
]);
const distinct = <T>(values: T[]) => new Set(values).size === values.length;
const thresholds = (max: number) =>
	z.array(z.int().min(0).max(max)).min(1).max(20).refine(distinct).optional();
const policy = z
	.object({
		change_kinds: z.array(changeKind).min(1).max(3).refine(distinct),
		include_self_changes: z.boolean().optional(),
		lease_threshold_days: thresholds(3650),
		lease_threshold_months: thresholds(120),
	})
	.refine(
		(value) =>
			!value.change_kinds.includes("lease_threshold_crossed") ||
			value.lease_threshold_days !== undefined ||
			value.lease_threshold_months !== undefined,
	);
const requestPolicy = policy.strict();
const edit = {
	idempotency_key: lowerUuid,
	subscription_id: lowerUuid,
	base_version: version,
};
const writeCommand = z.discriminatedUnion("command", [
	z.strictObject({
		command: z.literal("watch"),
		idempotency_key: lowerUuid,
		policy: requestPolicy,
	}),
	z.strictObject({
		command: z.literal("replace-policy"),
		...edit,
		policy: requestPolicy,
	}),
	z.strictObject({ command: z.enum(["pause", "resume", "unwatch"]), ...edit }),
]);
type WatchCommand = { command: "read" } | z.infer<typeof writeCommand>;

const timestamp = z.iso.datetime({ offset: true });
const dealSubject = { subject_type: z.literal("deal"), subject_id: uuid };
const watch = z.object({
	...dealSubject,
	id: uuid,
	actor_id: uuid,
	state: z.enum(["watching", "paused", "removed"]),
	policy: policy.safeExtend({ include_self_changes: z.boolean() }),
	lifecycle_version: version,
	baseline: z.object({
		...dealSubject,
		schema_version: z.literal("subject-watch-baseline.v1"),
		version: z.int().positive(),
	}),
	subscribed_at: timestamp,
});
const success = z.object({
	ok: z.literal(true),
	schema_version: z.literal("subject-watch.v2"),
	watch: watch.nullable(),
	health: z
		.object({
			status: z.enum(["healthy", "delayed", "needs_repair"]),
			pending_count: z.int().min(0).max(1001),
			last_success_at: timestamp.nullable(),
			oldest_pending_at: timestamp.nullable(),
		})
		.nullable(),
});
const refusal = z.object({ ok: z.literal(false), error: z.string() });
const readResult = z.discriminatedUnion("ok", [success, refusal]);
const writeResult = z.discriminatedUnion("ok", [
	success.extend({
		watch,
		rows_changed: z.literal([0, 1]),
		replayed: z.literal(true).optional(),
	}),
	refusal,
]);

export type DealWatchEnv = PartnerSessionEnv & {
	Bindings: {
		DATABASE?: { connectionString: string };
		CARR_WATCH_SETTINGS?: {
			run(
				partner: "joe" | "dell",
				deal: string,
				input: WatchCommand,
			): Promise<unknown>;
		};
	};
};

function refusalStatus(error: string) {
	switch (error) {
		case "watch_stale_version":
		case "key_reuse":
			return 409;
		case "watch_target_not_found":
			return 404;
		case "invalid_request":
		case "watch_command_invalid":
		case "watch_policy_invalid":
			return 400;
	}
}

export const dealWatch = new Hono<DealWatchEnv>().on(
	["GET", "POST"],
	"/deals/:deal/watch",
	async (c) => {
		const errorBody = (error: string) => ({ ok: false, error });
		const partner = c.get("partnerSession").actor.slug;
		if (partner !== "joe" && partner !== "dell")
			return c.json(errorBody("unknown_partner"), 403);
		const deal = c.req.param("deal").toLowerCase();
		if (!isUuid(deal)) return c.json(errorBody("not_found"), 404);
		if (new URL(c.req.url).searchParams.size > 0)
			return c.json(errorBody("invalid_request"), 400);

		let input: WatchCommand = { command: "read" };
		if (c.req.method === "POST") {
			const body: unknown = await c.req.json().catch(() => undefined);
			const parsed = writeCommand.safeParse(body);
			if (!parsed.success) return c.json(errorBody("invalid_request"), 400);
			input = parsed.data;
		}

		const database = c.env.DATABASE;
		if (!database) return c.json(errorBody("database_unavailable"), 503);
		try {
			const copied = await nextTransaction(
				database.connectionString,
				"read",
				(db) =>
					db
						.selectFrom("outside_id")
						.select("deal_id")
						.where("source", "=", "old_system")
						.where("value", "=", deal)
						.where("deal_id", "=", deal)
						.executeTakeFirst(),
			);
			if (!copied) return c.json(errorBody("not_found"), 404);
		} catch (error) {
			console.warn("deal watch target lookup failed:", failureKind(error));
			return c.json(errorBody("database_unavailable"), 503);
		}

		const unavailable = () =>
			c.json(errorBody("watch_settings_unavailable"), 502);
		const service = c.env.CARR_WATCH_SETTINGS;
		if (!service) return unavailable();
		try {
			const schema = input.command === "read" ? readResult : writeResult;
			const result = schema.safeParse(await service.run(partner, deal, input));
			if (!result.success) return unavailable();
			const answer = result.data;
			if (!answer.ok) {
				const status = refusalStatus(answer.error);
				return status ? c.json(answer, status) : unavailable();
			}
			return input.command === "read"
				? c.json({ watch: answer.watch, health: answer.health })
				: c.json(answer);
		} catch (error) {
			console.warn("deal watch RPC failed:", failureKind(error));
			return unavailable();
		}
	},
);
