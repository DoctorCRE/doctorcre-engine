import { sql, type Transaction } from "kysely";
import type { DB } from "../next-database.d.ts";
import { asText } from "../reader.ts";
import type { Scope } from "./board.ts";

const ENDED_PHASES = ["closed", "invoiced", "dead"];
// Today's board groups by brand and owner as they stand on the partners' calendar day.
const covers = (from: string, to: string) =>
	sql<boolean>`daterange(${sql.ref(from)}, ${sql.ref(to)}) @> (now() at time zone 'America/Chicago')::date`;

// Fields come in today's board answer's key order.
export function readNextBoardDeals(
	db: Transaction<DB>,
	{ workspace, account }: Scope,
) {
	return db
		.selectFrom("deal as d")
		.innerJoin("deal_party as c", (join) =>
			join.onRef("c.deal_id", "=", "d.id").on("c.role", "=", "client"),
		)
		.innerJoin("party as cp", "cp.id", "c.party_id")
		.innerJoin("app_user as owner", "owner.id", "d.owner_user_id")
		.leftJoin("app_user as parker", "parker.id", "d.parked_by_user_id")
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
		.leftJoinLateral(
			(eb) =>
				eb
					.selectFrom("client_brand as b")
					.innerJoin("national_account as na", "na.party_id", "b.brand_id")
					.innerJoin("party as ap", "ap.id", "na.party_id")
					.leftJoin("national_account_owner as o", (join) =>
						join
							.onRef("o.account_id", "=", "na.party_id")
							.on(covers("o.started_on", "o.ended_on")),
					)
					.leftJoin("app_user as ao", "ao.id", "o.owner_id")
					.select([
						"na.party_id as account_client_id",
						"ap.name as account_name",
						"ao.slug as account_owner",
					])
					.whereRef("b.location_id", "=", "c.party_id")
					.where(covers("b.started_on", "b.ended_on"))
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
		.$if(workspace !== "all", (q) =>
			q.where(
				"a.account_client_id",
				workspace === "team" ? "is" : "is not",
				null,
			),
		)
		.$if(account !== null, (q) => q.where("a.account_client_id", "=", account))
		.orderBy("d.needs_attention", "desc")
		.orderBy("d.name")
		.execute();
}
