import { Hono } from "hono";
import { etag } from "hono/etag";
import { sql, type Transaction } from "kysely";
import { answerNextRead, checkFields, Refusal, refuse } from "../answer.ts";
import { PARTNERS } from "../clients/read.ts";
import type { DB } from "../next-database.d.ts";
import type { DatabaseEnv } from "../reader.ts";
import { isUuid } from "../request-shape.ts";

type Note = {
	activity_id: string;
	summary: string | null;
	by: string | null;
	at: string;
};

type Prospect = {
	party_id: string;
	name: string;
	kind: "person" | "company";
	how_found: string;
	owner: string | null;
	needs_attention: boolean;
	follow_ups: {
		next_step_id: string;
		owner: string;
		what: string;
		due_on: string | null;
	}[];
	change_id: number;
	notes: Note[];
};

async function readProspects(
	db: Transaction<DB>,
	{
		partyId = null,
		owner = "all",
	}: { partyId?: string | null; owner?: string } = {},
) {
	const { rows } = await sql<Prospect>`
		select p.id as party_id, p.name, p.kind, p.how_found, owner.slug as owner,
			r.needs_attention, coalesce(history.change_id, 0)::float8 as change_id,
			notes.items as notes, follow_ups.items as follow_ups
		from party_role r
		join party p on p.id = r.party_id
		left join app_user owner on owner.id = r.owner_user_id
		cross join lateral (
			select max(c.id) as change_id,
				max(c.changed_at) filter (where c.action = 'update' and c.new_value->>'stage' = 'opportunity') as entered_at
			from change c
			where c.table_name = 'party_role'
				and c.record = jsonb_build_object('party_id', p.id, 'role', 'lead')
		) history
		cross join lateral (
			select coalesce(jsonb_agg(to_jsonb(n) order by n.at desc, n.activity_id desc), '[]') as items
			from (
				select a.id as activity_id, a.summary, a.happened_at as at,
					coalesce(writer.slug, author.name, a.changed_by_job) as by
				from activity_about link
				join activity a on a.id = link.activity_id
				left join party author on author.id = a.from_party_id
				left join app_user writer on writer.id =
					coalesce(a.from_party_id, a.changed_by_user_id, a.changed_for_user_id)
				where link.party_id = p.id and a.kind = 'note'
				order by a.happened_at desc, a.id desc
				limit ${partyId === null ? 1 : null}
			) n
		) notes
		cross join lateral (
			select coalesce(jsonb_agg(jsonb_build_object('next_step_id', s.id,
				'owner', u.slug, 'what', s.what, 'due_on', s.due_on)
				order by s.due_on nulls last, s.id), '[]') as items,
				min(s.due_on) as soonest
			from next_step s
			join app_user u on u.id = s.owner_party_id
			where s.deal_id is null and s.party_id = p.id and s.property_id is null
				and s.status = 'open' and s.item_title is null
		) follow_ups
		where r.role = 'lead' and r.stage = 'opportunity'
			and not exists (select from deal_party d where d.party_id = p.id)
			and (${partyId}::uuid is null or p.id = ${partyId}::uuid)
			and (${owner} = 'all' or owner.slug is null or owner.slug = ${owner})
		order by r.needs_attention desc, follow_ups.soonest nulls last,
			coalesce(history.entered_at, r.created_at) desc, p.id
	`.execute(db);
	return rows;
}

function card({ notes, ...prospect }: Prospect) {
	const note = notes[0];
	return {
		...prospect,
		latest_note: note
			? { summary: note.summary, by: note.by, at: note.at }
			: null,
	};
}

export const prospectReads = new Hono<DatabaseEnv>()
	.get("/prospects", async (c): Promise<Response> => {
		const params = new URL(c.req.url).searchParams;
		const error = checkFields(params, ["owner"], {
			vocabularies: { owner: ["all", ...PARTNERS] },
		});
		if (error) return refuse(c, error);
		return answerNextRead(c, "read-prospects", async (db) => {
			const rows = await readProspects(db, {
				owner: params.get("owner") ?? "all",
			});
			return { prospects: rows.map(card), count: rows.length };
		});
	})
	.get("/prospects/:party_id", etag(), async (c): Promise<Response> => {
		const partyId = c.req.param("party_id");
		if (!isUuid(partyId))
			return refuse(
				c,
				new Refusal(400, "invalid_field_value", { fields: ["party_id"] }),
			);
		return answerNextRead(c, "read-prospects", async (db) => {
			const [row] = await readProspects(db, { partyId });
			return row
				? { ...card(row), notes: row.notes }
				: new Refusal(404, "not_found");
		});
	});
