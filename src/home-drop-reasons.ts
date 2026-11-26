import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { answerNextRead, checkFields, Refusal, refuse } from "./answer.ts";
import { replacedStepReason } from "./home-inbox-review.ts";
import type { DB } from "./next-database.d.ts";
import { replacedNextStepReason } from "./next-steps.ts";
import type { DatabaseEnv } from "./reader.ts";
import { replacedDraftReason } from "./reply-drafts.ts";

// Each category names the stored drops it learns from: dismissed suggestions, cancelled next steps, dropped Home marks, or dismissed reply drafts.
const dropCategories = {
	next_step: {
		drops: ["proposal:next_step", "next_step", "call_follow_up"],
		starters: ["Already handled", "Not needed", "Duplicate", "Not ours to do"],
	},
	filing: {
		drops: ["proposal:file_to_deal", "proposal:possible_new_deal"],
		starters: ["Not about a deal", "Not business", "Spam", "Already filed"],
	},
	phase_move: {
		drops: ["proposal:phase_move"],
		starters: ["Phase is right", "Too early", "Already moved"],
	},
	lead: {
		drops: [
			"proposal:new_lead",
			"proposal:email_lead",
			"proposal:lead_stage_move",
		],
		starters: ["Not a lead", "Spam", "Already a client", "Duplicate"],
	},
	call_note: {
		drops: ["proposal:log_call"],
		starters: ["Not about business", "Already logged", "Not relevant"],
	},
	reply_draft: {
		drops: ["reply_draft"],
		starters: ["Already replied", "No reply needed", "Replying myself"],
	},
	checklist_reminder: {
		drops: ["home_update:update"],
		starters: ["Already done", "Not needed on this deal"],
	},
	tour_feedback: {
		drops: ["home_update:tour_feedback"],
		starters: ["Already handled", "Not relevant"],
	},
} as const;
type DropCategory = keyof typeof dropCategories;
const isCategory = (value: string | null): value is DropCategory =>
	value !== null && Object.hasOwn(dropCategories, value);
const CHOICES = 5;
// A typed reason becomes a choice once it has been used twice, so a one-off never crowds out the starters.
const REPEATED = 2;
// Reasons the engine or the move copy writes itself, never a partner.
const systemStepReasons = [
	replacedNextStepReason,
	"replaced at the move",
	"not recorded before this system",
] as const;

const tidy = (column: string) =>
	sql`regexp_replace(regexp_replace(${sql.ref(column)}, '\\s+', ' ', 'g'), '^ | $', '', 'g')`;

async function readDropReasons(
	db: Transaction<DB>,
	userId: string,
	category: DropCategory,
) {
	const { drops, starters } = dropCategories[category];
	const { rows } = await sql<{ text: string }>`
		with dropped as (
			(
				select distinct on (p.changed_at, p.dismiss_reason)
					'proposal:' || p.kind as source, p.dismiss_reason as reason, p.decided_at as at
				from next_partner.proposal p
				where p.status = 'dismissed' and p.decided_by_user_id = ${userId}
					and 'proposal:' || p.kind = any(${[...drops]}::text[])
					and p.dismiss_reason <> ${replacedStepReason}
				order by p.changed_at, p.dismiss_reason, p.decided_at desc
			)
			union all
			select 'next_step', s.resolution_reason, coalesce(s.resolved_at, s.changed_at)
			from next_partner.next_step s
			where s.status = 'cancelled' and s.changed_by_user_id = ${userId}
				and s.resolution_reason <> all(${[...systemStepReasons]}::text[])
			union all
			select 'reply_draft', r.dismiss_reason, r.decided_at from reply_draft r
			where r.status = 'dismissed' and r.owner_user_id = ${userId}
				and r.dismiss_reason <> ${replacedDraftReason}
			union all
			select coalesce('home_update:' || u.kind, m.item_kind), m.drop_reason, m.changed_at
			from home_mark m left join next_partner.home_update u on u.id = m.home_update_id
			where m.disposition = 'dropped' and m.user_id = ${userId}
		), used as (
			select lower(${tidy("reason")}) as key, count(*) as uses, max(at) as last_at,
				(array_agg(${tidy("reason")} order by at desc))[1] as text
			from dropped where source = any(${[...drops]}::text[])
			group by 1
		), starter as (
			select s.text, s.position from unnest(${[...starters]}::text[]) with ordinality s(text, position)
		)
		select coalesce(s.text, u.text) as text
		from used u full join starter s on u.key = lower(${tidy("s.text")})
		where s.text is not null or u.uses >= ${REPEATED}
		order by coalesce(u.uses, 0) desc, u.last_at desc nulls last, s.position
		limit ${CHOICES}
	`.execute(db);
	return { category, reasons: rows.map((row) => row.text) };
}

export const homeDropReasons = new Hono<DatabaseEnv>().get(
	"/home/drop-reasons",
	async (c) => {
		const params = new URL(c.req.url).searchParams;
		const refused = checkFields(params, ["category"], {
			vocabularies: { category: Object.keys(dropCategories) },
		});
		if (refused) return refuse(c, refused);
		const category = params.get("category");
		if (!isCategory(category))
			return refuse(
				c,
				new Refusal(400, "missing_required", { fields: ["category"] }),
			);
		return answerNextRead(c, "read-home-drop-reasons", (db, userId) =>
			readDropReasons(db, userId, category),
		);
	},
);
