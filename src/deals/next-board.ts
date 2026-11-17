import { sql, type Transaction } from "kysely";
import type { DB } from "../next-database.d.ts";
import { asText } from "../reader.ts";
import type { Scope } from "./board.ts";
import { shortName } from "./shared.ts";

const ENDED_PHASES = ["closed", "invoiced", "dead"];

// The open deals' board fields, deal owners and national grouping, read from
// the new section in today's board answer's key order.
export async function readNextBoardDeals(
	db: Transaction<DB>,
	{ workspace, account }: Scope,
) {
	const deals = await db
		.selectFrom("deal as d")
		.innerJoin("deal_party as c", (join) =>
			join.onRef("c.deal_id", "=", "d.id").on("c.role", "=", "client"),
		)
		.innerJoin("party as cp", "cp.id", "c.party_id")
		.innerJoin("app_user as owner", "owner.id", "d.owner_user_id")
		.leftJoin("app_user as parker", "parker.id", "d.parked_by_user_id")
		.leftJoin("market as m", "m.id", "d.market_id")
		.leftJoinLateral(
			(eb) =>
				eb
					.selectFrom("deal_phase_change as pc")
					.select("pc.phase")
					.whereRef("pc.deal_id", "=", "d.id")
					.orderBy("pc.happened_at", "desc")
					.limit(1)
					.as("p"),
			(join) => join.onTrue(),
		)
		// National on the day the deal opened, so a later rebrand does not move it.
		.leftJoinLateral(
			(eb) =>
				eb
					.selectFrom("client_brand as b")
					.innerJoin("national_account as na", "na.party_id", "b.brand_id")
					.innerJoin("party as ap", "ap.id", "na.party_id")
					.leftJoin("national_account_owner as o", (join) =>
						join
							.onRef("o.account_id", "=", "na.party_id")
							.on(
								sql<boolean>`daterange(o.started_on, o.ended_on) @> (now() at time zone 'America/Chicago')::date`,
							),
					)
					.leftJoin("app_user as ao", "ao.id", "o.owner_id")
					.select([
						"na.party_id as account_client_id",
						"ap.name as account_name",
						"ao.slug as account_owner",
					])
					.whereRef("b.location_id", "=", "c.party_id")
					.where(
						sql<boolean>`daterange(b.started_on, b.ended_on) @> (d.created_at at time zone 'America/Chicago')::date`,
					)
					.as("a"),
			(join) => join.onTrue(),
		)
		.select((eb) => [
			"d.id",
			"d.name",
			// Today's one deal type is the kind, else the reason, under its old slug.
			sql<
				string | null
			>`coalesce(d.kind, case d.reason when 'start_up' then 'startup' else d.reason end)`.as(
				"type",
			),
			"p.phase",
			"owner.slug as owner",
			"d.needs_attention as attention",
			"m.name as market",
			"c.party_id as client_id",
			"cp.name as client_name",
			"a.account_client_id",
			"a.account_name",
			"a.account_owner",
			eb
				.case()
				.when("a.account_client_id", "is", null)
				.then("team")
				.else("national_account")
				.end()
				.as("workspace_kind"),
			eb
				.case()
				.when("d.parking_reason", "is", null)
				.then("active")
				.else("parked")
				.end()
				.as("operating_state"),
			"d.parking_reason",
			"d.parking_note",
			sql<null>`null`.as("invoiced_on"),
			sql<null>`null`.as("closed_on"),
			sql<null>`null`.as("outcome"),
			asText(eb.ref("d.parked_at")).as("parked_at"),
			"parker.slug as parked_by",
		])
		.where((eb) =>
			eb.or([eb("p.phase", "is", null), eb("p.phase", "not in", ENDED_PHASES)]),
		)
		.where(({ exists, not, selectFrom }) =>
			not(
				exists(
					selectFrom("deal_invoiced as i")
						.select("i.deal_id")
						.whereRef("i.deal_id", "=", "d.id"),
				),
			),
		)
		.$if(workspace === "team", (q) =>
			q.where("a.account_client_id", "is", null),
		)
		.$if(workspace === "national_account", (q) =>
			q.where("a.account_client_id", "is not", null),
		)
		.$if(account !== null, (q) => q.where("a.account_client_id", "=", account))
		.orderBy("d.needs_attention", "desc")
		.orderBy("d.name")
		.execute();
	return deals.map((deal) => ({ ...deal, short_name: shortName(deal) }));
}
