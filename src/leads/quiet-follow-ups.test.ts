import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { sql, type Transaction } from "kysely";
import type { DB } from "../next-database.d.ts";
import { connect } from "../reader.ts";
import { copyTest } from "../test-copy.ts";
import { readQuietFollowUps } from "./quiet-follow-ups.ts";

const uuid = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DEFAULT = { lead_days: 45, vendor_days: 90 };

type Reader = Transaction<DB>;
const copy = copyTest();
const db = connect<DB>(copy.connectionString);
const today = sql`(now() at time zone 'America/Chicago')::date`;

before(copy.setup);
after(async () => {
	await db.destroy();
	await copy.cleanup();
});

async function withRollback(run: (tx: Reader) => Promise<void>) {
	const tx = await db.startTransaction().execute();
	try {
		await sql`set local search_path = next; set local time zone 'UTC'`.execute(
			tx,
		);
		await run(tx);
	} finally {
		await tx.rollback().execute();
	}
}

async function seed(tx: Reader) {
	await sql`select set_config('engine.job', 'old_system', true)`.execute(tx);
	await sql`with partners as (
			insert into party (id, kind, name) values
				(${uuid(1)}, 'person', 'Example Partner'),
				(${uuid(2)}, 'person', 'Example Other Partner') returning id
		)
		insert into app_user (id, slug)
			select id, case when id = ${uuid(1)} then 'joe' else 'dell' end from partners`.execute(
		tx,
	);
	await sql`insert into how_found (slug, label) values ('referral', 'Referral');
		insert into role (slug, label) values ('lead', 'Lead'), ('vendor', 'Vendor'), ('client', 'Client');
		insert into stage (role, slug, label) values ('lead', 'new', 'New'),
			('lead', 'qualified', 'Qualified'), ('lead', 'outreach_active', 'Outreach'),
			('lead', 'engaged', 'Engaged'), ('lead', 'nurture', 'Nurture'),
			('lead', 'opportunity', 'Opportunity');`.execute(tx);
	await sql`select set_config('engine.job', '', true), set_config('engine.user_id', ${uuid(1)}, true)`.execute(
		tx,
	);
}

const party = (tx: Reader, n: number) =>
	sql`insert into party (id, kind, name, how_found)
		values (${uuid(n)}, 'person', ${`Example Person ${n}`}, 'referral')`.execute(
		tx,
	);

type Subject = { owner?: number; created_at?: string };
type Lead = Subject & { stage?: string; restricted?: boolean; client?: number };

async function lead(tx: Reader, n: number, l: Lead = {}) {
	await party(tx, n);
	await sql`insert into party_role (party_id, role, stage, owner_user_id, created_at)
		values (${uuid(n)}, 'lead', ${l.stage ?? "new"}, ${l.owner ? uuid(l.owner) : null}::uuid,
			${l.created_at ?? "2020-01-01 12:00:00+00"})`.execute(tx);
	await sql`insert into outside_id (source, value, party_id)
		values ('old_system_ref', ${`L-${n}`}, ${uuid(n)})`.execute(tx);
	if (l.restricted)
		await sql`insert into do_not_contact (party_id, reason) values (${uuid(n)}, 'Example request')`.execute(
			tx,
		);
	if (l.client) {
		await sql`update party set name = (select name from party where id = ${uuid(l.client)}) where id = ${uuid(n)}`.execute(
			tx,
		);
		await sql`update party_role set lead_client_id = ${uuid(l.client)} where party_id = ${uuid(n)}`.execute(
			tx,
		);
	}
}

type Vendor = Subject & { disposition?: "parked" | "avoid" };
async function vendor(tx: Reader, n: number, v: Vendor = {}) {
	await party(tx, n);
	await sql`insert into party_role (party_id, role, disposition, disposition_reason, owner_user_id, created_at)
		values (${uuid(n)}, 'vendor', ${v.disposition ?? null}, ${v.disposition ? "Example ruling" : null},
			${v.owner ? uuid(v.owner) : null}::uuid, ${v.created_at ?? "2020-01-01 12:00:00+00"})`.execute(
		tx,
	);
	await sql`insert into outside_id (source, value, party_id)
		values ('old_system_ref', ${`V-${n}`}, ${uuid(n)})`.execute(tx);
}

