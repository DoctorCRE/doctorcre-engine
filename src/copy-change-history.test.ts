import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type pg from "pg";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [copy, vendors] = await Promise.all([
	readSchema("copy-change-history.sql"),
	readSchema("copy-vendors.sql"),
]);
const { db, setup, cleanup } = copyTest();
const rows = async (sql: string) => (await db.query(sql)).rows;
const run = async (): Promise<pg.QueryResultRow[]> => {
	await db.query("begin");
	try {
		const result = await db.query(copy);
		assert.ok(Array.isArray(result));
		await db.query("commit");
		return result.at(-1)?.rows ?? [];
	} catch (error) {
		await db.query("rollback");
		throw error;
	}
};
const event = async (
	n: number,
	subject: string,
	subjectId: number,
	field: string | null,
	actor = 1,
	sponsor: string | null = null,
) => {
	await db.query(
		`insert into public.event (id, actor_id, verb, subject_type, subject_id, field, old_value, new_value,
 cause, occurred_at, recorded_at, sponsoring_human_slug) values ($1,$2,'example-edit',$3,$4,$5,$6,$7,
 'human_correction','2024-01-01','2024-01-02',$8)`,
		[
			id(n),
			id(actor),
			subject,
			id(subjectId),
			field,
			{ [field ?? "creation"]: "Example old" },
			{ [field ?? "creation"]: null },
			sponsor,
		],
	);
};
const snapshot = () =>
	rows(`select jsonb_agg(x order by x::text) as snapshot from (
 select jsonb_build_object('table',t,'rows',jsonb_agg(v order by v::text)) x from (
 select 'party' t, to_jsonb(p) v from party p union all select 'deal',to_jsonb(d) from deal d
 union all select 'role',to_jsonb(r) from party_role r union all select 'client',to_jsonb(c) from client c
 union all select 'change',to_jsonb(c) from change c) v group by t) s`);

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job','old_system',true);
 alter table public.event drop constraint event_sponsoring_human_slug_check;
 insert into public.actor (id,slug,kind,display_name) values
 ('${id(1)}','partner_one','human','Example User'), ('${id(2)}','codex','automation','Example Agent'),
 ('${id(3)}','example-system','system','Example System'), ('${id(4)}','partner_two','human','Example Other User'),
 ('${id(5)}','example-mail','automation','Example Mail');
 insert into public.contact_state (slug,label,contactable,sort) values ('active','Example active',true,10);
 insert into how_found values ('referral','Referral');
 insert into party (id,kind,name,how_found) values ('${id(1)}','person','Example User',null),
 ('${id(10)}','person','Example Party','referral');
 insert into app_user (id, slug) values ('${id(1)}', 'user-${id(1)}');
 insert into role (slug,label) values ('lead','Lead'),('client','Client'),('vendor','Vendor');
 insert into stage values ('lead','new','New');
 insert into party_role (party_id,role,stage) values ('${id(10)}','lead','new'),('${id(10)}','client',null),('${id(10)}','vendor',null);
 insert into client (party_id) values ('${id(10)}');
 insert into deal (id,name,owner_user_id) values ('${id(20)}','Example Deal','${id(1)}');
 insert into outside_id (source,value,party_id) select 'old_system',v,'${id(10)}'
 from unnest(array['${id(10)}','${id(11)}','${id(12)}','${id(13)}','${id(14)}']) v;
 insert into outside_id (source,value,deal_id) values ('old_system','${id(20)}','${id(20)}');
 commit;`);
});
beforeEach(async () => {
	await db.query(`begin; select set_config('engine.job','old_system',true); delete from imported_change; delete from imported_deal_history; delete from public.event; delete from public.record_source;
 delete from outside_id where source = 'old_system' and value = '${id(99)}';
 insert into party_role (party_id,role) values ('${id(10)}','vendor') on conflict do nothing; commit`);
});
const baseline = async () => {
	await event(100, "party", 11, "name");
	await run();
};
after(cleanup);

test("imports a unique deal note event and lists ambiguous and unmatched events on every copy", async () => {
	const copyActivity = await readSchema("copy-activity.sql");
	await db.query(`begin;
 insert into public.party (id, kind, name, created_by, updated_by)
 values ('${id(10)}', 'person', 'Example Client', '${id(1)}', '${id(1)}');
 insert into public.client (id, party_id, created_by, updated_by)
 values ('${id(10)}', '${id(10)}', '${id(1)}', '${id(1)}');
 insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Example lease', 1);
 insert into public.deal_phase (slug, label) values ('touring', 'Example touring');
 insert into public.deal (id, client_id, name, deal_type, phase, created_by, updated_by)
 values ('${id(20)}', '${id(10)}', 'Example Deal', 'lease', 'touring', '${id(1)}', '${id(1)}');
 insert into public.deal_note (id, deal_id, kind, text, actor_id, created_at)
 select note_id, '${id(20)}', 'note', note, '${id(1)}', '2024-01-01' from (values
 ('${id(30)}'::uuid, 'Example repeated'), ('${id(31)}', 'Example repeated'),
 ('${id(32)}', 'Example unique')) n(note_id, note);
 insert into public.event (id, actor_id, verb, subject_type, subject_id, field, new_value, cause, occurred_at, recorded_at)
 select event_id, '${id(1)}', 'add-deal-note', 'deal', '${id(20)}', 'note',
 jsonb_build_object('note', note), 'human_stated', '2024-01-01', '2024-01-02' from (values
 ('${id(33)}'::uuid, 'Example repeated'), ('${id(34)}', 'Example missing'),
 ('${id(35)}', 'Example unique')) e(event_id, note);
 ${copyActivity} commit;`);
	assert.deepEqual(
		await rows(
			`select count(*)::int as count from activity_about where deal_id = '${id(20)}'`,
		),
		[{ count: 3 }],
	);
	const listed = [
		{ old_id: id(33), field: "note", reason: "note_not_matched" },
		{ old_id: id(34), field: "note", reason: "note_not_matched" },
	];
	const imported = () =>
		rows("select id, record from imported_change order by id");
	assert.deepEqual(await imported(), []);
	const first = await run();
	assert.deepEqual(await imported(), [{ id: id(35), record: { id: id(32) } }]);
	assert.deepEqual(first, listed);
	assert.deepEqual(await run(), listed);
	assert.deepEqual(await imported(), [{ id: id(35), record: { id: id(32) } }]);
});

test("deal history keeps business text on each side of an event", async () => {
	const header = "imported 'Example key' from panhandle-team-deals.json";
	const decision = "Landlord extended the deadline to May 1.";
	const mixed = {
		source: "CARR recorded landlord approval at https://example.test",
	};
	const urlFirst = { source: "https://example.test Landlord confirmed access" };
	const confirmed = { source: "Partner confirmed access on April 1" };
	const reason = { phase: "pending", deal_type: "relocation" };
	await db.query(
		"insert into public.record_source (entity_type, entity_id, source_system, external_key) values ('deal', $1, 'panhandle-team-deals', 'Example key')",
		[id(20)],
	);
	// biome-ignore format: each row pairs an event with its expected display.
	const events = [
		["new-deal", null, null, { ...reason, salesforce_id: "EXAMPLE-42" }, null, reason, "salesforce_id"],
		["record-finding", "discrepancy", null, { found: false, source: "~/example.txt" }, null, { found: false }, "source"],
		["record-finding", "verified", mixed, urlFirst, mixed, urlFirst, null],
		["record-finding", "verified", confirmed, { source: "https://example.test" }, confirmed, null, "source"],
		["import", null, null, { summary: header }, null, null, "technical_deal_history"],
		["import", null, null, { summary: `${header}; ${decision}` }, null, { summary: decision }, "summary"],
		["import", null, null, { summary: `${header} (${decision})` }, null, { summary: `${header} (${decision})` }, null],
		["import", null, null, { summary: `${header}\n${decision}` }, null, { summary: decision }, "summary"],
		["update-deal", "salesforce_id", null, { salesforce_id: "EXAMPLE-42" }, null, null, "technical_deal_history"],
		["update-deal", "notes_path", null, { notes_path: "/example/deal.md" }, null, null, "technical_deal_history"],
		["set-next-action", "next_date", { next_date: null }, { next_date: null }, null, null, "empty_deal_history"],
		["set-next-action", "next_date", { next_date: "2025-02-01" }, { next_date: null }, { next_date: "2025-02-01" }, { next_date: null }, null],
	] as const;
	const expectedHistory = [];
	const expectedReport = [];
	for (const [
		index,
		[verb, field, before, after, shownBefore, shownAfter, omission],
	] of events.entries()) {
		const eventId = id(60 + index);
		await db.query(
			"insert into public.event (id, actor_id, subject_type, subject_id, verb, field, old_value, new_value, cause, occurred_at) values ($1, $2, 'deal', $3, $4, $5, $6, $7, 'human_stated', '2025-04-01')",
			[eventId, id(1), id(20), verb, field, before, after],
		);
		if (shownBefore || shownAfter) {
			expectedHistory.push({
				id: eventId,
				before: shownBefore,
				after: shownAfter,
			});
			if (omission)
				expectedReport.push({
					old_id: eventId,
					field: omission,
					reason: "technical_deal_history_field",
				});
		} else {
			expectedReport.push({ old_id: eventId, field, reason: omission });
		}
	}
	for (const _ of [1, 2]) {
		assert.deepEqual(
			(await run()).filter(({ reason }) =>
				/^(technical|empty)_deal_history/.test(reason),
			),
			expectedReport,
		);
		assert.deepEqual(
			(
				await db.query(
					"select event->>'id' as id, event->'old_value' as before, event->'new_value' as after from deal_imported_history cross join jsonb_array_elements(events) event where deal_id = $1 order by 1",
					[id(20)],
				)
			).rows,
			expectedHistory,
		);
	}
});

test("deal owner history credits the move when the event records automation", async () => {
	for (const [n, cause] of [
		[70, "automation_job"],
		[71, "human_stated"],
	] as const) {
		await db.query(
			"insert into public.event (id, actor_id, subject_type, subject_id, verb, field, new_value, cause, occurred_at) values ($1, $2, 'deal', $3, 'set-lead', 'owner', $4, $5, '2025-04-01')",
			[id(n), id(1), id(20), { owner: "partner_two" }, cause],
		);
	}
	await db.query(
		"insert into public.event (id, actor_id, subject_type, subject_id, verb, new_value, cause, occurred_at) values ($1, $2, 'deal', $3, 'set-lead', $4, 'automation_job', '2025-04-01')",
		[id(72), id(2), id(20), { lead: "partner_two" }],
	);
	const copied = () =>
		rows(
			"select id, changed_by_user_id, changed_by_job, source_event->>'actor_id' as source_actor from imported_change order by id",
		);
	const expected = [
		{
			id: id(70),
			changed_by_user_id: null,
			changed_by_job: "old_system",
			source_actor: id(1),
		},
		{
			id: id(71),
			changed_by_user_id: id(1),
			changed_by_job: null,
			source_actor: id(1),
		},
	];
	for (const _ of [1, 2]) {
		assert.deepEqual(await run(), []);
		assert.deepEqual(await copied(), expected);
		assert.deepEqual(
			await rows(
				"select source_actor_id, changed_by_job from imported_deal_history",
			),
			[{ source_actor_id: id(2), changed_by_job: "old_system" }],
		);
	}
});

test("copies field evidence for every supported record kind without replay or invented snapshots", async () => {
	const cases: [string, number, string, string, object, string][] = [
		["party", 11, "name", "party", { id: id(10) }, "name"],
		["deal", 20, "owner", "deal", { id: id(20) }, "owner_user_id"],
		[
			"lead",
			12,
			"stage",
			"party_role",
			{ party_id: id(10), role: "lead" },
			"stage",
		],
		["client", 13, "status", "client", { party_id: id(10) }, "status"],
		[
			"vendor",
			14,
			"offers",
			"party_role",
			{ party_id: id(10), role: "vendor" },
			"offers",
		],
	];
	for (const [i, c] of cases.entries())
		await event(
			100 + i,
			c[0],
			c[1],
			c[2],
			i === 2 ? 2 : 1,
			i === 2 ? "partner_one" : null,
		);
	await event(106, "party", 10, "npi", 3);
	await db.query(
		`update public.event set old_value = null, new_value = 'null'::jsonb where id = '${id(106)}'`,
	);
	await event(107, "party", 10, "name", 2);
	await event(108, "party", 10, "name", 5, "partner_one");
	await event(109, "party", 10, "name", 1, "missing");
	await db.query(
		`update public.event set cause = 'ingest_email' where id = '${id(108)}'`,
	);
	const before = await snapshot();
	assert.deepEqual(await run(), [
		{ old_id: id(107), field: "name", reason: "agent_user_unknown" },
	]);
	assert.deepEqual(await snapshot(), before);
	for (const [i, c] of cases.entries()) {
		const [actual] =
			await rows(`select table_name,record,field,source_event = (select to_jsonb(e) from public.event e
   where e.id = i.id) as exact, changed_at::text,changed_by_user_id,changed_by_job,changed_for_user_id
   from imported_change i where id = '${id(100 + i)}'`);
		assert.deepEqual(actual, {
			table_name: c[3],
			record: c[4],
			field: c[5],
			exact: true,
			changed_at: "2024-01-01 00:00:00+00",
			changed_by_user_id: i === 2 ? null : id(1),
			changed_by_job: i === 2 ? "agent" : null,
			changed_for_user_id: i === 2 ? id(1) : null,
		});
	}
	assert.deepEqual(
		(
			await rows(`select changed_by_user_id,changed_by_job,changed_for_user_id from imported_change
  where id in ('${id(106)}','${id(107)}','${id(108)}') order by id`)
		).map(Object.values),
		[
			[null, "old_system", null],
			[null, "agent", null],
			[null, "mail_capture", id(1)],
		],
	);
	assert.deepEqual(
		await rows(
			`select old_value_absent, new_value_absent from imported_change where id = '${id(106)}'`,
		),
		[{ old_value_absent: true, new_value_absent: false }],
	);
	assert.equal(
		(
			await rows(
				`select changed_by_user_id from imported_change where id = '${id(109)}'`,
			)
		)[0].changed_by_user_id,
		id(1),
	);
	const imported = await rows("select * from imported_change order by id");
	await db.query("set time zone 'America/Chicago'");
	assert.deepEqual(await run(), [
		{ old_id: id(107), field: "name", reason: "agent_user_unknown" },
	]);
	await db.query("set time zone 'UTC'");
	assert.deepEqual(
		await rows("select * from imported_change order by id"),
		imported,
	);
	assert.deepEqual(await snapshot(), before);
});

test("copies market and estimate evidence unchanged on rerun", async () => {
	const cases = [
		["deal", 20, "city", "deal", { id: id(20) }, "market_id"],
		[
			"lead",
			12,
			"event_source",
			"party_role",
			{ party_id: id(10), role: "lead" },
			"lease_estimate_source",
		],
		[
			"lead",
			12,
			"event_confidence",
			"party_role",
			{ party_id: id(10), role: "lead" },
			"lease_estimate_confidence",
		],
	] as const;
	for (const [i, [subject, subjectId, field]] of cases.entries())
		await event(150 + i, subject, subjectId, field);
	assert.deepEqual(await run(), []);
	for (const [i, [, , , table, record, field]] of cases.entries()) {
		assert.deepEqual(
			await rows(`select table_name, record, field,
 source_event = (select to_jsonb(e) from public.event e where e.id = i.id) as exact
 from imported_change i where id = '${id(150 + i)}'`),
			[{ table_name: table, record, field, exact: true }],
		);
	}
	const imported = await rows("select * from imported_change order by id");
	assert.deepEqual(await run(), []);
	assert.deepEqual(
		await rows("select * from imported_change order by id"),
		imported,
	);
});

test("vendor note history follows exactly the copied notes without changing their wording", async () => {
	await db.query(`begin; select set_config('engine.job','old_system',true);
 insert into party (id,kind,name) values ('${id(60)}','company','Example Vendor');
 insert into outside_id (source,value,party_id) values ('old_system','${id(60)}','${id(60)}');
 insert into public.vendor_disposition (slug,label,workable,sort) values ('active','Example active',true,10);
 insert into public.party (id,kind,name,created_by,updated_by)
 values ('${id(60)}','person','Example Vendor','${id(1)}','${id(1)}');
 insert into public.vendor (id,party_id,category,intro_notes,merged_into,created_by,updated_by)
 values ('${id(70)}','${id(60)}','Example','Current note',null,'${id(1)}','${id(1)}'),
 ('${id(71)}','${id(60)}','Example','Different note','${id(70)}','${id(1)}','${id(1)}'),
 ('${id(72)}','${id(60)}','Example','Current note','${id(70)}','${id(1)}','${id(1)}'),
 ('${id(73)}','${id(60)}','Example','  ','${id(70)}','${id(1)}','${id(1)}');
 ${vendors} commit;`);
	for (const [i, vendor] of [70, 70, 71, 72, 73, 74].entries()) {
		await event(
			500 + i,
			"vendor",
			vendor,
			"intro_notes",
			i === 1 ? 2 : 1,
			i === 1 ? "partner_one" : null,
		);
		await db.query(
			`update public.event set verb = 'update-vendor', old_value = $1, new_value = $2,
 occurred_at = '2023-01-01'::timestamptz + $3 * interval '1 day' where id = $4`,
			[
				{ intro_notes: `Earlier wording ${i}` },
				{ intro_notes: i === 1 ? null : `Later wording ${i}` },
				i,
				id(500 + i),
			],
		);
	}
	const notes = () => rows("select * from activity order by id");
	const before = await notes();
	const history = await snapshot();
	const missing = [503, 504, 505].map((n) => ({
		old_id: id(n),
		field: "intro_notes",
		reason: "record_not_copied",
	}));
	assert.deepEqual(await run(), missing);
	for (const [i, vendor] of [70, 70, 71].entries()) {
		assert.deepEqual(
			await rows(`select table_name, record = jsonb_build_object('id',
 md5('old_system:vendor:' || '${id(vendor)}' || ':intro_notes')::uuid) as exact_record,
 field, source_event = (select to_jsonb(e) from public.event e where e.id = i.id) as exact_event,
 changed_at = (select occurred_at from public.event e where e.id = i.id) as exact_time,
 changed_by_user_id, changed_by_job, changed_for_user_id
 from imported_change i where id = '${id(500 + i)}'`),
			[
				{
					table_name: "activity",
					exact_record: true,
					field: "summary",
					exact_event: true,
					exact_time: true,
					changed_by_user_id: i === 1 ? null : id(1),
					changed_by_job: i === 1 ? "agent" : null,
					changed_for_user_id: i === 1 ? id(1) : null,
				},
			],
		);
	}
	assert.equal(
		(await rows("select count(*)::int n from imported_change"))[0].n,
		3,
	);
	const imported = await rows("select * from imported_change order by id");
	assert.deepEqual(await run(), missing);
	assert.deepEqual(
		await rows("select * from imported_change order by id"),
		imported,
	);
	assert.deepEqual(await notes(), before);
	assert.deepEqual(await snapshot(), history);
	await db.query(`update public.event set new_value = '{"intro_notes":"Conflicting wording"}' where id = '${id(500)}';
 update public.event set subject_id = '${id(71)}' where id = '${id(501)}'`);
	assert.deepEqual(await run(), [
		...[500, 501].map((n) => ({
			old_id: id(n),
			field: "intro_notes",
			reason: "existing_history_conflicts",
		})),
		...missing,
	]);
	assert.deepEqual(
		await rows("select * from imported_change order by id"),
		imported,
	);
	assert.deepEqual(await notes(), before);
	assert.deepEqual(await snapshot(), history);
});

test("vendor history waits for the exact note and its copied party", async () => {
	await event(510, "vendor", 14, "intro_notes");
	const missing = [
		{ old_id: id(510), field: "intro_notes", reason: "record_not_copied" },
	];
	assert.deepEqual(await run(), missing);
	await db.query(`begin; select set_config('engine.job','old_system',true);
 insert into activity (id,kind,happened_at,summary)
 values (md5('old_system:vendor:${id(14)}:intro_notes')::uuid,'call','2024-01-01','Example current text');
 insert into activity_about (activity_id,party_id)
 values (md5('old_system:vendor:${id(14)}:intro_notes')::uuid,'${id(10)}'); commit;`);
	assert.deepEqual(await run(), missing);
	await db.query(`begin; select set_config('engine.job','old_system',true);
 update activity set kind = 'note' where id = md5('old_system:vendor:${id(14)}:intro_notes')::uuid;
 delete from activity_about where activity_id = md5('old_system:vendor:${id(14)}:intro_notes')::uuid;
 insert into activity_about (activity_id,party_id)
 values (md5('old_system:vendor:${id(14)}:intro_notes')::uuid,'${id(1)}'); commit;`);
	assert.deepEqual(await run(), missing);
	assert.deepEqual(await rows("select id from imported_change"), []);
	await db.query(`begin; select set_config('engine.job','old_system',true);
 insert into activity_about (activity_id,party_id)
 values (md5('old_system:vendor:${id(14)}:intro_notes')::uuid,'${id(10)}'); commit;`);
	assert.deepEqual(await run(), []);
	assert.deepEqual(await rows("select id,field from imported_change"), [
		{ id: id(510), field: "summary" },
	]);
	const imported = await rows("select * from imported_change");
	assert.deepEqual(await run(), []);
	assert.deepEqual(await rows("select * from imported_change"), imported);
});

test("lists unsupported shapes, missing records and unresolved actors; retries preserve conflicting imports", async () => {
	await baseline();
	await event(120, "party", 10, "score");
	await event(121, "deal", 20, null);
	await event(122, "party", 99, "name");
	await event(123, "other", 10, "name");
	await event(124, "party", 10, "name", 4);
	await event(125, "party", 10, "name", 2, "partner_two");
	await event(126, "party", 10, "name", 2, "missing");
	// An unknown actor cannot normally pass the old foreign key, but the copy must refuse it if a source is incomplete.
	await db.query(`alter table public.event disable trigger all`);
	await event(127, "party", 10, "name", 99);
	await db.query(`alter table public.event enable trigger all`);
	const before = await rows(
		`select * from imported_change where id = '${id(100)}'`,
	);
	await db.query(
		`update public.event set cause = 'system' where id = '${id(100)}'`,
	);
	const report = await run();
	for (const [n, reason] of [
		[100, "existing_history_conflicts"],
		[120, "field_has_no_mapping"],
		[121, "field_has_no_mapping"],
		[122, "record_not_copied"],
		[123, "field_has_no_mapping"],
		[124, "user_not_copied"],
		[125, "sponsor_not_copied"],
		[126, "unknown_sponsor"],
		[127, "unknown_actor"],
	] as const) {
		assert.ok(
			report.some((r) => r.old_id === id(n) && r.reason === reason),
			`${n} ${reason}`,
		);
	}
	assert.equal(
		(
			await rows(
				`select count(*)::int n from imported_change where id >= '${id(120)}'`,
			)
		)[0].n,
		0,
	);
	assert.deepEqual(
		await rows(`select * from imported_change where id = '${id(100)}'`),
		before,
	);
	await db.query(`begin; select set_config('engine.job','old_system',true);
 insert into outside_id (source,value,party_id) values ('old_system','${id(99)}','${id(10)}'); commit`);
	await run();
	assert.equal(
		(
			await rows(`select record from imported_change where id = '${id(122)}'`)
		)[0].record.id,
		id(10),
	);
});

test("history constraints and privileges hold and a failed load restores its trigger", async () => {
	await baseline();
	assert.deepEqual(
		await rows(`select has_table_privilege('engine','imported_change','SELECT') as read,
 has_table_privilege('engine','imported_change','INSERT') as add,
 has_table_privilege('engine','imported_change','UPDATE') as edit,
 has_table_privilege('engine','imported_change','DELETE') as remove`),
		[{ read: true, add: false, edit: false, remove: false }],
	);
	for (const update of [
		"changed_by_user_id = null, changed_by_job = null",
		"changed_by_job = 'agent'",
		`changed_by_user_id = '${id(99)}'`,
		"record = '{}'",
		"source_event = '{}'",
		"table_name = 'unknown'",
		"table_name = 'lease_version'",
	]) {
		await db.query("begin");
		await assert.rejects(
			db.query(`update imported_change set ${update} where id = '${id(100)}'`),
		);
		await db.query("rollback");
	}
	await db.query("begin");
	await assert.rejects(db.query(`${copy}select 1/0;`));
	await db.query("rollback");
	assert.deepEqual(
		await rows(`select tgenabled from pg_trigger where tgrelid = 'imported_change'::regclass
 and tgname = 'stamp_imported_change'`),
		[{ tgenabled: "O" }],
	);
});

test("an owner erase removes imported words and cannot be undone by a copy or repeated erase", async () => {
	await event(140, "vendor", 14, "offers");
	await event(141, "vendor", 14, "seeking");
	await db.query(`update public.event set human_quote = 'Example private words', agent_rationale = 'Example private reasoning'
 where id in ('${id(140)}','${id(141)}')`);
	await run();
	const before = await rows(
		"select id,changed_at,changed_by_user_id from imported_change order by id",
	);
	await db.query(`begin; select set_config('engine.job','old_system',true);
 delete from party_role where party_id = '${id(10)}' and role = 'vendor';
 select erase_change((select max(id) from change where table_name = 'party_role' and action = 'delete'), array['offers']); commit`);
	assert.deepEqual(
		await rows(`select source_event ? 'old_value' as old,source_event ? 'new_value' as new,
 source_event ? 'human_quote' as quote,source_event ? 'agent_rationale' as rationale from imported_change order by id`),
		[
			{ old: false, new: false, quote: false, rationale: false },
			{ old: true, new: true, quote: false, rationale: false },
		],
	);
	assert.deepEqual(
		await rows(
			"select id,changed_at,changed_by_user_id from imported_change order by id",
		),
		before,
	);
	const erased = await rows("select * from imported_change order by id");
	const history = await rows("select * from change order by id");
	await run();
	await db.query(`begin; select set_config('engine.job','old_system',true);
 select erase_change((select max(id) from change where table_name = 'party_role' and action = 'delete'), array['offers']); commit`);
	assert.deepEqual(
		await rows("select * from imported_change order by id"),
		erased,
	);
	assert.deepEqual(await rows("select * from change order by id"), history);
	await db.query(`begin; select set_config('engine.job','old_system',true);
 insert into party_role (party_id,role) values ('${id(10)}','vendor'); commit`);
	assert.deepEqual(await run(), []);
	assert.deepEqual(
		await rows("select * from imported_change order by id"),
		erased,
	);
});

test("copies Deal Room parking, revival, note and attention evidence without replay", async () => {
	const active = { state: "active", reason: null, note: null };
	const parked = { state: "parked", reason: "client_paused", note: null };
	const noted = { ...parked, note: "Example parking note" };
	const cases = [
		["operating_state", active, parked, "parking_reason"],
		["operating_state", parked, active, "parking_reason"],
		["operating_state", parked, noted, "parking_note"],
		["operating_state", noted, parked, "parking_note"],
		["operating_state", noted, active, "parking_note"],
		["operating_state", active, { ...noted, reason: "other" }, "parking_note"],
		[
			"operating_state",
			parked,
			{ ...parked, reason: "prospect_never_active" },
			"parking_reason",
		],
		["operating_state", noted, { ...noted, reason: "other" }, "parking_note"],
		["attention", false, true, "needs_attention"],
		["attention", true, false, "needs_attention"],
	] satisfies [string, object | boolean, object | boolean, string][];
	for (const [i, [field, oldValue, newValue]] of cases.entries()) {
		await event(200 + i, "deal", 20, field, 2, "partner_one");
		await db.query(
			"update public.event set old_value = $1, new_value = $2 where id = $3",
			[{ [field]: oldValue }, { [field]: newValue }, id(200 + i)],
		);
	}
	const before = await snapshot();
	assert.deepEqual(await run(), []);
	for (const [i, [, , , field]] of cases.entries()) {
		assert.deepEqual(
			await rows(`select table_name, record, field, changed_at::text, changed_by_job, changed_for_user_id,
 changed_by_user_id, old_value_absent, new_value_absent,
 source_event = (select to_jsonb(e) from public.event e where e.id = i.id) as exact
 from imported_change i where id = '${id(200 + i)}'`),
			[
				{
					table_name: "deal",
					record: { id: id(20) },
					field,
					changed_at: "2024-01-01 00:00:00+00",
					changed_by_job: "agent",
					changed_for_user_id: id(1),
					changed_by_user_id: null,
					old_value_absent: false,
					new_value_absent: false,
					exact: true,
				},
			],
		);
	}
	const imported = await rows("select * from imported_change order by id");
	assert.deepEqual(await run(), []);
	assert.deepEqual(
		await rows("select * from imported_change order by id"),
		imported,
	);
	assert.deepEqual(await snapshot(), before);
});

test("lists unknown Deal Room payloads on either side instead of guessing", async () => {
	const active = {
		operating_state: { state: "active", reason: null, note: null },
	};
	const malformed = [
		null,
		"null",
		JSON.stringify("active"),
		JSON.stringify({}),
		JSON.stringify({ operating_state: "parked" }),
		JSON.stringify({
			operating_state: { state: "unknown", reason: null, note: null },
		}),
		JSON.stringify({
			operating_state: { state: "active", reason: "other", note: null },
		}),
		JSON.stringify({
			operating_state: { state: "active", reason: null, note: "Example" },
		}),
		JSON.stringify({
			operating_state: { state: "parked", reason: "unknown", note: null },
		}),
		JSON.stringify({
			operating_state: { state: "parked", reason: "other", note: 3 },
		}),
		JSON.stringify({ operating_state: { state: "parked", reason: "other" } }),
		JSON.stringify({
			operating_state: { ...active.operating_state, extra: true },
		}),
		JSON.stringify({ ...active, extra: true }),
	];
	const cases = [
		...malformed.map((value) => ({
			field: "operating_state",
			valid: JSON.stringify(active),
			value,
		})),
		...[
			null,
			"null",
			"true",
			"{}",
			'{"attention":null}',
			'{"attention":"false"}',
			'{"attention":false,"extra":true}',
		].map((value) => ({
			field: "attention",
			valid: '{"attention":false}',
			value,
		})),
	];
	const expected = [];
	for (const [i, { field, valid, value }] of cases.entries()) {
		for (const side of [0, 1]) {
			const n = 300 + i * 2 + side;
			await event(n, "deal", 20, field);
			await db.query(
				"update public.event set old_value = $1::jsonb, new_value = $2::jsonb where id = $3",
				side === 0 ? [value, valid, id(n)] : [valid, value, id(n)],
			);
			expected.push({ old_id: id(n), field, reason: "payload_shape_unknown" });
		}
	}
	assert.deepEqual(await run(), expected);
	assert.deepEqual(await rows("select id from imported_change"), []);
	assert.deepEqual(await run(), expected);
});
