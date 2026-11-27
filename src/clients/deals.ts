import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { clientLinkedParties } from "../activity/next-read.ts";
import { answerNextRead, checkFields, Refusal, refuse } from "../answer.ts";
import { isOpenBoardDeal, selectNextDeals } from "../deals/next-board.ts";
import { homeDay } from "../home-steps.ts";
import type { DB } from "../next-database.d.ts";
import type { DatabaseEnv } from "../reader.ts";
import { isUuid } from "../uuid.ts";
import { isVendorRole } from "../vendors/track-record.ts";

type Role = { role: string; label: string };
type Vendor = {
	party_id: string;
	name: string;
	roles: Role[];
	// The newest introduction with this vendor for this deal; null is not recorded.
	introduction_id: string | null;
};
type Introduction = {
	id: string;
	vendor_id: string;
	vendor_name: string;
	made_by: "vendor" | "team";
	introduced_by: string | null;
	introduced_party_id: string;
	introduced_party_name: string;
	introduced_on: string | null;
	note: string | null;
	chosen: boolean;
};
export type ClientDeal = {
	id: string;
	name: string;
	phase: string | null;
	phase_label: string | null;
	open: boolean;
	closed_on: string | null;
	owner: string;
	vendors: Vendor[];
	introductions: Introduction[];
};

type Ref = ReturnType<typeof sql.ref>;

// Chosen is derived, never stored: the party is on the deal in a vendor role.
export const onDealAsVendor = (deal: Ref, party: Ref) => sql<boolean>`exists (
	select from deal_party dp join role r on r.slug = dp.role
	where dp.deal_id = ${deal} and dp.party_id = ${party} and ${isVendorRole})`;

const vendors = sql<
	Vendor[]
>`(select coalesce(jsonb_agg(v order by lower(v.name), v.party_id), '[]')
	from (select dp.party_id, p.name,
			jsonb_agg(jsonb_build_object('role', r.slug, 'label', r.label) order by r.label, r.slug) as roles,
			(select i.id from introduction i where i.deal_id = deals.id and i.vendor_id = dp.party_id
				order by i.introduced_on desc nulls last, i.created_at desc, i.id desc limit 1) as introduction_id
		from deal_party dp join role r on r.slug = dp.role join party p on p.id = dp.party_id
		where dp.deal_id = deals.id and ${isVendorRole}
		group by dp.party_id, p.name) v)`;

const introductions = sql<
	Introduction[]
>`(select coalesce(jsonb_agg(jsonb_build_object(
		'id', i.id, 'vendor_id', i.vendor_id, 'vendor_name', vp.name, 'made_by', i.made_by,
		'introduced_by', u.slug, 'introduced_party_id', i.introduced_party_id,
		'introduced_party_name', ip.name, 'introduced_on', i.introduced_on, 'note', i.note,
		'chosen', ${onDealAsVendor(sql.ref("deals.id"), sql.ref("i.vendor_id"))}
	) order by i.introduced_on nulls last, i.created_at, i.id), '[]')
	from introduction i
	join party vp on vp.id = i.vendor_id
	join party ip on ip.id = i.introduced_party_id
	left join app_user u on u.id = i.introduced_by_user_id
	where i.deal_id = deals.id)`;

// The deals whose client is the client or one of its linked companies or people, open ones first.
async function readClientDeals(db: Transaction<DB>, client: string) {
	const isClient = await db
		.selectFrom("client")
		.select("party_id")
		.where("party_id", "=", client)
		.executeTakeFirst();
	if (!isClient) return new Refusal(404, "not_found");
	const deals = selectNextDeals(db)
		.where(
			sql<boolean>`c.party_id in (select ${client}::uuid union ${clientLinkedParties(client, homeDay)})`,
		)
		.as("deals");
	const { rows } = await sql<ClientDeal>`
		select deals.id, deals.name, deals.phase, ph.label as phase_label,
			${isOpenBoardDeal} as open, deals.closed_on, deals.owner,
			${vendors} as vendors, ${introductions} as introductions
		from ${deals}
		left join phase ph on ph.slug = deals.phase
		order by open desc, lower(deals.name), deals.id`.execute(db);
	return { deals: rows };
}

export const clientDeals = new Hono<DatabaseEnv>().get(
	"/clients/:client/deals",
	async (c): Promise<Response> => {
		const refused = checkFields(new URL(c.req.url).searchParams, []);
		if (refused) return refuse(c, refused);
		const client = c.req.param("client");
		if (!isUuid(client)) return refuse(c, new Refusal(404, "not_found"));
		return answerNextRead(c, "read-client-deals", (db) =>
			readClientDeals(db, client),
		);
	},
);
