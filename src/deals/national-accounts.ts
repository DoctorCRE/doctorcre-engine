import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { answerNextRead, checkFields, Refusal, refuse } from "../answer.ts";
import type { JsonObject } from "../database.d.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { userId } from "../next-save.ts";
import {
	fit,
	isBoolean,
	isChangeId,
	isText,
	isUuid,
	optional,
} from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";
import { latestChange } from "../seen-change.ts";
import { currentAccountLocations } from "./national-market.ts";

const isAccountOwner = (value: unknown): value is "joe" | "dell" =>
	value === "joe" || value === "dell";

const NEW_ACCOUNT = {
	idempotency_key: isUuid,
	name: isText,
	owner: isAccountOwner,
	force_new: optional(isBoolean),
};

const CHANGE_OWNER = {
	idempotency_key: isUuid,
	owner: isAccountOwner,
	base_version: isChangeId,
};

const today = sql<string>`(now() at time zone 'America/Chicago')::date`;

function parseNewAccount(body: JsonObject) {
	const request = fit(body, NEW_ACCOUNT, ["idempotency_key", "name", "owner"]);
	return request instanceof Refusal
		? request
		: { ...request, name: request.name.trim() };
}

function parseOwner(account_client_id: string, body: JsonObject) {
	if (!isUuid(account_client_id)) return new Refusal(404, "not_found");
	const request = fit(body, CHANGE_OWNER, [
		"idempotency_key",
		"owner",
		"base_version",
	]);
	return request instanceof Refusal
		? request
		: { ...request, account_client_id };
}

async function addAccount(
	tx: Transaction<DB>,
	{
		name,
		owner,
		force_new,
	}: Exclude<ReturnType<typeof parseNewAccount>, Refusal>,
) {
	const owner_id = await userId(tx, owner);
	await sql`select pg_advisory_xact_lock(hashtextextended('national account name:' || lower(${name}), 0))`.execute(
		tx,
	);
	if (!force_new) {
		const candidates = await tx
			.selectFrom("party")
			.select(["id", "name"])
			.where("kind", "=", "company")
			.where(sql`lower(name)`, "=", sql`lower(${name})`)
			.orderBy("id")
			.execute();
		if (candidates.length)
			throw new SaveRefusal(
				new Refusal(409, "account_name_exists", { candidates }),
			);
	}

	const {
		rows: [added],
	} = await sql<{ account_client_id: string }>`
		with company as (
			insert into party (kind, name) values ('company', ${name}) returning id
		), account_role as (
			insert into party_role (party_id, role)
			select id, 'national_account' from company returning party_id
		), account as (
			insert into national_account (party_id)
			select party_id from account_role returning party_id
		)
		insert into national_account_owner (account_id, owner_id, started_on)
		select party_id, ${owner_id}::uuid, ${today} from account
		returning account_id as account_client_id`.execute(tx);
	if (!added) throw new Error("Account insert returned no id");
	return { ...added, name, owner };
}

async function changeOwner(
	tx: Transaction<DB>,
	{
		account_client_id,
		owner,
		base_version,
	}: Exclude<ReturnType<typeof parseOwner>, Refusal>,
) {
	await sql`select pg_advisory_xact_lock(hashtextextended('national account owner:' || ${account_client_id}::uuid::text, 0))`.execute(
		tx,
	);
	const account = await tx
		.selectFrom("national_account")
		.select("party_id")
		.where("party_id", "=", account_client_id)
		.executeTakeFirst();
	if (!account) throw new SaveRefusal(new Refusal(404, "not_found"));
	const owner_id = await userId(tx, owner);
	const {
		rows: [current],
	} = await sql<{
		id: string;
		owner_id: string;
		started_today: boolean;
	}>`select id, owner_id, started_on = ${today} as started_today
		from national_account_owner where account_id = ${account_client_id}::uuid
		and daterange(started_on, ended_on) @> ${today}`.execute(tx);
	const version = current
		? ((await latestChange(tx, "national_account_owner", current.id)) ?? 0)
		: 0;
	if (base_version !== version)
		throw new SaveRefusal(
			new Refusal(409, "version_conflict", { current_version: version }),
		);
	if (current?.owner_id === owner_id) return { account_client_id, owner };

	// Daily periods cannot end on their start date. Change history keeps a replaced owner.
	if (current?.started_today)
		await tx
			.deleteFrom("national_account_owner")
			.where("id", "=", current.id)
			.execute();
	else if (current)
		await tx
			.updateTable("national_account_owner")
			.set({ ended_on: today })
			.where("id", "=", current.id)
			.execute();
	await sql`insert into national_account_owner (account_id, owner_id, started_on, ended_on)
		values (${account_client_id}::uuid, ${owner_id}::uuid, ${today}, null)`.execute(
		tx,
	);
	return { account_client_id, owner };
}

export const nationalAccounts = new Hono<NextSaveEnv>()
	.get("/markets", async (c) => {
		const refused = checkFields(new URL(c.req.url).searchParams, []);
		if (refused) return refuse(c, refused);
		return answerNextRead(c, "read-markets", (db) =>
			db
				.selectFrom("market")
				.select(["id as market_id", "name"])
				.orderBy("name")
				.execute(),
		);
	})
	.get("/national-accounts/:account/locations", async (c) => {
		const refused = checkFields(new URL(c.req.url).searchParams, []);
		if (refused) return refuse(c, refused);
		const account = c.req.param("account");
		if (!isUuid(account)) return refuse(c, new Refusal(404, "not_found"));
		return answerNextRead(c, "read-national-account-locations", async (db) => {
			const brand = await db
				.selectFrom("national_account")
				.select("party_id")
				.where("party_id", "=", account)
				.executeTakeFirst();
			if (!brand) return new Refusal(404, "not_found");

			return currentAccountLocations(db, account)
				.innerJoin("party as p", "p.id", "b.location_id")
				.select(["p.id as party_id", "p.name", "p.kind"])
				.orderBy("p.name")
				.execute();
		});
	})
	.post("/national-accounts", (c) =>
		answerNextSave(
			c,
			"add-national-account",
			parseNewAccount,
			addAccount,
			(result) => (result.replayed ? 200 : 201),
		),
	)
	.post("/national-accounts/:account/owner", (c) =>
		answerNextSave(
			c,
			"change-national-account-owner",
			(body) => parseOwner(c.req.param("account"), body),
			changeOwner,
		),
	);
