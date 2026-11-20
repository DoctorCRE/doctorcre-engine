import { type Expression, sql, type Transaction } from "kysely";
import { selectNextDeals } from "../deals/next-board.ts";
import type { DB } from "../next-database.d.ts";

type Kind = "client" | "lead" | "vendor" | "party";
type Contact = {
	id: string;
	name: string;
	kind: Kind;
	ref: string;
	city: string | null;
	specialty: string | null;
	org_name: string | null;
	exact_ref: boolean;
};

const rolePrefix = sql<string>`case r.role when 'client' then 'C-%'
	when 'lead' then 'L-%' when 'vendor' then '[VT]-%' else 'P-%' end`;
const copiedContactRef = (id: Expression<string>, prefix: Expression<string>) =>
	sql<string | null>`(select min(o.value) from outside_id o
		where o.party_id = ${id} and o.source = 'old_system_ref'
		and o.value similar to ${prefix} having count(*) = 1)`;
const contactRef = (id: Expression<string>, prefix: Expression<string>) =>
	sql<string>`coalesce(${copiedContactRef(id, prefix)}, ${id}::text)`;

const named = (name: Expression<string>, query: string) =>
	sql<boolean>`${name} ilike ${`%${query}%`}`;

export async function matchingContacts(
	db: Transaction<DB>,
	query: string,
	fuzzy = false,
) {
	const fuzzyName = fuzzy ? sql`or p.name operator(public.%) ${query}` : sql``;
	const relevance = fuzzy
		? sql`public.similarity(p.name, ${query}) desc`
		: sql`lower(p.name) = lower(${query}) desc`;
	return (
		await sql<Contact>`
			select p.id, p.name, coalesce(r.role, 'party') as kind, refs.ref,
				p.city, (select string_agg(s.label, ', ' order by s.label, s.slug)
					from party_specialty ps join specialty s on s.slug = ps.specialty
					where ps.person_id = p.id) as specialty,
				(select company.name from party_company pc join party company on company.id = pc.company_id
					where pc.person_id = p.id and (pc.started_on is null or pc.started_on <= current_date)
					and (pc.ended_on is null or pc.ended_on > current_date)
					order by pc.started_on desc nulls last, company.id limit 1) as org_name,
				refs.exact_ref
			from party p left join party_role r on r.party_id = p.id and r.role in ('client', 'lead', 'vendor')
			cross join lateral (select ${contactRef(sql.ref("p.id"), rolePrefix)} as ref,
				(p.id::text = lower(${query}) or exists (
					select from outside_id o where o.party_id = p.id and lower(o.value) = lower(${query})
					and (o.source = 'old_system' or (o.source = 'old_system_ref' and o.value similar to ${rolePrefix}))
				)) as exact_ref) refs
			where refs.exact_ref or ${named(sql.ref("p.name"), query)} ${fuzzyName} or exists (
				select from party_email e where e.party_id = p.id and e.address = lower(btrim(${query})))
			order by refs.exact_ref desc, ${relevance}, lower(p.name), refs.ref, kind
		`.execute(db)
	).rows;
}

const dealRefMatch = (
	query: string,
) => sql<boolean>`d.id::text = lower(${query}) or exists (
	select from outside_id where source = 'old_system' and deal_id = d.id and value = lower(${query}))`;

const matchingDeals = (db: Transaction<DB>, query: string) =>
	db
		.selectFrom("deal as d")
		.where((eb) =>
			eb.or([named(eb.ref("d.name"), query), dealRefMatch(query)]),
		);

export const matchingDealSubjects = (db: Transaction<DB>, query: string) =>
	matchingDeals(db, query)
		.select([
			"d.id",
			"d.name",
			sql.lit("deal").as("kind"),
			dealRefMatch(query).as("exact_ref"),
			sql<string>`coalesce((select min(value) from outside_id
			where source = 'old_system' and deal_id = d.id), d.id::text)`.as("ref"),
		])
		.execute();

const searchDeals = (db: Transaction<DB>) =>
	db
		.selectFrom(selectNextDeals(db).as("deals"))
		.select([
			"name",
			"phase",
			"owner",
			"invoiced_on",
			"closed_on",
			"outcome",
			contactRef(sql.ref("client_id"), sql.lit("C-%")).as("client_ref"),
			sql<string>`case workspace_kind when 'national_account' then 'national' else 'territory' end`.as(
				"lane",
			),
		]);

