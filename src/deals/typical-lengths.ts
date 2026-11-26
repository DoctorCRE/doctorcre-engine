import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { answerNextRead, checkFields, Refusal, refuse } from "../answer.ts";
import type { JsonObject } from "../database.d.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { asText } from "../reader.ts";
import { fit, isChangeId, isText, isUuid } from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";
import { latestChange } from "../seen-change.ts";
import { todosOf } from "./checklist.ts";

// Lease to-dos come from the checklist; move_in sits on its own date, and a deal's phase before
// Research has no checklist row, so it leads the list. The checklist's Invoice phase is the Closed phase.
const LEASE_TODOS = [
	{
		todo: "before_research",
		phase: "pending",
		label: "Before Research begins",
	},
	...todosOf("lease")
		.filter(({ todo }) => todo !== "move_in")
		.map((t) => ({ ...t, phase: t.phase === "invoice" ? "closed" : t.phase })),
];
const TODOS_BY_KIND = new Map([["lease", LEASE_TODOS]]);
const MIN_MEASURED = 5;

const isTodo = (v: unknown): v is string =>
	typeof v === "string" && /^[a-z][a-z0-9_]*$/.test(v);
const isDays = (v: unknown): v is number =>
	typeof v === "number" && Number.isSafeInteger(v) && v >= 1 && v <= 2147483647;
const badField = (field: string) =>
	new Refusal(400, "invalid_field_value", { fields: [field] });
const hasKind = (db: Transaction<DB>, slug: string) =>
	db
		.selectFrom("deal_kind")
		.select("slug")
		.where("slug", "=", slug)
		.executeTakeFirst();

type Measured = {
	todo: string;
	measured_count: number;
	measured_days: number | null;
};

async function readMeasured(db: Transaction<DB>, dealKind: string) {
	// Only to-dos whose own start and finish days are recorded contribute positive examples.
	// Executed lease is unmeasured: Closing begins at signing, so the design gives it no start day.
	const { rows } = await sql<Measured>`
		with spans as (
			select p.deal_id, p.phase,
				case when not (p.changed_by_job is not distinct from 'old_system' and p.happened_at = p.changed_at
					and not exists (select from deal_phase_change prior where prior.deal_id = p.deal_id and prior.happened_at < p.happened_at))
					then (p.happened_at at time zone 'America/Chicago')::date end as from_on,
				(lead(p.happened_at) over (partition by p.deal_id order by p.happened_at) at time zone 'America/Chicago')::date as to_on
			from deal_phase_change p join deal d on d.id = p.deal_id where d.kind = ${dealKind}
		),
		samples as (
			select 'before_research' as todo, (to_on - from_on) as days from spans
			where phase = 'pending' and from_on is not null and to_on > from_on
			union all
			select 'invoice_recorded', (i.invoiced_on - s.from_on) from deal d join deal_invoiced i on i.deal_id = d.id
			join lateral (select max(from_on) as from_on from spans where deal_id = d.id and phase = 'closed' and from_on <= i.invoiced_on) s on s.from_on is not null
			where d.kind = ${dealKind} and i.invoiced_on > s.from_on
			union all
			select 'commission_received', (p.received_on - i.invoiced_on) from deal d join deal_invoiced i on i.deal_id = d.id
			join (select deal_id, max(received_on) as received_on from commission_payment
				group by deal_id having count(*) > 0 and bool_and(received_on is not null)) p on p.deal_id = d.id
			where d.kind = ${dealKind} and p.received_on > i.invoiced_on
		)
		select todo, count(*)::int as measured_count,
			case when count(*) >= ${MIN_MEASURED} then round(percentile_cont(0.5) within group (order by days))::int end as measured_days
		from samples group by todo
	`.execute(db);
	return new Map(rows.map((r) => [r.todo, r]));
}

