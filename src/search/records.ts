import { sql, type Transaction } from "kysely";
import { selectNextDeals } from "../deals/next-board.ts";
import type { DB } from "../next-database.d.ts";

type DealLink = { id: string; name: string };
type SearchRecords = {
	parties: {
		id: string;
		kind: "person" | "company";
		name: string;
		city: string | null;
		lead_id: string | null;
		roles: ("client" | "lead" | "vendor")[];
		deals: DealLink[];
	}[];
	deals: (DealLink & { phase: string | null; owner: string })[];
};

// Keep the domain labels in step with the email_address constraint.
const emailDomain =
	/^@?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]*[a-z])$/;
const emailAddress = /^[^\s@]+@[^\s@]+$/;

export const searchableLead = sql<boolean>`r.role = 'lead'
	and r.stage not in ('active_deal', 'closed_won') and r.lead_client_id is null
	and not exists (select from client where party_id = r.party_id)
	and not exists (select from deal_party where party_id = r.party_id and role in ('client', 'client_contact'))`;

export function searchRecordsQuery(db: Transaction<DB>, input: string) {
	const query = input.trim();
	const lower = query.toLowerCase();
	const domain = emailDomain.exec(lower)?.[1];
	const address = emailAddress.test(query) ? lower : null;
	const addressMatch = domain
		? sql`split_part(address, '@', 2) = ${domain}`
		: sql`address = ${address}`;
	const byEmail = Boolean(domain || address);
	const bareDomain = Boolean(domain && !query.startsWith("@"));
	const exactName = sql`lower(p.name) = ${lower}`;
	const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
	const partyMatch = byEmail
		? sql`p.id in (select party_id from party_email where ${addressMatch})
			or (${bareDomain} and ${exactName})`
		: sql`p.id::text = ${lower} or p.id in (
				select party_id from outside_id
				where source in ('old_system', 'old_system_ref', 'old_system_lead') and lower(value) = ${lower}
			) or p.name ilike ${pattern} or p.name operator(public.%) ${query}`;
	const similarity = byEmail
		? sql`0`
		: sql`public.similarity(p.name, ${query})`;
	const deals = selectNextDeals(db).where(
		"d.id",
		"in",
		sql<string>`(select id from matched_deals)`,
	);

	return sql<SearchRecords>`
		with matched_parties as materialized (
			select p.id, p.kind, p.name, p.city, ${exactName} as exact_name, ${similarity} as score
			from party p
			where btrim(p.name) <> '' and ${Boolean(query)} and (${partyMatch})
			order by exact_name desc, score desc, lower(p.name), p.id limit 15
		),
		matched_deals as materialized (
			select id from deal
			where (${bareDomain} and lower(name) = ${lower})
				or (${Boolean(query) && !byEmail} and (name ilike ${pattern} or id::text = ${lower} or id in (
				select deal_id from outside_id where source = 'old_system' and value = ${lower}
			)))
			order by lower(name), id limit 5
		)
		select coalesce((
			select jsonb_agg(to_jsonb(result) - '{exact_name,score}'::text[]
				order by result.exact_name desc, result.score desc, lower(result.name), result.id) from (
				select p.*, array(
					select role from party_role where party_id = p.id
						and (role in ('lead', 'vendor') or
							(role = 'client' and exists (select from client where party_id = p.id)))
					order by role
				) as roles, (
					select coalesce((
						select min(value) from outside_id where party_id = p.id and source = 'old_system_lead'
					), p.id::text)
					from party_role r where r.party_id = p.id and ${searchableLead}
				) as lead_id, coalesce((
					select jsonb_agg(to_jsonb(link) order by lower(link.name), link.id) from (
						select d.id, d.name from deal d where d.id in (
							select deal_id from deal_party where party_id = p.id
							union all
							select dp.deal_id from party_company pc
							join deal_party dp on dp.party_id = pc.company_id and dp.role = 'client'
							where pc.person_id = p.id and (pc.started_on is null or pc.started_on <= current_date)
								and (pc.ended_on is null or pc.ended_on > current_date)
						)
						order by lower(d.name), d.id limit 20
					) link
				), '[]') as deals
				from matched_parties p
			) result
		), '[]') as parties, coalesce((
			select jsonb_agg(to_jsonb(result) order by lower(result.name), result.id)
			from (select id, name, phase, owner from (${deals}) current_deals) result
		), '[]') as deals
	`;
}

export async function readSearchRecords(db: Transaction<DB>, query: string) {
	const {
		rows: [result],
	} = await searchRecordsQuery(db, query).execute(db);
	return { schema_version: "search.v1", ...result };
}
