import { Hono } from "hono";
import { z } from "zod";
import { failureKind } from "../failure.ts";
import { nextTransaction } from "../next-connection.ts";
import type { PartnerSessionEnv } from "../partner-session.ts";
import { isUuid } from "../uuid.ts";

const uuid = z.uuid().refine((value) => value === value.toLowerCase());
const policy = z.record(z.string(), z.unknown());
const edit = {
	idempotency_key: uuid,
	subscription_id: uuid,
	base_version: z.int().positive(),
};
const writeCommand = z.discriminatedUnion("command", [
	z.strictObject({
		command: z.literal("watch"),
		idempotency_key: uuid,
		policy,
	}),
	z.strictObject({ command: z.literal("replace-policy"), ...edit, policy }),
	z.strictObject({ command: z.enum(["pause", "resume", "unwatch"]), ...edit }),
]);
type WatchCommand = { command: "read" } | z.infer<typeof writeCommand>;

const watchResult = z.discriminatedUnion("ok", [
	z.looseObject({
		ok: z.literal(true),
		schema_version: z.literal("subject-watch.v2"),
		watch: z.looseObject({}).nullable(),
		health: z.looseObject({}).nullable(),
	}),
	z.object({ ok: z.literal(false), error: z.string() }),
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
		case "unknown_partner":
			return 403;
		case "invalid_request":
		case "watch_command_invalid":
		case "watch_policy_invalid":
			return 400;
		case "subject_watch_unavailable":
			return 502;
		default:
			return 422;
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
			const result = watchResult.safeParse(
				await service.run(partner, deal, input),
			);
			if (!result.success) return unavailable();
			const answer = result.data;
			if (!answer.ok) return c.json(answer, refusalStatus(answer.error));
			return input.command === "read"
				? c.json({ watch: answer.watch, health: answer.health })
				: c.json(answer);
		} catch (error) {
			console.warn("deal watch RPC failed:", failureKind(error));
			return unavailable();
		}
	},
);
