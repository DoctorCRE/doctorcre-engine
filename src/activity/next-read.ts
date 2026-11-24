import { sql, type Transaction } from "kysely";
import { hasToolCallMarkup, isoMillis } from "../answer.ts";
import { homeDayAt } from "../home-steps.ts";
import type { DB } from "../next-database.d.ts";
import { matchingContacts, matchingDealSubjects } from "../search/next-find.ts";

async function activityCandidates(
	db: Transaction<DB>,
	term: string,
	exactOnly = false,
) {
	const [contacts, deals] = await Promise.all([
		matchingContacts(db, term),
		matchingDealSubjects(db, term),
	]);
	const matches = [...contacts, ...deals];
	const lookup = term.toLowerCase();
	const canonical = matches.filter(
		(match) => match.ref.toLowerCase() === lookup,
	);
	if (canonical.length > 0) return canonical;
	const exact = matches.filter((match) => match.exact_ref);
	if (exactOnly || exact.length > 0) return exact;
	const named = matches.filter((match) => match.name.toLowerCase() === lookup);
	return named.length > 0 ? named : matches;
}

type FiledOn = { kind: "deal" | "company" | "person"; name: string };

// Rank 0 is the record; a client adds its deals, then a person's current companies (not coworkers) or a company's current people.
function filedTo(kind: string, id: string, now: string) {
	if (kind === "deal")
		return sql`select ${id}::uuid as deal_id, null::uuid as party_id, 0 as rank, null::text as kind, null::text as name`;
	const today = homeDayAt(sql`${now}::timestamptz`);
	const current = sql`(pc.started_on is null or pc.started_on <= ${today})
		and (pc.ended_on is null or pc.ended_on > ${today})`;
	return sql`
		select null::uuid as deal_id, ${id}::uuid as party_id, 0 as rank, null::text as kind, null::text as name
		union all
		select d.id, null, 1, 'deal', d.name
		from client c join deal_party dp on dp.party_id = c.party_id and dp.role = 'client'
		join deal d on d.id = dp.deal_id where c.party_id = ${id}
		union
		select null::uuid, p.id, 2, p.kind, p.name
		from client c join party_company pc on pc.person_id = c.party_id and ${current}
		join party p on p.id = pc.company_id where c.party_id = ${id}
		union
		select null::uuid, p.id, 3, p.kind, p.name
		from client c join party_company pc on pc.company_id = c.party_id and ${current}
		join party p on p.id = pc.person_id where c.party_id = ${id}`;
}

const filedOn = (row: ReturnType<typeof sql.ref>) =>
	sql<FiledOn | null>`case when ${row}.rank > 0
		then jsonb_build_object('kind', ${row}.kind, 'name', ${row}.name) end`;

export async function readNextRecentActivity(
	db: Transaction<DB>,
	userId: string,
	{
		query,
		limit,
		ref,
		now,
	}: { query: string; limit: number; ref: string | undefined; now: string },
) {
	const byRef = ref ? await activityCandidates(db, ref, true) : [];
	const matching =
		byRef.length > 0 ? byRef : await activityCandidates(db, query);
	const bySubject = new Map<string, (typeof matching)[number]>();
	for (const match of matching) {
		const subjectKey = `${match.kind === "deal" ? "deal" : "contact"}:${match.id}`;
		if (!bySubject.has(subjectKey)) bySubject.set(subjectKey, match);
	}
	const candidates = [...bySubject.values()].sort((a, b) =>
		a.ref.localeCompare(b.ref),
	);
	const [selected] = candidates;
	if (!selected)
		return {
			state: "not_found",
			query,
			candidates: [],
			retired_matches: 0,
			hint: "No live record matched this name.",
		};
	if (candidates.length > 1)
		return {
			state: "needs_disambiguation",
			query,
			candidate_count: candidates.length,
			candidates: candidates
				.slice(0, 25)
				.map(({ kind, name, ref: target }) => ({ kind, name, target })),
			candidates_truncated: candidates.length > 25,
			hint: "Choose one exact target to see its recent activity.",
		};
	const { id, kind, name, ref: target } = selected;
	if (hasToolCallMarkup("ref", target))
		return { error: "tool_call_markup_in_value" } as const;
	const subject = kind === "deal" ? sql.ref("deal_id") : sql.ref("party_id");
	const filed = sql`from activity_about link join activity a on a.id = link.activity_id`;
	const calendar = await sql`
		select a.calendar_review_key as key, a.id as activity_id, a.summary
		${filed} where link.${subject} = ${id} and a.calendar_review_user_id = ${userId}
		order by a.calendar_review_key limit 5001`.execute(db);
	if (calendar.rows.length > 5000)
		return { error: "calendar_history_too_large" } as const;
	const timeline = await sql`
		with filed_to as (${filedTo(kind, id, now)}),
		filed as (
			select distinct on (link.activity_id) link.activity_id, f.rank, f.kind, f.name
			from filed_to f join activity_about link
				on link.deal_id = f.deal_id or link.party_id = f.party_id
			order by link.activity_id, f.rank
		)
		select entry_kind, ${isoMillis(sql.ref("at"))} as occurred_at,
			actor, verb, summary, detail, deal_id, email_subject, null as owed, step_owner, filed_on
		from (
			select 'activity' as entry_kind, a.id, a.happened_at as at,
				coalesce(u.slug, a.changed_by_job) as actor, a.kind as verb,
				coalesce(nullif(btrim(a.summary), ''), e.subject) as summary, e.body as detail,
				(select min(about.deal_id::text) from activity_about about
					where about.activity_id = a.id and about.deal_id is not null
					having count(*) = 1) as deal_id, e.subject as email_subject, null as step_owner,
				${filedOn(sql.ref("filed"))} as filed_on
			from filed join activity a on a.id = filed.activity_id
			left join app_user u on u.id = a.changed_by_user_id
			left join email e on e.activity_id = a.id
			union all
			select 'event', s.id, coalesce(s.done_at, s.resolved_at, s.created_at),
				coalesce(u.slug, s.changed_by_job), 'next_step', s.what, null, s.deal_id::text, null,
				owner.slug, ${filedOn(sql.ref("f"))}
			from filed_to f join next_step s on s.deal_id = f.deal_id or s.party_id = f.party_id
			left join app_user u on u.id = s.changed_by_user_id
			left join app_user owner on owner.id = s.owner_party_id
		) entries order by at desc, entry_kind, id limit ${limit}`.execute(db);
	return {
		state: "completed",
		query,
		match: { kind, name, target },
		catch_up: {
			subject: { type: kind, id },
			timeline: timeline.rows,
			calendar_history: calendar.rows,
		},
	};
}
