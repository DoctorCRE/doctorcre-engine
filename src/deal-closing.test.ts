import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { withSnapshot } from "../scripts/test-database.ts";
import { PARTNERS } from "./clients/read.ts";
import { isArguments } from "./save-door.ts";
import worker from "./worker.ts";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const D = "00000000-0000-4000-8000-000000000003";
const C = "00000000-0000-4000-8000-000000000004";
const origin = "https://app.example.test";
const seed = `insert into actor (id,slug,kind,display_name) values
('${A}','partner_one','human','Example Partner'),('${B}','${PARTNERS[0]}','human','Other Example');
insert into contact_state (slug,label,contactable,sort) values ('active','Example',true,1);
insert into deal_type_ref (slug,label,sort) values ('example','Example',1);
insert into deal_phase (slug,label) values ('example','Example');
with p as (insert into party (kind,name,created_by,updated_by) values ('org','Example Clinic','${A}','${A}') returning id)
insert into client (id,party_id,created_by,updated_by) select '${C}',id,'${A}','${A}' from p;
insert into deal (id,client_id,name,deal_type,phase,created_by,updated_by) values ('${D}','${C}','Example Deal','example','example','${A}','${B}');
insert into participant_role (slug,label,side) values ('lead','Example','actor');
insert into deal_participant (deal_id,actor_id,role,set_by) values ('${D}','${A}','lead','${A}');`;

