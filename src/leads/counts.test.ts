import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { sql, type Transaction } from "kysely";
import type { DB } from "../next-database.d.ts";
import { connect } from "../reader.ts";
import { copyTest } from "../test-copy.ts";
import { readLeadCounts } from "./counts.ts";

const uuid = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Reader = Transaction<DB>;
const copy = copyTest();
const db = connect<DB>(copy.connectionString);

before(copy.setup);
after(async () => {
	await db.destroy();
	await copy.cleanup();
});

async function withRollback(run: (tx: Reader) => Promise<void>) {
	const tx = await db.startTransaction().execute();
	try {
		await sql`set local search_path = next`.execute(tx);
		await run(tx);
	} finally {
		await tx.rollback().execute();
	}
}

async function seed(tx: Reader) {
	await sql`select set_config('engine.job', 'old_system', true)`.execute(tx);
	await sql`with partner as (insert into party (id, kind, name)
			values (${uuid(1)}, 'person', 'Example Partner') returning id)
		insert into app_user (id, slug) select id, 'joe' from partner`.execute(tx);
	await sql`insert into how_found (slug, label) values ('referral', 'Referral');
		insert into role (slug, label) values ('lead', 'Lead'), ('vendor', 'Vendor'),
			('client', 'Client'), ('client_contact', 'Client contact');
		insert into stage (role, slug, label) values ('lead', 'new', 'New'),
			('lead', 'nurture', 'Nurture'), ('lead', 'archived', 'Archived');
		-- These rows stand in for mail intake and an evidenced archive.
		alter table lead_email_attention disable trigger lead_email_attention_change;
		alter table party_role disable trigger lead_stage_needs_evidence`.execute(
		tx,
	);
	await sql`select set_config('engine.job', '', true), set_config('engine.user_id', ${uuid(1)}, true)`.execute(
		tx,
	);
}

type Lead = {
	stage?: string;
	quiet?: boolean;
	attention?: "pending" | "acknowledged";
	restricted?: boolean;
	client?: "itself" | "linked" | "deal";
};

const party = (tx: Reader, n: number) =>
	sql`insert into party (id, kind, name, how_found)
		values (${uuid(n)}, 'person', ${`Example Person ${n}`}, 'referral')`.execute(
		tx,
	);

async function client(tx: Reader, n: number) {
	await sql`with role as (insert into party_role (party_id, role) values (${uuid(n)}, 'client'))
		insert into client (party_id, status) values (${uuid(n)}, 'engaged')`.execute(
		tx,
	);
}

// A quiet lead was added long ago and never contacted; any other was added now.
async function lead(tx: Reader, n: number, l: Lead = {}) {
	await party(tx, n);
	await sql`insert into party_role (party_id, role, stage, created_at)
		values (${uuid(n)}, 'lead', ${l.stage ?? "new"},
			${l.quiet ? sql`'2020-01-01'::timestamptz` : sql`now()`})`.execute(tx);
	if (l.attention)
		await sql`insert into lead_email_attention (party_id, activity_id, acknowledged_by_user_id, acknowledged_at)
			values (${uuid(n)}, ${uuid(n + 1000)},
				${l.attention === "acknowledged" ? uuid(1) : null}::uuid,
				${l.attention === "acknowledged" ? sql`now()` : sql`null`})`.execute(
			tx,
		);
	if (l.restricted)
		await sql`insert into do_not_contact (party_id, reason) values (${uuid(n)}, 'Example request')`.execute(
			tx,
		);
	if (l.client === "itself") await client(tx, n);
	if (l.client === "linked") {
		await party(tx, n + 500);
		await client(tx, n + 500);
		await sql`update party set name = ${`Example Person ${n + 500}`} where id = ${uuid(n)}`.execute(
			tx,
		);
		await sql`update party_role set lead_client_id = ${uuid(n + 500)}
			where party_id = ${uuid(n)} and role = 'lead'`.execute(tx);
	}
	if (l.client === "deal")
		await sql`with added as (insert into deal (name, owner_user_id) values ('Example Deal', ${uuid(1)}) returning id)
			insert into deal_party (deal_id, party_id, role) select id, ${uuid(n)}, 'client_contact' from added`.execute(
			tx,
		);
}

test("counts only leads the board shows unfiltered: pending email attention, and a lead's quiet follow-up past its due day", () =>
	withRollback(async (tx) => {
		await seed(tx);
		await lead(tx, 10, { attention: "pending" });
		await lead(tx, 11, { attention: "pending", stage: "nurture" });
		await lead(tx, 12, { attention: "acknowledged" });
		await lead(tx, 13, { attention: "pending", stage: "archived" });
		await lead(tx, 14, { attention: "pending", restricted: true });
		await lead(tx, 15, { attention: "pending", client: "itself" });
		await lead(tx, 16, { attention: "pending", client: "linked" });
		await lead(tx, 17, { attention: "pending", client: "deal" });
		await lead(tx, 20, { quiet: true });
		await lead(tx, 21, { quiet: true, stage: "nurture" });
		await lead(tx, 22, { quiet: true, client: "linked" });
		await lead(tx, 23, { quiet: true, client: "deal" });
		await lead(tx, 24);
		await party(tx, 30);
		await sql`insert into party_role (party_id, role, created_at)
			values (${uuid(30)}, 'vendor', '2020-01-01')`.execute(tx);
		assert.deepEqual(await readLeadCounts(tx), {
			schema_version: "lead-counts.v1",
			new_from_email: 2,
			follow_ups_late: 2,
		});
	}));

test("a quiet lead due today is not late yet", () =>
	withRollback(async (tx) => {
		await seed(tx);
		await lead(tx, 10);
		await sql`with contact as (insert into activity (kind, happened_at, summary)
				values ('call', now() - interval '45 days', 'Example touch') returning id)
			insert into activity_about (activity_id, party_id) select id, ${uuid(10)} from contact`.execute(
			tx,
		);
		assert.equal((await readLeadCounts(tx)).follow_ups_late, 0);
		await sql`update activity set happened_at = now() - interval '46 days'`.execute(
			tx,
		);
		assert.equal((await readLeadCounts(tx)).follow_ups_late, 1);
	}));
