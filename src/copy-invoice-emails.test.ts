import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { URL } from "node:url";
import pg from "pg";
import { asAdmin } from "../scripts/test-database.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sql = (file: string) =>
	readFile(new URL(`../schema/${file}`, import.meta.url), "utf8");
const schema = await sql("next.sql");
const attribution = await sql("copy-attribution.sql");
const copy = await sql("copy-invoice-emails.sql");
const name = `copy_invoice_emails_${randomUUID().replaceAll("-", "")}`;
const url = new URL(
	process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1/postgres",
);
url.pathname = `/${name}`;
const db = new pg.Client({
	connectionString: url.href,
	options: "-c search_path=next -c TimeZone=UTC",
});
const rows = async (text: string) => (await db.query(text)).rows;
const run = async (): Promise<pg.QueryResultRow[]> => {
	const result = await db.query(copy);
	assert.ok(Array.isArray(result));
	return result.at(-1)?.rows ?? [];
};
const reasons = (report: pg.QueryResultRow[], n: number) =>
	report.filter((r) => r.old_id === id(n)).map((r) => r.reason);
const snapshot = async () => {
	const saved = [];
	for (const t of [
		"invoice_email",
		"commission_payment",
		"deal_phase_change",
		"change",
	])
		saved.push(await rows(`select * from ${t} order by 1, 2`));
	return saved;
};
let report: pg.QueryResultRow[];
let beforeCopy: pg.QueryResultRow[][];
before(async () => {
	assert.ok(process.env.TEST_SNAPSHOT, "Run npm run check");
	await asAdmin(
		`create database "${name}" template "${process.env.TEST_SNAPSHOT}"`,
	);
	await db.connect();
	await db.query(`create schema next; ${schema}; ${attribution}`);
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into party (id, kind, name) values ('${id(1)}','person','Example User'), ('${id(2)}','person','Example Partner');
 insert into app_user values ('${id(1)}'), ('${id(2)}');
 insert into outside_id (source,value,party_id) values ('old_system','${id(1)}','${id(1)}'), ('old_system','${id(2)}','${id(2)}');
 insert into commission_tier (user_id, from_deal, partner_user_id, closing_share) values ('${id(1)}',1,'${id(2)}',0.6);
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}','partner_one','human','Example User'),
 ('${id(2)}','partner_two','human','Example Partner'), ('${id(3)}','example-mail','automation','Example Mail');
 insert into public.contact_state (slug,label,contactable,sort) values ('active','Active',true,1);
 insert into public.party (id,kind,name,created_by,updated_by) values ('${id(6)}','org','Example Client','${id(1)}','${id(1)}');
 insert into public.client (id,party_id,created_by,updated_by) values ('${id(7)}','${id(6)}','${id(1)}','${id(1)}');
 insert into public.deal_type_ref (slug,label,sort) values ('lease','Lease',1);
 insert into public.deal_phase (slug,label) values ('negotiation','Negotiation'), ('closed','Closed'); commit;`);
	for (let d = 10; d <= 23; d++) {
		const undone = d === 11;
		await db.query(`insert into public.deal (id,client_id,name,deal_type,phase,owner,created_by,updated_by,invoiced_on)
   values ('${id(d)}','${id(7)}','Example deal ${d}','lease','${undone ? "negotiation" : "closed"}','partner_one','${id(1)}','${id(1)}',${undone ? "null" : "'2025-03-01'"});
   insert into public.commission (id,deal_id,status,gross_amount,invoiced_on,received_on,created_by)
   values ('${id(d + 100)}','${id(d)}','received',100,${undone ? "null" : "'2025-03-01'"},'2025-04-01','${id(1)}');
   insert into public.event (id,actor_id,verb,subject_type,subject_id,field,old_value,new_value,cause,occurred_at) values
   ('${id(d + 1000)}','${id(1)}','update-deal','deal','${id(d)}','phase',null,'{"phase":"negotiation"}','human_stated','2025-01-01'),
   ('${id(d + 2000)}','${id(3)}','update-deal','deal','${id(d)}','phase','{"phase":"negotiation"}','{"phase":"closed"}','automation_job','2025-03-02T12:00Z'),
   ('${id(d + 3000)}','${id(3)}','update-deal','deal','${id(d)}','invoiced_on','{"invoiced_on":null}','{"invoiced_on":"2025-03-01"}','ingest_email','2025-03-02T12:00Z');
   update public.event set sponsoring_human_slug = 'partner_one' where id = '${id(d + 3000)}';`);
		if (undone)
			await db.query(`insert into public.event (actor_id,verb,subject_type,subject_id,field,old_value,new_value,cause,occurred_at)
   values ('${id(2)}','update-deal','deal','${id(d)}','phase','{"phase":"closed"}','{"phase":"negotiation"}','human_correction','2025-03-03')`);
	}
	for (const script of ["copy-deals.sql", "copy-commissions.sql"]) {
		await db.query("begin");
		await db.query(await sql(script));
		await db.query("commit");
	}
	for (let n = 200; n <= 214; n++) {
		const d = n - 190;
		const status = n === 202 ? "captured" : n === 201 ? "undone" : "applied";
		await db.query(`insert into public.deal_invoice_email (id,evidence_ref,from_address,deal_name,client_name,property_address,occurred_at,email_date,created_by,
   status,deal_id,prior_phase,phase_event_id,invoice_event_id,applied_at,applied_by,reason,undone_at,undone_by)
   values ('${id(n)}','local-mail:example-${n}','billing@example.test','Example deal ${d}','Example Client','100 Example Street',
   '2025-03-01T23:30:00-05:00','2025-03-01','${id(3)}','${status}',${
			status === "captured"
				? "null,null,null,null,null,null,null,null,null"
				: `'${id(d === 24 ? 23 : d)}','negotiation','${id((d === 24 ? 23 : d) + 2000)}','${id((d === 24 ? 23 : d) + 3000)}','2025-03-02T12:00Z','${id(3)}','Example invoice reason',${status === "undone" ? `'2025-03-03','${id(2)}'` : "null,null"}`
		});
   insert into public.event (actor_id,verb,subject_type,subject_id,new_value,cause,occurred_at,sponsoring_human_slug)
   values ('${id(3)}','record-deal-invoice','deal_invoice_email','${id(n)}',
   '{"evidence_ref":"local-mail:example-${n}","email_date":"2025-03-01"}','ingest_email','2025-03-02T06:00Z','partner_one');`);
	}
	await db.query(`begin; select set_config('engine.job','old_system',true);
 update public.deal_invoice_email set from_address = 'Example <bad@example.test>' where id = '${id(203)}';
 delete from outside_id where source = 'old_system' and value = '${id(14)}';
 delete from commission_payment where id = '${id(115)}'; update commission set gross = null where deal_id = '${id(15)}';
 update public.deal set invoiced_on = '2025-02-01' where id = '${id(16)}';
 update public.event set new_value = '{"invoiced_on":"2025-02-01"}' where id = '${id(3017)}';
 delete from public.event where subject_id = '${id(208)}';
 update public.deal_invoice_email set client_name = ' ' where id = '${id(209)}';
 update public.deal_invoice_email set occurred_at = '2025-01-01' where id = '${id(210)}';
 insert into public.actor (id,slug,kind,display_name) values ('${id(4)}','example-missing','human','Example Missing');
 update public.deal_invoice_email set applied_by = '${id(4)}' where id = '${id(211)}';
 update public.event set actor_id = '${id(4)}' where id = '${id(3021)}';
 insert into public.commission (id,deal_id,status,gross_amount,invoiced_on,received_on,created_by) values ('${id(500)}','${id(22)}','received',100,'2025-03-01','2025-04-01','${id(1)}');
 insert into commission_payment (id,deal_id,amount,invoiced_on) values ('${id(500)}','${id(22)}',100,'2025-03-01');
 update commission set gross = 200 where deal_id = '${id(22)}'; commit;`);
	beforeCopy = await snapshot();
	await db.query("begin");
	report = await run();
	await db.query("commit");
});
after(async () => {
	await db.end();
	await asAdmin(`drop database "${name}" with (force)`);
});

test("captured, applied and undone evidence retain facts, targets and original history without replaying moves", async () => {
	assert.deepEqual(
		await rows(`select i.id from invoice_email n join public.deal_invoice_email i using (id)
 where (n.evidence_ref,n.sender::text,n.deal_name,n.client_name,n.property_address,n.occurred_at,n.email_date,n.status)
 is distinct from (i.evidence_ref,i.from_address,i.deal_name,i.client_name,i.property_address,i.occurred_at,i.email_date,i.status)`),
		[],
	);
	assert.deepEqual(
		(
			await rows(
				"select id,status,deal_id,payment_id from invoice_email order by id",
			)
		).map(Object.values),
		[
			[id(200), "applied", id(10), id(110)],
			[id(201), "undone", id(11), id(111)],
			[id(202), "captured", null, null],
		],
	);
	assert.deepEqual(
		await rows("select distinct created_at::text from invoice_email"),
		[{ created_at: "2025-03-02 06:00:00+00" }],
	);
	assert.deepEqual(
		(
			await rows(`select new_value ->> 'status', changed_at::text, changed_by_job, changed_for_user_id, changed_by_user_id from change
  where table_name = 'invoice_email' and record = '{"id":"${id(201)}"}' order by id`)
		).map(Object.values),
		[
			["captured", "2025-03-02 06:00:00+00", "mail_capture", id(1), null],
			["applied", "2025-03-02 12:00:00+00", "mail_capture", id(1), null],
			["undone", "2025-03-03 00:00:00+00", null, null, id(2)],
		],
	);
	assert.equal(
		(
			await rows(
				`select new_value ->> 'reason' as reason from change where table_name = 'invoice_email' and new_value ->> 'status' = 'applied' limit 1`,
			)
		)[0]?.reason,
		"Example invoice reason",
	);
	const afterCopy = await snapshot();
	assert.deepEqual(afterCopy[1], beforeCopy[1]);
	assert.deepEqual(afterCopy[2], beforeCopy[2]);
	assert.deepEqual(
		(
			await rows(
				`select i.prior_phase_at::text,i.applied_phase_at::text,c.new_value from invoice_email i join change c on c.id=i.payment_change_id where i.id='${id(200)}'`,
			)
		).map(Object.values),
		[
			[
				"2025-01-01 00:00:00+00",
				"2025-03-02 12:00:00+00",
				{ invoiced_on: "2025-03-01" },
			],
		],
	);
});
test("unresolved dates, source, actors, payments and duplicate historical closes are listed", () => {
	for (const [n, reason] of [
		[203, "invalid_sender"],
		[204, "deal_not_copied"],
		[205, "payment_not_identified"],
		[206, "payment_not_identified"],
		[207, "application_evidence_missing"],
		[208, "capture_evidence_missing"],
		[209, "invoice_email_client_name_check"],
		[210, "invoice_email_date_matches_time"],
		[211, "actor_not_copied"],
		[212, "payment_not_identified"],
		[213, "duplicate_application"],
		[214, "duplicate_application"],
	] as const)
		assert.ok(
			reasons(report, n).includes(reason),
			`${n}: ${reason}: ${JSON.stringify(report)}`,
		);
});
test("reruns keep rows, stamps and history unchanged and report source conflicts", async () => {
	const saved = await snapshot();
	await db.query("begin");
	const again = await run();
	await db.query("commit");
	assert.deepEqual(await snapshot(), saved);
	assert.deepEqual(again, report);
	await db.query("begin");
	try {
		await db.query(
			`update public.deal_invoice_email set reason = 'Example correction' where id = '${id(200)}'`,
		);
		assert.ok(
			reasons(await run(), 200).includes("existing_evidence_conflicts"),
		);
		assert.deepEqual(await snapshot(), saved);
	} finally {
		await db.query("rollback");
	}
});
test("imported applied evidence can still be undone by its user and a resend attaches without a second close", async () => {
	await db.query(
		`begin; select set_config('engine.user_id','${id(1)}',true); select set_config('engine.job','',true)`,
	);
	try {
		await db.query(`insert into invoice_email (id,evidence_ref,sender,deal_name,occurred_at,email_date,deal_id,payment_id)
   values ('${id(900)}','local-mail:example-resend','billing@example.test','Example deal 10','2025-03-01','2025-03-01','${id(10)}','${id(110)}');
   update invoice_email set status = 'applied' where id = '${id(900)}';`);
		assert.deepEqual(
			(
				await rows(
					`select status,application_id from invoice_email where id='${id(900)}'`,
				)
			).map(Object.values),
			[["attached", id(200)]],
		);
		await db.query(
			`update invoice_email set status = 'undone' where id='${id(200)}'; set constraints all immediate;`,
		);
		assert.equal(
			(
				await rows(
					`select invoiced_on from commission_payment where id='${id(110)}'`,
				)
			)[0]?.invoiced_on,
			null,
		);
	} finally {
		await db.query("rollback");
	}
});
