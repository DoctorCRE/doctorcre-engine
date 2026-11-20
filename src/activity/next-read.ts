import { sql, type Transaction } from "kysely";
import { hasToolCallMarkup, isoMillis } from "../answer.ts";
import type { DB } from "../next-database.d.ts";
import { matchingContacts, matchingDealSubjects } from "../search/next-find.ts";

export async function readNextRecentActivity(
	db: Transaction<DB>,
	userId: string,
	query: string,
	limit: number,
) {
	const [contacts, deals] = await Promise.all([
		matchingContacts(db, query),
		matchingDealSubjects(db, query),
	]);
	const matches = [...contacts, ...deals];
	const exact = matches.filter((match) => match.exact_ref);
	const named = matches.filter(
		(match) => match.name.toLowerCase() === query.toLowerCase(),
	);
	const matching =
		exact.length > 0 ? exact : named.length > 0 ? named : matches;
	const byTarget = new Map<string, (typeof matching)[number]>();
	for (const match of matching) {
		if (!byTarget.has(match.ref)) byTarget.set(match.ref, match);
	}
	const candidates = [...byTarget.values()].sort((a, b) =>
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
		select entry_kind, ${isoMillis(sql.ref("at"))} as occurred_at,
			actor, verb, summary, null as detail, null as owed
		from (
			select 'activity' as entry_kind, a.id, a.happened_at as at,
				coalesce(u.slug, a.changed_by_job) as actor, a.kind as verb,
				coalesce(nullif(btrim(a.summary), ''), e.subject) as summary
			${filed} left join app_user u on u.id = a.changed_by_user_id
			left join email e on e.activity_id = a.id
			where link.${subject} = ${id}
			union all
			select 'event', s.id, coalesce(s.done_at, s.resolved_at, s.created_at),
				coalesce(u.slug, s.changed_by_job), 'next_step', s.what
			from next_step s left join app_user u on u.id = s.changed_by_user_id
			where s.${subject} = ${id}
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
