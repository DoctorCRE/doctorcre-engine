import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { answerNextRead, Refusal } from "./answer.ts";
import { dealStepUrl } from "./home-steps.ts";
import type { DB } from "./next-database.d.ts";
import type { DatabaseEnv } from "./reader.ts";
import { isUuid } from "./request-shape.ts";

const PAGE = 50;

type HistoryRow = {
	source: "change" | "imported";
	key: string;
	changed_at: string;
	// Microseconds since 1970 as int8 text, so the two sources merge in the order they happened.
	micros: string;
	who: string | null;
	job: string | null;
	deal_id: string | null;
	party_id: string | null;
	step_id: string | null;
	record: string;
	step: string | null;
	table_name: string;
	action: string;
	field: string | null;
	new_value: Record<string, unknown> | null;
	// Names behind ids, worked out where the row is read.
	phase: string | null;
	owner: string | null;
	market: string | null;
};

// Each source resumes after the last row it gave. Native history pages by its id, which grows with time.
type Cursor = { change: number; imported: string | null };
const TOP: Cursor = { change: Number.MAX_SAFE_INTEGER, imported: null };
// No imported row has the nil id, so nothing reads after it.
const SPENT = "00000000-0000-0000-0000-000000000000";

const money = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 0,
});
const day = (date: unknown) =>
	new Date(`${date}T00:00Z`).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	});

const PARKING: Record<string, string> = {
	client_paused: "the client paused",
	prospect_never_active: "the prospect was never active",
	other: "another reason",
};

const dealEdits: [string, (row: HistoryRow, value: unknown) => string][] = [
	["name", (_, name) => `renamed the deal to ${name}`],
	["owner_user_id", (row) => `made ${row.owner} the deal owner`],
	[
		"market_id",
		(row) =>
			row.market ? `set the market to ${row.market}` : "cleared the market",
	],
	[
		"closed_value",
		(_, value) =>
			value === null
				? "cleared the deal value"
				: `set the deal value to ${money.format(Number(value))}`,
	],
	[
		"needs_attention",
		(_, on) =>
			on
				? "flagged the deal for attention"
				: "cleared the deal's attention flag",
	],
	[
		"parking_reason",
		(_, reason) =>
			typeof reason === "string"
				? `parked the deal: ${PARKING[reason]}`
				: "revived the deal",
	],
];

const stepEdits: [string, (value: unknown) => string][] = [
	[
		"resolution",
		(resolution) =>
			resolution === "done"
				? "finished the next step"
				: `marked the next step ${resolution}`,
	],
	["what", () => "reworded the next step"],
	[
		"due_on",
		(due) =>
			due
				? `moved the next step to ${day(due)}`
				: "cleared the next step's due date",
	],
];

// Old-system history keeps the old payload, so only what changed is named.
const IMPORTED: Record<string, string> = {
	"deal.owner_user_id": "changed the deal owner",
	"deal.closed_value": "changed the deal value",
	"deal.market_id": "changed the market",
	"deal.parking_reason": "parked or revived the deal",
	"deal.parking_note": "parked or revived the deal",
	"deal.needs_attention": "changed the deal's attention flag",
	"activity.summary": "added a note",
	"party.name": "changed the name",
	"party.npi": "changed the NPI",
	"party_role.stage": "changed the stage",
	"party_role.owner_user_id": "changed the lead owner",
	"party_role.estimated_lease_on": "changed the lease estimate",
	"party_role.offers": "changed what the vendor offers",
	"party_role.seeking": "changed what the vendor is seeking",
	"client.status": "changed the client status",
	"client.client_type": "changed the client type",
};

function whatChanged(row: HistoryRow) {
	const now = row.new_value ?? {};
	if (row.source === "imported")
		return IMPORTED[`${row.table_name}.${row.field}`];
	if (row.table_name === "deal_phase_change")
		return `moved the deal to ${row.phase}`;
	if (row.table_name === "deal")
		return row.action === "insert"
			? "opened the deal"
			: dealEdits
					.filter(([field]) => field in now)
					.map(([field, say]) => say(row, now[field]))
					.join(", ");
	if (row.action === "insert") return `added a next step: ${row.step}`;
	const said = stepEdits
		.filter(([field]) => field in now)
		.map(([field, say]) => say(now[field]));
	return `${said.join(", ")}: ${row.step}`;
}

const openUrl = (row: HistoryRow) => {
	if (row.deal_id)
		return row.step_id
			? dealStepUrl(row.deal_id, row.step_id)
			: `/deals?deal=${row.deal_id}`;
	const step = row.step_id ? `&step=${row.step_id}` : "";
	return `/relationships?node=party:${row.party_id}${step}`;
};

// The app names a job, as it does on notes and the timeline.
const who = (stamp: string) =>
	sql`(select name from party where id = ${sql.ref(`${stamp}.changed_by_user_id`)}) as who,
		${sql.ref(`${stamp}.changed_by_job`)} as job`;

const readable = (fields: [string, unknown][]) =>
	sql.val(fields.map(([field]) => field));