const request = (url: string, args: Record<string, unknown>) =>
	worker.request(
		`${origin}/api/engine/update-deal`,
		{
			method: "POST",
			headers: {
				Cookie: "__Host-dealroom_session=example",
				Origin: origin,
				"Sec-Fetch-Site": "same-origin",
				"x-carr-csrf": "example",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(args),
		},
		{
			DATABASE_WRITER: { connectionString: url },
			CARR: {
				fetch: async () =>
					Response.json({
						actor: { slug: "partner_one", display: "Example Partner" },
						csrf_token: "example",
					}),
			},
		},
	);

const withDeal = (run: (url: string, db: pg.Client) => Promise<void>) =>
	withSnapshot(async (url) => {
		const db = new pg.Client({ connectionString: url });
		await db.connect();
		try {
			await db.query(seed);
			await db.query("set timezone='UTC'");
			await run(url, db);
		} finally {
			await db.end();
		}
	});

test("closing saves preserve field order, nulls, raw values, events and replay", () =>
	withDeal(async (url, db) => {
		for (const fields of [
			{
				invoiced_on: "2024-02-29",
				won_value: "1234.50",
				closed_on: "2024-02-28",
				outcome: "won",
			},
			{ outcome: "won" },
			{ outcome: "lost" },
			{ outcome: null, closed_on: null, won_value: null, invoiced_on: null },
		]) {
			const before = (
				await db.query(
					"select version,outcome,closed_on::text,won_value,invoiced_on::text from deal where id=$1",
					[D],
				)
			).rows[0];
			const key = randomUUID();
			const args = {
				deal: D,
				base_version: String(before.version),
				fields,
				idempotency_key: key,
			};
			const response = await request(url, args);
			assert.equal(response.status, 200, await response.clone().text());
			const changed = "outcome" in fields && fields.outcome !== before.outcome;
			assert.equal(
				await response.text(),
				JSON.stringify({
					ok: true,
					updated: Object.keys(fields),
					...(changed && {
						next_step_required: true,
						prompt:
							"Doc needs the new next step and date for this deal. Use set-next-step to record both.",
					}),
				}),
			);
			const events = (
				await db.query(
					"select field,old_value,new_value,cause,verb from event where idempotency_key=$1 order by recorded_at, field",
					[key],
				)
			).rows;
			assert.equal(events.length, Object.keys(fields).length);
			for (const [field, value] of Object.entries(fields)) {
				const event = events.find((e) => e.field === field);
				assert.deepEqual(event.old_value, { [field]: before[field] });
				assert.deepEqual(event.new_value, { [field]: value });
				assert.equal(event.cause, "automation_job");
				assert.equal(event.verb, "update-deal");
			}
			const receipt = (
				await db.query(
					"select response from tool_call where idempotency_key=$1",
					[key],
				)
			).rows[0].response;
			assert.equal(
				await (await request(url, args)).text(),
				JSON.stringify({ replayed: true, ...receipt }),
			);
		}
	}));

test("crossed edits rebase disjoint fields and refuse the same field without writing", () =>
	withDeal(async (url, db) => {
		await db.query(
			"update deal set city='Example City',created_at='2020-01-01T00:00:00.123456Z' where id=$1",
			[D],
		);
		await db.query(
			"insert into event (actor_id,verb,subject_type,subject_id,field,cause,occurred_at,recorded_at) values ($1,'new-deal','deal',$2,'created','automation_job',now(),'2020-01-01T00:00:00.123456Z')",
			[B, D],
		);
		await db.query(
			"insert into event (actor_id,verb,subject_type,subject_id,field,new_value,cause,occurred_at,recorded_at) values ($1,'update-deal','deal',$2,'city','{\"city\":\"Example City\"}','automation_job',now(),clock_timestamp())",
			[B, D],
		);
		const prior = (await db.query("select version from deal where id=$1", [D]))
			.rows[0].version;
		const events = (
			await db.query(
				"select a.slug as actor,e.verb,e.field,e.recorded_at from event e join actor a on a.id=e.actor_id order by e.recorded_at desc",
			)
		).rows;
		const response = await request(url, {
			deal: D,
			base_version: 1,
			fields: { invoiced_on: "2024-01-01" },
			idempotency_key: randomUUID(),
		});
		assert.equal(
			await response.text(),
			JSON.stringify({
				ok: true,
				updated: ["invoiced_on"],
				rebased: true,
				rebase_receipt: {
					from_base_version: 1,
					rebased_to_version: prior,
					disjoint_intervening_events: events,
					hint: "version advanced from a write to a different field; re-applied against the current row with no human confirmation needed",
				},
			}),
		);
		const refused = await request(url, {
			deal: D,
			base_version: prior,
			fields: { invoiced_on: null },
			idempotency_key: randomUUID(),
		});
		assert.equal(refused.status, 409);
		assert.deepEqual(await refused.json(), {
			error: "version_conflict",
			correlation_id: refused.headers.get("x-correlation-id"),
			hint: "Re-read the record and ask the human before retrying.",
			current_version: prior + 1,
		});
		assert.equal(
			(await db.query("select count(*) from event")).rows[0].count,
			"3",
		);
	}));

test("closing validation refuses invalid dates and outcomes atomically", () =>
	withDeal(async (url, db) => {
		for (const fields of [
			{ invoiced_on: "2026-02-30" },
			{ invoiced_on: 42 },
			{ outcome: "invalid" },
			{ closed_on: "invalid" },
			{ won_value: "invalid" },
			{},
		]) {
			const response = await request(url, {
				deal: D,
				base_version: 1,
				fields,
				idempotency_key: randomUUID(),
			});
			assert.equal(response.status, "closed_on" in fields ? 500 : 400);
			const body = await response.json();
			assert.ok(isArguments(body));
			assert.equal(
				body.error,
				"invoiced_on" in fields ||
					"closed_on" in fields ||
					!Object.keys(fields).length
					? "unhandled_verb_failure"
					: "database_refused_the_statement",
			);
		}
		assert.equal(
			(await db.query("select count(*) from event")).rows[0].count,
			"0",
		);
	}));

test("changed outcomes drop only the partner's overdue work after the closing events", () =>
	withDeal(async (url, db) => {
		await db.query(
			"update deal set owner='partner_one',next_date='2020-01-01' where id=$1",
			[D],
		);
		const ids = [randomUUID(), randomUUID(), randomUUID()];
		for (const [id, owner, item] of [
			[ids[0], A, null],
			[ids[1], B, null],
			[ids[2], A, "Example item"],
		])
			await db.query(
				"insert into next_action (id,subject_type,subject_id,owner_id,description,due_on,item_title,created_by,updated_by,source_ref,updated_at) values ($1,'deal',$2,$3,'Example overdue step','2020-01-01',$4,$3,$3,'example',$5)",
				[id, D, owner, item, id === ids[0] ? "2025-01-01" : "2024-01-01"],
			);
		const version = (
			await db.query("select version from deal where id=$1", [D])
		).rows[0].version;
		const key = randomUUID();
		const response = await request(url, {
			deal: D,
			base_version: version,
			fields: { outcome: "won" },
			idempotency_key: key,
		});
		assert.equal(response.status, 200, await response.clone().text());
		const body = await response.json();
		assert.ok(isArguments(body));
		assert.deepEqual(body.superseded_action_ids, [ids[0]]);
		assert.deepEqual(
			(
				await db.query(
					"select id from next_action where status='open' order by id",
				)
			).rows.map((r) => r.id),
			[ids[1], ids[2]].sort(),
		);
		assert.deepEqual(
			(
				await db.query(
					"select field from event where idempotency_key=$1 order by recorded_at",
					[key],
				)
			).rows.map((r) => r.field),
			["outcome", "next_action", "next_date", "next_step"],
		);
	}));