async function readTypicalLengths(db: Transaction<DB>, dealKind: string) {
	if (!(await hasKind(db, dealKind))) return badField("deal_kind");
	const [rows, measured] = await Promise.all([
		db
			.selectFrom("typical_length as t")
			.leftJoin("app_user as u", "u.id", "t.changed_by_user_id")
			.select((eb) => [
				"t.todo",
				"t.days",
				"u.slug as changed_by",
				asText(eb.ref("t.changed_at")).$notNull().as("changed_at"),
				sql<string>`coalesce((select max(c.id) from change c where c.table_name = 'typical_length'
					and c.record = jsonb_build_object('deal_kind', t.deal_kind, 'todo', t.todo)), 0)`.as(
					"base_version",
				),
			])
			.where("t.deal_kind", "=", dealKind)
			.execute(),
		readMeasured(db, dealKind),
	]);
	const meta = new Map(
		(TODOS_BY_KIND.get(dealKind) ?? []).map(({ todo, phase, label }, order) => [
			todo,
			{ phase, label, order },
		]),
	);
	const items = rows
		.sort(
			(a, b) =>
				(meta.get(a.todo)?.order ?? Number.MAX_SAFE_INTEGER) -
					(meta.get(b.todo)?.order ?? Number.MAX_SAFE_INTEGER) ||
				a.todo.localeCompare(b.todo),
		)
		.map((r) => ({
			phase: meta.get(r.todo)?.phase ?? null,
			todo: r.todo,
			label: meta.get(r.todo)?.label ?? r.todo,
			days: r.days,
			changed_by: r.changed_by,
			changed_at: r.changed_at,
			base_version: Number(r.base_version),
			measured_days: measured.get(r.todo)?.measured_days ?? null,
			measured_count: measured.get(r.todo)?.measured_count ?? 0,
		}));
	return { deal_kind: dealKind, items };
}

const parseSave = (body: JsonObject) =>
	fit(
		body,
		{
			idempotency_key: isUuid,
			deal_kind: isText,
			todo: isTodo,
			days: isDays,
			base_version: isChangeId,
		},
		["idempotency_key", "deal_kind", "todo", "days", "base_version"],
	);

type SaveRequest = Exclude<ReturnType<typeof parseSave>, Refusal>;
type SavedRow = { days: number; changed_by: string | null; changed_at: string };

async function saveTypicalLength(
	tx: Transaction<DB>,
	{ deal_kind, todo, days, base_version }: SaveRequest,
) {
	if (!(await hasKind(tx, deal_kind)))
		throw new SaveRefusal(badField("deal_kind"));
	// A row not yet seeded has no row to lock.
	await sql`select pg_advisory_xact_lock(hashtextextended(${`typical_length:${deal_kind}:${todo}`}, 0))`.execute(
		tx,
	);
	const known =
		TODOS_BY_KIND.get(deal_kind)?.some((t) => t.todo === todo) ?? false;
	if (!known) {
		const existing = await tx
			.selectFrom("typical_length")
			.select("todo")
			.where("deal_kind", "=", deal_kind)
			.where("todo", "=", todo)
			.executeTakeFirst();
		if (!existing) throw new SaveRefusal(badField("todo"));
	}
	const key = { deal_kind, todo };
	const current_version = (await latestChange(tx, "typical_length", key)) ?? 0;
	if (base_version !== current_version)
		throw new SaveRefusal(
			new Refusal(409, "version_conflict", { current_version }),
		);
	const {
		rows: [saved],
	} = await sql<SavedRow>`
		insert into typical_length (deal_kind, todo, days) values (${deal_kind}, ${todo}, ${days})
		on conflict (deal_kind, todo) do update set days = excluded.days
		returning days, (select slug from app_user where id = changed_by_user_id) as changed_by,
			to_jsonb(changed_at)#>>'{}' as changed_at
	`.execute(tx);
	if (!saved) throw new Error("Saved typical length was unavailable");
	return {
		deal_kind,
		todo,
		...saved,
		base_version: (await latestChange(tx, "typical_length", key)) ?? 0,
	};
}

export const typicalLengths = new Hono<NextSaveEnv>()
	.get("/typical-lengths", async (c): Promise<Response> => {
		const params = new URL(c.req.url).searchParams;
		const refused = checkFields(params, ["deal_kind"]);
		if (refused) return refuse(c, refused);
		const values = params.getAll("deal_kind");
		if (values.length > 1 || (values[0] !== undefined && !values[0].trim()))
			return refuse(c, badField("deal_kind"));
		return answerNextRead(c, "read-typical-lengths", (db) =>
			readTypicalLengths(db, values[0] ?? "lease"),
		);
	})
	.post("/typical-lengths", (c) =>
		answerNextSave(c, "save-typical-length", parseSave, saveTypicalLength),
	);
