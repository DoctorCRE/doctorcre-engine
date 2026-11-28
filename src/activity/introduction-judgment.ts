import { sql, type Transaction } from "kysely";
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
		}),
	),
});
type IntroductionContext = z.infer<typeof introductionContext>;

export async function introductionMail(tx: Transaction<DB>, activity: string) {
	const {
		rows: [mail],
	} = await sql<IntroductionContext>`
		with message as materialized (
			select sender, lower(subject || E'\\n' || body) as evidence,
				(a.happened_at at time zone 'America/Chicago')::date as sent_on
			from email e join activity a on a.id = e.activity_id where e.activity_id = ${activity}
		), mentioned as (
			select p.id, p.name, p.kind from party p cross join message m
			where p.name ~ '\\S' and strpos(m.evidence, lower(p.name)) > 0
			union
			select p.id, p.name, p.kind from party p join party_email pe on pe.party_id = p.id
			where pe.address in (select sender from message union all
				select address from email_recipient where activity_id = ${activity})
		), candidates as (
			select case when u.id is null then 'person' else 'partner' end as kind, p.id, p.name
			from mentioned p left join app_user u on u.id = p.id and u.is_account_partner
			where p.kind = 'person'
			union all
			select 'vendor', p.id, p.name from party_role r join party p on p.id = r.party_id
			where r.role = 'vendor' and (p.id in (select id from mentioned) or exists (
				select from party_company c cross join message m
				where c.company_id = p.id and c.person_id in (select id from mentioned)
					and (c.started_on is null or c.started_on <= m.sent_on)
					and (c.ended_on is null or c.ended_on > m.sent_on)
			))
			union all
			select 'deal', d.id, d.name from deal d cross join message m
			where d.name ~ '\\S' and strpos(m.evidence, lower(d.name)) > 0
		)
		select sent_on::text,
			array(select party_id from party_email where address = message.sender order by party_id) as sender_ids,
			(select jsonb_agg(to_jsonb(c) order by kind, name, id) from candidates c) as candidates
		from message where exists (
			select from candidates v join candidates p on p.id <> v.id
			where v.kind = 'vendor' and p.kind = 'person'
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

export function validateIntroductions(
	outcome: unknown,
	mail: IntroductionContext,
	quotesEmail: (quote: string) => boolean,
) {
	const result = introductions.safeParse(outcome).data;
	const known = (
		kind: IntroductionContext["candidates"][number]["kind"],
		id: string,
	) =>
		mail.candidates.some(
			(candidate) => candidate.kind === kind && candidate.id === id,
		);
	if (
		!result?.introductions.every(
			(i) =>
				i.vendor_id !== i.introduced_party_id &&
				known("vendor", i.vendor_id) &&
				known("person", i.introduced_party_id) &&
				(i.made_by === "vendor" || known("partner", i.introduced_by_user_id)) &&
				(i.deal_id === null || known("deal", i.deal_id)) &&
				quotesEmail(i.quote),
		)
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