async function readNative(db: Transaction<DB>, before: number) {
	const { rows } = await sql<HistoryRow>`
		select 'change' as source, c.id::text as key, c.changed_at,
			(extract(epoch from c.changed_at) * 1000000)::int8 as micros, ${who("c")},
			coalesce(d.id, s.deal_id) as deal_id, s.party_id, s.id as step_id,
			coalesce(d.name, sd.name, sp.name) as record, coalesce(c.new_value ->> 'what', s.what) as step,
			c.table_name, c.action, null as field, c.new_value,
			(select label from phase where slug = c.new_value ->> 'phase') as phase,
			(select name from party where id = (c.new_value ->> 'owner_user_id')::uuid) as owner,
			(select name from market where id = (c.new_value ->> 'market_id')::uuid) as market
		from change c
		left join deal d on d.id = case c.table_name
			when 'deal' then (c.record ->> 'id')::uuid when 'deal_phase_change' then (c.record ->> 'deal_id')::uuid end
		left join next_step s on c.table_name = 'next_step' and s.id = (c.record ->> 'id')::uuid
		left join deal sd on sd.id = s.deal_id
		left join party sp on sp.id = s.party_id
		where c.id < ${before}
			-- A copy's own history records copying, not anyone's work.
			and c.changed_by_job is distinct from 'old_system'
			and coalesce(d.id, sd.id, sp.id) is not null
			and (c.table_name = 'deal_phase_change' and c.action = 'insert'
				or c.table_name = 'deal' and (c.action = 'insert' or c.new_value ?| ${readable(dealEdits)}::text[])
				or c.table_name = 'next_step' and (c.action = 'insert' or c.new_value ?| ${readable(stepEdits)}::text[]))
		order by c.id desc limit ${PAGE + 1}
	`.execute(db);
	return rows;
}

async function readImported(db: Transaction<DB>, after: string | null) {
	const { rows } = await sql<HistoryRow>`
		select 'imported' as source, i.id::text as key, i.changed_at,
			(extract(epoch from i.changed_at) * 1000000)::int8 as micros, ${who("i")},
			coalesce(d.id, about.deal_id) as deal_id, p.id as party_id, null as step_id,
			coalesce(d.name, ad.name, p.name) as record, null as step, i.table_name, null as action, i.field,
			null as new_value, null as phase, null as owner, null as market
		from imported_change i
		left join deal d on i.table_name = 'deal' and d.id = (i.record ->> 'id')::uuid
		left join lateral (select ab.deal_id, ab.party_id from activity_about ab
			where i.table_name = 'activity' and ab.activity_id = (i.record ->> 'id')::uuid
			order by ab.deal_id nulls last limit 1) about on true
		left join deal ad on ad.id = about.deal_id
		left join party p on d.id is null and about.deal_id is null
			and p.id = coalesce((i.record ->> 'party_id')::uuid, case when i.table_name = 'party'
				then (i.record ->> 'id')::uuid end, about.party_id)
		where (${after}::uuid is null or (i.changed_at, i.id)
				< (select changed_at, id from imported_change where id = ${after}::uuid))
			-- The old system's own automations moved ownership in bulk; that history stays on the deal timeline.
			and i.changed_by_job is distinct from 'old_system'
			and i.table_name || '.' || i.field = any(${sql.val(Object.keys(IMPORTED))}::text[])
			and coalesce(d.id, ad.id, p.id) is not null
		order by i.changed_at desc, i.id desc limit ${PAGE + 1}
	`.execute(db);
	return rows;
}

function parseCursor(before: string | undefined): Cursor | Refusal {
	if (before === undefined) return TOP;
	const [change = "", imported = ""] = before.split("_");
	return /^\d+$/.test(change) && (imported === "top" || isUuid(imported))
		? { change: Number(change), imported: imported === "top" ? null : imported }
		: new Refusal(400, "invalid_field_value", { fields: ["before"] });
}

async function readChanges(db: Transaction<DB>, cursor: Cursor) {
	const native = await readNative(db, cursor.change);
	const imported = await readImported(db, cursor.imported);
	const page = [...native, ...imported]
		.sort((a, b) => Number(BigInt(b.micros) - BigInt(a.micros)))
		.slice(0, PAGE);
	const last = (rows: HistoryRow[]) =>
		rows.findLast((row) => page.includes(row))?.key;
	const next = {
		change: last(native) ?? (native.length ? cursor.change : 0),
		imported:
			last(imported) ?? (imported.length ? (cursor.imported ?? "top") : SPENT),
	};
	return {
		changes: page.map((row) => ({
			id: `${row.source}:${row.key}`,
			changed_at: new Date(row.changed_at).toISOString(),
			who: row.who,
			job: row.job,
			record: row.record,
			what: whatChanged(row),
			open_url: openUrl(row),
		})),
		next_before:
			native.length + imported.length > PAGE
				? `${next.change}_${next.imported}`
				: null,
	};
}

export const changes = new Hono<DatabaseEnv>().get("/updates/changes", (c) => {
	const cursor = parseCursor(c.req.query("before"));
	return answerNextRead(c, "read-changes", (db) =>
		cursor instanceof Refusal
			? Promise.resolve(cursor)
			: readChanges(db, cursor),
	);
});
