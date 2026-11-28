import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { answerNextRead, checkFields, Refusal, refuse } from "../answer.ts";
import { onDealAsVendor } from "../clients/deals.ts";
import { isOpenBoardDeal, selectNextDeals } from "../deals/next-board.ts";
import type { DB } from "../next-database.d.ts";
import type { DatabaseEnv } from "../reader.ts";
import { isUuid } from "../uuid.ts";
import { isVendorRole } from "./track-record.ts";

type Partner = "joe" | "dell";
type Party = { party_id: string; name: string };
type Deal = { id: string; name: string; open: boolean };
type Introduction = {
	introduction_id: string;
	client: Party;
	deal: Deal | null;
	introduced_on: string | null;
};
type TeamIntroduction = Introduction & {
	introduced_by: Partner | null;
	chosen: boolean;
};
type Network = {
	sent_us: Introduction[];
	we_sent_them: TeamIntroduction[];
	worked_with: (Deal & { client: Party | null })[];
	knows: Party[];
	can_introduce: Party[];
};
export type VendorRelationships = Network & {
	relationship_partner: Partner | null;
	counts: Record<"sent_us" | "we_sent_them" | "chosen" | "knows", number>;
};

// A partner by sign-in name, from app_user `u`; any other user is not a partner, so unknown.
const partner = sql<Partner | null>`case when u.is_account_partner then u.slug end`;

const network = (db: Transaction<DB>, vendor: string) => {
	const onDeal = sql`select dp.deal_id from deal_party dp join role r on r.slug = dp.role
		where dp.party_id = ${vendor} and ${isVendorRole}`;
	const deals = selectNextDeals(db).where(
		sql<boolean>`d.id in (select deal_id from introduction where vendor_id = ${vendor} union ${onDeal})`,
	);
	const introductions = (madeBy: "vendor" | "team") =>
		sql`(select coalesce(jsonb_agg(entry
				order by introduced_on desc nulls last, created_at desc, id desc), '[]')
			from intro where made_by = ${madeBy})`;
	const linked = (kind: "knows" | "can_introduce") =>
		sql`(select coalesce(jsonb_agg(jsonb_build_object('party_id', p.id, 'name', p.name)
				order by lower(p.name), p.id), '[]')
			from party_link l join party p on p.id = case l.party_id when ${vendor}::uuid
				then l.other_party_id else l.party_id end
			where l.kind = ${kind} and l.ended_on is null and (l.party_id = ${vendor}
				${kind === "knows" ? sql`or l.other_party_id = ${vendor}` : sql``}))`;
	return sql<Network>`with deals as (${deals}),
		vendor_deal as (select id, client_id, client_name, lower(name) as sort_name, ${isOpenBoardDeal} as open,
			jsonb_build_object('id', id, 'name', name, 'open', ${isOpenBoardDeal}) as deal from deals),
		intro as (select i.id, i.made_by, i.introduced_on, i.created_at, i.deal_id,
				jsonb_build_object('introduction_id', i.id, 'deal', d.deal, 'introduced_on', i.introduced_on,
					'client', jsonb_build_object('party_id', ip.id, 'name', ip.name))
				|| case when i.made_by = 'team' then jsonb_build_object('introduced_by', ${partner},
					'chosen', ${onDealAsVendor(sql.ref("i.deal_id"), sql.ref("i.vendor_id"))}) else '{}' end as entry
			from introduction i
			join party ip on ip.id = i.introduced_party_id
			left join app_user u on u.id = i.introduced_by_user_id
			left join vendor_deal d on d.id = i.deal_id
			where i.vendor_id = ${vendor} and i.made_by in ('vendor', 'team'))
		select ${introductions("vendor")} as sent_us,
			${introductions("team")} as we_sent_them,
			(select coalesce(jsonb_agg(deal || jsonb_build_object('client', case when client_id is not null
					then jsonb_build_object('party_id', client_id, 'name', client_name) end)
					order by open desc, sort_name, id), '[]')
				from vendor_deal where id in (${onDeal})
					and id not in (select deal_id from intro where deal_id is not null)) as worked_with,
			${linked("knows")} as knows,
			${linked("can_introduce")} as can_introduce`.execute(db);
};

async function readVendorRelationships(
	db: Transaction<DB>,
	vendor: string,
): Promise<VendorRelationships | Refusal> {
	const role = await db
		.selectFrom("party_role as pr")
		.leftJoin("app_user as u", "u.id", "pr.owner_user_id")
		.select(partner.as("relationship_partner"))
		.where("pr.party_id", "=", vendor)
		.where("pr.role", "=", "vendor")
		.executeTakeFirst();
	if (!role) return new Refusal(404, "not_found");
	const {
		rows: [found],
	} = await network(db, vendor);
	if (!found) throw new Error("the vendor's network read answered no row");
	return {
		relationship_partner: role.relationship_partner,
		...found,
		counts: {
			sent_us: found.sent_us.length,
			we_sent_them: found.we_sent_them.length,
			chosen: found.we_sent_them.filter((i) => i.chosen).length,
			knows: found.knows.length,
		},
	};
}

export const vendorRelationships = new Hono<DatabaseEnv>().get(
	"/vendors/:vendor/relationships",
	async (c): Promise<Response> => {
		const refused = checkFields(new URL(c.req.url).searchParams, []);
		if (refused) return refuse(c, refused);
		const vendor = c.req.param("vendor");
		if (!isUuid(vendor)) return refuse(c, new Refusal(404, "not_found"));
		return answerNextRead(c, "read-vendor-relationships", (db) =>
			readVendorRelationships(db, vendor),
		);
	},
);
