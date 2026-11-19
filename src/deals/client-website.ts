import { createHash } from "node:crypto";
import { Hono } from "hono";
import { type Expression, sql, type Transaction } from "kysely";
import { Refusal } from "../answer.ts";
import type { JsonObject } from "../database.d.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { type Check, fit, isUuid } from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";

export const CLIENT_WEBSITE_ORIGIN = "https://share.doctorcre.com";

const isWebsiteSlug: Check<string> = (value): value is string =>
	typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
const isWebsitePassword: Check<string> = (value): value is string =>
	typeof value === "string" &&
	value.length > 0 &&
	[...value].length <= 1024 &&
	!value.includes("\u0000");

const parseSetup = (deal_id: string, body: JsonObject) => {
	if (!isUuid(deal_id)) return new Refusal(404, "portal_deal_not_found");
	const args = fit(
		body,
		{
			idempotency_key: isUuid,
			slug: isWebsiteSlug,
			password: isWebsitePassword,
		},
		["idempotency_key", "slug", "password"],
	);
	return args instanceof Refusal ? args : { ...args, deal_id };
};

const passwordDigest = (password: string) =>
	createHash("sha256").update(password, "utf8").digest("hex");

const matchesPassword = (password: string, verifier: Expression<string>) =>
	sql<boolean>`${verifier} = public.crypt(${passwordDigest(password)}, ${verifier})`;

async function register(
	tx: Transaction<DB>,
	{
		deal_id,
		slug,
		password,
	}: { deal_id: string; slug: string; password: string },
) {
	const client = await tx
		.selectFrom("deal as d")
		.innerJoin("deal_party as c", (join) =>
			join.onRef("c.deal_id", "=", "d.id").on("c.role", "=", "client"),
		)
		.select("c.party_id")
		.where("d.id", "=", deal_id)
		.forUpdate("d")
		.executeTakeFirst();
	if (!client) throw new SaveRefusal(new Refusal(404, "portal_deal_not_found"));

	const websites = tx.selectFrom("deal_client_website");
	const prior = await websites
		.select(["deal_id", "client_party_id", "disabled_at"])
		.select((eb) =>
			matchesPassword(password, eb.ref("password_hash")).as("matches"),
		)
		.where("slug", "=", slug)
		.executeTakeFirst();
	const answer = {
		ok: true,
		deal_id,
		client_portal_url: `${CLIENT_WEBSITE_ORIGIN}/${slug}`,
	};
	if (prior) {
		if (
			prior.deal_id !== deal_id ||
			prior.client_party_id !== client.party_id ||
			prior.disabled_at !== null
		)
			throw new SaveRefusal(new Refusal(409, "portal_slug_taken"));
		if (!prior.matches)
			throw new SaveRefusal(new Refusal(409, "portal_password_differs"));
		return { ...answer, created: false };
	}
	const active = await websites
		.select("slug")
		.where("deal_id", "=", deal_id)
		.where("disabled_at", "is", null)
		.executeTakeFirst();
	if (active)
		throw new SaveRefusal(new Refusal(409, "portal_deal_already_registered"));

	const inserted = await tx
		.insertInto("deal_client_website")
		.values({
			slug,
			deal_id,
			client_party_id: client.party_id,
			password_hash: sql<string>`public.crypt(${passwordDigest(password)}, public.gen_salt('bf', 12))`,
			changed_at: sql<string>`now()`,
		})
		.onConflict((conflict) => conflict.column("slug").doNothing())
		.returning("slug")
		.executeTakeFirst();
	if (!inserted) throw new SaveRefusal(new Refusal(409, "portal_slug_taken"));
	return { ...answer, created: true };
}

export const dealClientWebsite = new Hono<NextSaveEnv>().post(
	"/deals/:deal/client-website",
	(c) =>
		answerNextSave(
			c,
			"register-client-portal",
			(body) => parseSetup(c.req.param("deal"), body),
			register,
			200,
			// A fast hash of the request would weaken a partner's simple password.
			({ idempotency_key, deal_id, slug }) => ({
				idempotency_key,
				deal_id,
				slug,
			}),
		),
);
