import { sql, type Transaction } from "kysely";
import { Refusal } from "../answer.ts";
import type { DB } from "../next-database.d.ts";
import { ACTING_USER } from "../next-save.ts";
import { SaveRefusal } from "../save.ts";

type NewLocation = { name: string; kind: "person" | "company" };

const today = sql`(now() at time zone 'America/Chicago')::date`;

export const currentAccountLocations = (db: Transaction<DB>, account: string) =>
	db
		.selectFrom("client_brand as b")
		.where("b.brand_id", "=", account)
		.where(sql<boolean>`daterange(b.started_on, b.ended_on) @> ${today}`);

export async function marketClient(
	tx: Transaction<DB>,
	account: string,
	location: { client_id: string } | { new_location: NewLocation },
) {
	const brand = await tx
		.selectFrom("national_account")
		.select("party_id")
		.where("party_id", "=", account)
		.executeTakeFirst();
	if (!brand) throw new SaveRefusal(new Refusal(404, "not_found"));

	const locations = currentAccountLocations(tx, account);
	if ("client_id" in location) {
		const member = await locations
			.select("b.location_id")
			.where("b.location_id", "=", location.client_id)
			.forShare()
			.executeTakeFirst();
		if (!member)
			throw new SaveRefusal(new Refusal(409, "location_not_in_account"));
		return member.location_id;
	}

	const { name, kind } = location.new_location;
	await sql`select pg_advisory_xact_lock(hashtextextended('national market location:' || ${account}::uuid::text || ':' || lower(${name}), 0))`.execute(
		tx,
	);
	const candidates = await locations
		.innerJoin("party as p", "p.id", "b.location_id")
		.select(["p.id", "p.name"])
		.where(sql`lower(p.name)`, "=", sql`lower(${name})`)
		.orderBy("p.id")
		.execute();
	if (candidates.length)
		throw new SaveRefusal(
			new Refusal(409, "location_name_exists", { candidates }),
		);

	const {
		rows: [added],
	} = await sql<{ location_id: string }>`
		with location as (
			insert into party (kind, name, how_found)
			values (${kind}, ${name}, 'national_account') returning id
		), client_role as (
			insert into party_role (party_id, role)
			select id, 'client' from location returning party_id
		), client_profile as (
			insert into client (party_id, client_type, owner_user_id)
			select party_id, 'franchise', ${ACTING_USER} from client_role returning party_id
		)
		insert into client_brand (location_id, brand_id, started_on)
		select party_id, ${account}::uuid, ${today} from client_profile
		returning location_id`.execute(tx);
	if (!added) throw new Error("Location insert returned no id");
	return added.location_id;
}

export async function linkMarketAgent(
	tx: Transaction<DB>,
	deal: string,
	agent: string,
) {
	const { rows } = await sql`
		insert into deal_party (deal_id, party_id, role)
		select ${deal}::uuid, id, 'market_agent' from party where id = ${agent}::uuid and kind = 'person'
		returning deal_id`.execute(tx);
	if (!rows.length)
		throw new SaveRefusal(
			new Refusal(400, "invalid_field_value", { fields: ["market_agent_id"] }),
		);
}
