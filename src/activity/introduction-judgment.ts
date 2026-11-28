import { type RawBuilder, sql, type Transaction } from "kysely";
import { z } from "zod";
import type { DB } from "../next-database.d.ts";

export const introductionContext = z.object({
	sent_on: z.iso.date(),
	sender_ids: z.array(z.uuid()),
	candidates: z.array(
		z.object({
			kind: z.enum(["vendor", "person", "partner", "deal"]),
			id: z.uuid(),
			name: z.string(),
			aliases: z.array(z.string()),
		}),
	),
});
type IntroductionContext = z.infer<typeof introductionContext>;

const words = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
const containsName = (text: string, name: string) =>
	Boolean(name) && ` ${text} `.includes(` ${name} `);

const nameWords = (text: RawBuilder<unknown>) =>
	sql`btrim(regexp_replace(lower(${text}), '[^[:alnum:]]+', ' ', 'g'))`;

export async function introductionMail(tx: Transaction<DB>, activity: string) {
	const {
		rows: [mail],
	} = await sql<IntroductionContext>`
		with message as materialized (
			select sender, ' ' || ${nameWords(sql`subject || ' ' || body`)} || ' ' as evidence,
				(a.happened_at at time zone 'America/Chicago')::date as sent_on
			from email e join activity a on a.id = e.activity_id where e.activity_id = ${activity}
		), records as (
			select p.id, p.name, case when u.id is null then 'person' else 'partner' end as kind
			from party p left join app_user u on u.id = p.id and u.is_account_partner where p.kind = 'person'
			union all
			select p.id, p.name, 'vendor' from party_role r join party p on p.id = r.party_id where r.role = 'vendor'
			union all
			select id, name, 'deal' from deal
		), named as (
			select *, ${nameWords(sql.ref("name"))} as name_key from records
		), unique_names as materialized (
			select id, name, kind, name_key from (
				select *, count(*) over (partition by case when kind = 'partner' then 'person' else kind end, name_key) as matches from named
			) names where matches = 1 and name_key <> ''
		), affiliations as materialized (
			select c.company_id, p.name, count(*) over (partition by p.name_key) as vendors
			from party_company c join unique_names p on p.id = c.person_id and p.kind = 'person'
			join party_role v on v.party_id = c.company_id and v.role = 'vendor'
			cross join message m
			where (c.started_on is null or c.started_on <= m.sent_on) and (c.ended_on is null or c.ended_on > m.sent_on)
				and strpos(m.evidence, ' ' || p.name_key || ' ') > 0
		), candidates as (
			select n.id, n.name, n.kind, a.aliases
			from unique_names n cross join message m cross join lateral (
				select array(select name from affiliations where company_id = n.id and vendors = 1
					and n.kind = 'vendor' order by name) as aliases
			) a
			where strpos(m.evidence, ' ' || n.name_key || ' ') > 0 or cardinality(a.aliases) > 0 or (
				n.kind = 'partner' and exists (
					select from party_email pe where pe.address = m.sender and pe.party_id = n.id
				))
		)
		select sent_on::text,
			array(select party_id from party_email where address = m.sender order by party_id) as sender_ids,
			(select jsonb_agg(to_jsonb(c) order by kind, name, id) from candidates c) as candidates
		from message m where exists (
			select from candidates v join candidates p on p.id <> v.id where v.kind = 'vendor' and p.kind = 'person'
		)
	`.execute(tx);
	return mail;
}

const fields = {
	vendor_id: z.uuid(),
	introduced_party_id: z.uuid(),
	deal_id: z.uuid().nullable(),
	quote: z
		.string()
		.refine(
			(value) =>
				/\S/.test(value) && value.isWellFormed() && !value.includes("\0"),
		),
};
const introductions = z.strictObject({
	introductions: z.array(
		z.discriminatedUnion("made_by", [
			z.strictObject({
				...fields,
				made_by: z.literal("vendor"),
				introduced_by_user_id: z.null(),
			}),
			z.strictObject({
				...fields,
				made_by: z.literal("team"),
				introduced_by_user_id: z.uuid(),
			}),
		]),
	),
});

function madeByPartner(
	partner: IntroductionContext["candidates"][number] | undefined,
	named: (name: string) => boolean,
	senderIds: string[],
) {
	return (
		partner &&
		(named(partner.name) ||
			(senderIds.length === 1 && senderIds[0] === partner.id))
	);
}

export function validateIntroductions(
	outcome: unknown,
	mail: IntroductionContext,
	quotesEmail: (quote: string) => boolean,
) {
	const result = introductions.safeParse(outcome).data;
	if (
		!result?.introductions.every((i) => {
			if (!quotesEmail(i.quote) || i.vendor_id === i.introduced_party_id)
				return false;
			const quoted = words(i.quote);
			const candidate = (
				kind: IntroductionContext["candidates"][number]["kind"],
				id: string,
			) => mail.candidates.find((c) => c.kind === kind && c.id === id);
			const named = (name: string) => containsName(quoted, words(name));
			const person = candidate("person", i.introduced_party_id);
			const vendor = candidate("vendor", i.vendor_id);
			const deal = i.deal_id && candidate("deal", i.deal_id);
			return (
				quoted.length >= 20 &&
				/ /u.test(quoted) &&
				person &&
				named(person.name) &&
				vendor &&
				(named(vendor.name) ||
					vendor.aliases.some(
						(alias) => words(alias) !== words(person.name) && named(alias),
					)) &&
				(i.deal_id === null || (deal && named(deal.name))) &&
				(i.made_by === "vendor" ||
					madeByPartner(
						candidate("partner", i.introduced_by_user_id),
						named,
						mail.sender_ids,
					))
			);
		})
	)
		return;
	return { ...result, introduced_on: mail.sent_on };
}

export async function saveIntroductions(
	tx: Transaction<DB>,
	job: string,
	result: NonNullable<ReturnType<typeof validateIntroductions>>,
) {
	if (!result.introductions.length) return;
	await sql`select set_config('engine.job', 'mail_capture', true)`.execute(tx);
	await tx
		.insertInto("introduction")
		.values(
			result.introductions
				.toSorted((a, b) => a.vendor_id.localeCompare(b.vendor_id))
				.map(({ quote: _quote, ...i }) => ({
					...i,
					introduced_on: result.introduced_on,
					source_job_id: job,
					confirmed: false,
					changed_at: sql<string>`now()`,
				})),
		)
		.execute();
}