async function client(tx: Reader, n: number, status: string) {
	await party(tx, n);
	await sql`with role as (insert into party_role (party_id, role) values (${uuid(n)}, 'client'))
		insert into client (party_id, status) values (${uuid(n)}, ${status})`.execute(
		tx,
	);
}

const nextAction = (
	tx: Reader,
	subject: number,
	resolution?: "done" | "expired",
) =>
	sql`insert into next_step (party_id, what, resolution)
		values (${uuid(subject)}, 'Example step', ${resolution ?? null})`.execute(
		tx,
	);

const touch = (tx: Reader, n: number, at: string, kind = "call") =>
	sql`with contact as (insert into activity (kind, happened_at, summary) values
		(${kind}, ${at}, 'Example touch') returning id)
		insert into activity_about (activity_id, party_id) select id, ${uuid(n)} from contact`.execute(
		tx,
	);

async function read(
	tx: Reader,
	cadence = DEFAULT,
	owner: string | null = null,
) {
	const quiet = await readQuietFollowUps(tx, cadence, owner);
	assert.ok(!("error" in quiet), JSON.stringify(quiet));
	return quiet;
}
const ids = async (
	tx: Reader,
	cadence = DEFAULT,
	owner: string | null = null,
) => (await read(tx, cadence, owner)).proposals.map((p) => p.subject_id);
const daysSince = async (tx: Reader, date: string) =>
	(
		await sql<{
			n: number;
		}>`select ${today} - ${date}::date as n`.execute(tx)
	).rows[0]?.n;

test("an answer has the old keys, key order, nulls and formats", () =>
	withRollback(async (tx) => {
		await seed(tx);
		await lead(tx, 10, {
			owner: 1,
			created_at: "2019-05-05 12:00:00+00",
		});
		await touch(tx, 10, "2026-01-02T12:00:00Z");
		await vendor(tx, 20);
		const quiet = await read(tx);
		const expected = {
			schema_version: "quiet-follow-ups.v1",
			cadence: { lead_days: 45, vendor_days: 90 },
			proposals: [
				{
					subject_type: "vendor",
					subject_id: uuid(20),
					party_id: uuid(20),
					ref: "V-20",
					name: "Example Person 20",
					owner_id: null,
					anchor_on: "2020-01-01",
					basis: "created_at",
					last_contact_on: null,
					next_action_date: null,
					client_id: null,
					interval_days: 90,
					due_on: "2020-03-31",
					owner: null,
					days_overdue: await daysSince(tx, "2020-03-31"),
				},
				{
					subject_type: "lead",
					subject_id: uuid(10),
					party_id: uuid(10),
					ref: "L-10",
					name: "Example Person 10",
					owner_id: uuid(1),
					anchor_on: "2026-01-02",
					basis: "last_contact",
					last_contact_on: "2026-01-02",
					next_action_date: null,
					client_id: null,
					interval_days: 45,
					due_on: "2026-02-16",
					owner: "joe",
					days_overdue: await daysSince(tx, "2026-02-16"),
				},
			],
			sent: false,
			tasks_created: false,
		};
		assert.equal(JSON.stringify(quiet), JSON.stringify(expected));
	}));

test("leads count only in open stages when contact is allowed", () =>
	withRollback(async (tx) => {
		await seed(tx);
		const open = ["new", "qualified", "outreach_active", "engaged", "nurture"];
		for (const [i, stage] of open.entries()) await lead(tx, 10 + i, { stage });
		await lead(tx, 30, { stage: "opportunity" });
		await lead(tx, 31, { restricted: true });
		assert.deepEqual(await ids(tx), [10, 11, 12, 13, 14].map(uuid));
	}));

test("vendors count only when live and active, on their own cadence", () =>
	withRollback(async (tx) => {
		await seed(tx);
		await vendor(tx, 10, { created_at: "2026-01-01 12:00:00+00" });
		await vendor(tx, 11, { disposition: "parked" });
		await vendor(tx, 12, { disposition: "avoid" });
		const quiet = await read(tx, { lead_days: 45, vendor_days: 7 });
		assert.deepEqual(
			quiet.proposals.map((p) => [p.subject_id, p.interval_days, p.due_on]),
			[[uuid(10), 7, "2026-01-08"]],
		);
	}));

