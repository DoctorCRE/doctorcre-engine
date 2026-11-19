import { createHash, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { Refusal, refuse } from "../answer.ts";
import { failureKind } from "../failure.ts";
import { nextTransaction } from "../next-connection.ts";
import type { DB } from "../next-database.d.ts";
import type { NextSaveEnv } from "../next-door.ts";
import { isUuid } from "../request-shape.ts";
import {
	isWebsitePassword,
	isWebsiteSlug,
	matchesPassword,
} from "./client-website.ts";

const WINDOW_START = sql<string>`clock_timestamp() - interval '15 minutes'`;
const digest = (grant: string) =>
	createHash("sha256").update(grant).digest("hex");

const activeWebsites = (tx: Transaction<DB>) =>
	tx
		.selectFrom("deal_client_website as w")
		.innerJoin("deal_party as c", (join) =>
			join
				.onRef("c.deal_id", "=", "w.deal_id")
				.onRef("c.party_id", "=", "w.client_party_id")
				.on("c.role", "=", "client"),
		)
		.where("w.disabled_at", "is", null);

type WebsiteAccessEnv = NextSaveEnv & {
	Bindings: { CLIENT_WEBSITE_ORIGIN?: string };
};

export const openClientWebsite = new Hono<WebsiteAccessEnv>().post(
	"/deals/:deal/client-website/open",
	async (c) => {
		const deal = c.req.param("deal");
		if (!isUuid(deal)) return refuse(c, new Refusal(404, "not_found"));
		const user = c.get("stamp").user;
		if (!user) return refuse(c, new Refusal(403, "AUTHORIZATION_REFUSED"));
		const origin = URL.parse(c.env.CLIENT_WEBSITE_ORIGIN ?? "");
		if (origin?.protocol !== "https:" || origin.href !== `${origin.origin}/`)
			return c.json({ error: "client_website_origin_unconfigured" }, 503);
		const writer = c.env.DATABASE_WRITER;
		if (!writer) return refuse(c, new Refusal(503, "database_unavailable"));
		try {
			const grant = randomUUID();
			const registration = await nextTransaction(
				writer.connectionString,
				"save",
				async (tx) => {
					await tx
						.deleteFrom("deal_client_website_grant")
						.where("expires_at", "<=", sql<string>`clock_timestamp()`)
						.execute();
					return tx
						.insertInto("deal_client_website_grant")
						.columns(["digest", "slug", "user_id", "expires_at"])
						.expression(
							activeWebsites(tx)
								.innerJoin("app_user as u", (join) =>
									join.on("u.slug", "=", user),
								)
								.select([
									sql<string>`${digest(grant)}`.as("digest"),
									"w.slug",
									"u.id",
									sql<string>`clock_timestamp() + interval '60 seconds'`.as(
										"expires_at",
									),
								])
								.where("w.deal_id", "=", deal),
						)
						.returning("slug")
						.executeTakeFirst();
				},
			);
			if (!registration) return refuse(c, new Refusal(404, "not_found"));
			const url = new URL(`/${registration.slug}/`, origin);
			url.searchParams.set("grant", grant);
			return c.json({ url: url.href });
		} catch (error) {
			console.warn("client website grant failed:", failureKind(error));
			return refuse(c, new Refusal(503, "database_unavailable"));
		}
	},
);

export function redeemWebsiteGrant(
	connection: string,
	slug: string,
	grant: string,
) {
	if (!isWebsiteSlug(slug) || !isUuid(grant)) return Promise.resolve(false);
	return nextTransaction(connection, "save", async (tx) => {
		const consumed = await tx
			.deleteFrom("deal_client_website_grant")
			.where("digest", "=", digest(grant))
			.where("slug", "=", slug)
			.where("expires_at", ">", sql<string>`clock_timestamp()`)
			.where((eb) =>
				eb.exists(
					activeWebsites(tx).where("w.slug", "=", slug).select("w.slug"),
				),
			)
			.returning("slug")
			.executeTakeFirst();
		return consumed !== undefined;
	});
}

export function verifyWebsitePassword(
	connection: string,
	slug: string,
	password: string,
) {
	if (!isWebsiteSlug(slug) || !isWebsitePassword(password))
		return Promise.resolve(false);
	return nextTransaction(connection, "save", async (tx) => {
		// All password attempts for a site share one counter, including concurrent attempts.
		await sql`select pg_advisory_xact_lock(hashtextextended(${`client-website:${slug}`}, 0))`.execute(
			tx,
		);
		const locked = await tx
			.selectFrom("deal_client_website_attempt")
			.select("slug")
			.where("slug", "=", slug)
			.where("failed_attempts", "=", 5)
			.where("window_started_at", ">", WINDOW_START)
			.executeTakeFirst();
		if (locked) return false;
		const website = await activeWebsites(tx)
			.select((eb) =>
				matchesPassword(password, eb.ref("w.password_hash")).as("matches"),
			)
			.where("w.slug", "=", slug)
			.executeTakeFirst();
		if (!website) return false;
		if (website.matches) {
			await tx
				.deleteFrom("deal_client_website_attempt")
				.where("slug", "=", slug)
				.execute();
			return true;
		}
		await tx
			.insertInto("deal_client_website_attempt")
			.values({
				slug,
				failed_attempts: 1,
				window_started_at: sql<string>`clock_timestamp()`,
			})
			.onConflict((conflict) =>
				conflict.column("slug").doUpdateSet({
					failed_attempts: sql<number>`case when deal_client_website_attempt.window_started_at <= ${WINDOW_START} then 1 else deal_client_website_attempt.failed_attempts + 1 end`,
					window_started_at: sql<string>`case when deal_client_website_attempt.window_started_at <= ${WINDOW_START} then clock_timestamp() else deal_client_website_attempt.window_started_at end`,
				}),
			)
			.execute();
		return false;
	});
}