const connectionEndpoint = (id: Expression<string>) =>
	sql`select p.name, coalesce(copied.ref, p.id::text) as ref
		from party p left join party_role r on r.party_id = p.id and r.role in ('client', 'lead', 'vendor')
		cross join lateral (select ${copiedContactRef(sql.ref("p.id"), rolePrefix)} as ref) copied
		where p.id = ${id}
		order by copied.ref is null, r.role limit 1`;

const connections = (db: Transaction<DB>, ids: string[]) =>
	sql`select f.ref as from_ref, f.name as from_name, l.kind,
		t.ref as to_ref, t.name as to_name, l.note
		from party_link l
		cross join lateral (${connectionEndpoint(sql.ref("l.party_id"))}) f
		cross join lateral (${connectionEndpoint(sql.ref("l.other_party_id"))}) t
		where l.party_id = any(${ids}::uuid[]) or l.other_party_id = any(${ids}::uuid[])
		order by l.created_at desc, l.id limit 12`.execute(db);

const leadClientLinks = (db: Transaction<DB>, ids: string[]) =>
	sql<{ client_id: string }>`
		select lead.name as lead_name, client.name as client_name,
			${contactRef(sql.ref("lead.id"), sql.lit("L-%"))} as lead_ref,
			${contactRef(sql.ref("client.id"), sql.lit("C-%"))} as client_ref,
			case when lead.id = client.id then 'same_party' else 'same_org' end as link_basis,
			false as either_merged, client.id as client_id
		from party_role r join party lead on lead.id = r.party_id
		join client c on c.party_id = lead.id or exists (
			select from party_company pc where pc.person_id = lead.id and pc.company_id = c.party_id
				and (pc.started_on is null or pc.started_on <= current_date)
				and (pc.ended_on is null or pc.ended_on > current_date))
		join party client on client.id = c.party_id
		where r.role = 'lead' and (lead.id = any(${ids}::uuid[]) or client.id = any(${ids}::uuid[]))
		order by link_basis desc, lead_ref, client_ref limit 20`.execute(db);

export async function readNextFind(db: Transaction<DB>, query: string) {
	const contacts = await matchingContacts(db, query, true);
	const parties = contacts.filter((p) => p.kind !== "party").slice(0, 10);
	const names = [
		...new Set(contacts.filter((p) => p.kind === "party").map((p) => p.name)),
	].slice(0, 5);
	const organizations = names.map((name) => {
		const group = contacts.filter((p) => p.name === name);
		const refs = group.filter((p) => p.kind === "party").map((p) => p.ref);
		const role_refs = group.filter((p) => p.kind !== "party").map((p) => p.ref);
		return {
			name,
			refs,
			live_rows: refs.length,
			role_refs,
			live_as_role: role_refs.length,
			retired_aliases: 0,
			retired_refs: [],
			retired_refs_truncated: false,
			all_retired: false,
		};
	});
	const ids = [
		...new Set(
			[...parties, ...contacts.filter((p) => names.includes(p.name))].map(
				(p) => p.id,
			),
		),
	];
	const deals = searchDeals(db)
		.where("deals.id", "in", matchingDeals(db, query).select("d.id"))
		.orderBy("name")
		.orderBy("deals.id")
		.limit(5);
	const [matchedDeals, { rows: links }, { rows: related }] = await Promise.all([
		deals.execute(),
		leadClientLinks(db, ids),
		connections(db, ids),
	]);
	const clients = [...new Set(links.map((link) => link.client_id))];
	return {
		parties: parties.map(({ id: _id, exact_ref: _exact, ...p }) => ({
			...p,
			merged: false,
		})),
		deals: matchedDeals,
		connections: related,
		organizations,
		lead_client_links: links.map(({ client_id: _id, ...link }) => link),
		deals_via_link:
			ids.length === 0
				? []
				: await searchDeals(db)
						.where((eb) =>
							eb.or([
								sql<boolean>`client_id = any(${clients}::uuid[])`,
								eb(
									"deals.id",
									"in",
									db
										.selectFrom("deal_party")
										.select("deal_id")
										.where("role", "=", "client_contact")
										.where("party_id", "in", ids),
								),
							]),
						)
						.where(
							"deals.id",
							"not in",
							matchingDeals(db, query).select("d.id"),
						)
						.orderBy("client_ref")
						.orderBy("name")
						.orderBy("deals.id")
						.limit(20)
						.execute(),
		note: "Search shows current records.",
	};
}