test("a lead linked to a cold or paused client is left out", () =>
	withRollback(async (tx) => {
		await seed(tx);
		await client(tx, 1000, "engaged");
		await client(tx, 1001, "roster");
		await client(tx, 1002, "cold");
		await client(tx, 1003, "paused");
		for (const n of [0, 1, 2, 3]) await lead(tx, 10 + n, { client: 1000 + n });
		const quiet = await read(tx);
		assert.deepEqual(
			quiet.proposals.map((p) => [p.subject_id, p.client_id]),
			[
				[uuid(10), uuid(1000)],
				[uuid(11), uuid(1001)],
			],
		);
	}));

test("an open next action on the record or its client leaves it out", () =>
	withRollback(async (tx) => {
		await seed(tx);
		await client(tx, 1000, "engaged");
		await lead(tx, 10);
		await lead(tx, 11);
		await lead(tx, 12, { client: 1000 });
		await vendor(tx, 13);
		await vendor(tx, 14);
		await nextAction(tx, 11);
		await nextAction(tx, 1000);
		await nextAction(tx, 14);
		await nextAction(tx, 10, "done");
		await nextAction(tx, 13, "expired");
		assert.deepEqual(await ids(tx), [10, 13].map(uuid));
	}));

test("contact and creation dates use America/Chicago days", () =>
	withRollback(async (tx) => {
		await seed(tx);
		// 03:00 UTC is still the day before in Chicago.
		await lead(tx, 10, { created_at: "2026-01-10 03:00:00+00" });
		await lead(tx, 11);
		await touch(tx, 11, "2026-01-05 03:00:00+00");
		await touch(tx, 11, "2026-01-07 03:00:00+00", "note");
		await lead(tx, 12);
		await touch(tx, 12, "2026-01-05 03:00:00+00");
		await touch(tx, 12, "2026-01-20 12:00:00+00");
		await vendor(tx, 13);
		await touch(tx, 13, "2026-02-01 05:59:00+00");
		const quiet = await read(tx, { lead_days: 1, vendor_days: 1 });
		assert.deepEqual(
			quiet.proposals.map((p) => [
				p.subject_id,
				p.basis,
				p.anchor_on,
				p.due_on,
			]),
			[
				[uuid(11), "last_contact", "2026-01-04", "2026-01-05"],
				[uuid(10), "created_at", "2026-01-09", "2026-01-10"],
				[uuid(12), "last_contact", "2026-01-20", "2026-01-21"],
				[uuid(13), "last_contact", "2026-01-31", "2026-02-01"],
			],
		);
	}));

test("rows sort by due day, then kind, then id, and filter by owner", () =>
	withRollback(async (tx) => {
		await seed(tx);
		await vendor(tx, 10, { owner: 2 });
		await lead(tx, 12, { owner: 1 });
		await lead(tx, 11);
		await lead(tx, 13, { owner: 2, created_at: "2019-01-01 12:00:00+00" });
		// The vendor falls due the same day as leads 11 and 12 and sorts after them.
		const even = { lead_days: 45, vendor_days: 45 };
		assert.deepEqual(await ids(tx, even), [13, 11, 12, 10].map(uuid));
		assert.deepEqual(await ids(tx, even, "dell"), [13, 10].map(uuid));
		assert.deepEqual(await ids(tx, even, "nobody"), []);
	}));

test("more than 1000 due rows refuse the whole list", () =>
	withRollback(async (tx) => {
		await seed(tx);
		const many = (from: number, to: number) => [
			sql`insert into party (id, kind, name, how_found)
				select ('00000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid, 'person',
				'Example', 'referral' from generate_series(${from}::int, ${to}::int) g`,
			sql`insert into party_role (party_id, role, stage, created_at)
				select ('00000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid, 'lead',
				'new', '2020-01-01' from generate_series(${from}::int, ${to}::int) g`,
		];
		for (const statement of many(1, 1000)) await statement.execute(tx);
		assert.equal((await read(tx)).proposals.length, 1000);
		for (const statement of many(1001, 1001)) await statement.execute(tx);
		assert.deepEqual(await readQuietFollowUps(tx, DEFAULT, null), {
			error: "limit_exceeded",
		});
	}));
