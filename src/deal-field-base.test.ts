import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { withSnapshot } from "../scripts/test-database.ts";
import { PARTNERS } from "./clients/read.ts";
import { preparePatch } from "./deal-field-base.ts";
import { runSave, SaveRefusal } from "./save.ts";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const D = "00000000-0000-4000-8000-000000000003";
const C = "00000000-0000-4000-8000-000000000004";
const seed = `insert into actor (id,slug,kind,display_name) values
('${A}','partner_one','human','Example Partner'),('${B}','${PARTNERS[0]}','human','Other Example');
insert into contact_state (slug,label,contactable,sort) values ('active','Example',true,1);
insert into deal_type_ref (slug,label,sort) values ('example','Example',1);
insert into deal_phase (slug,label) values ('example','Example');
with p as (insert into party (kind,name,created_by,updated_by) values ('org','Example Clinic','${A}','${A}') returning id)
insert into client (id,party_id,created_by,updated_by) select '${C}',id,'${A}','${A}' from p;
insert into deal (id,client_id,name,deal_type,phase,created_by,updated_by) values ('${D}','${C}','Example Deal','example','example','${A}','${A}');
insert into participant_role (slug,label,side) values ('lead','Example','actor');
insert into deal_participant (deal_id,actor_id,role,set_by) values ('${D}','${A}','lead','${A}');`;

const save = (
	url: string,
	args: Record<string, import("./database.d.ts").JsonValue>,
) =>
	runSave(
		url,
		{
			partner: "partner_one",
			verb: "patch-deal-field",
			args,
			correlation_id: randomUUID(),
		},
		async (saving, args) => {
			const result = await preparePatch(saving, args);
			return "conflict" in result ? result : { ok: true, ...result };
		},
	);

test("field bases validate exact cells and store the old conflict answer without updating", () =>
	withSnapshot(async (url) => {
		const db = new pg.Client({ connectionString: url });
		await db.connect();
		try {
			await db.query(seed);
			const event = randomUUID();
			await db.query(
				"insert into event (id,actor_id,verb,subject_type,subject_id,field,new_value,cause,occurred_at) values ($1,$2,'patch-deal-field','deal',$3,'owner','{\"owner\":null}','automation_job',now())",
				[event, A, D],
			);
			const args = {
				idempotency_key: randomUUID(),
				deal: D,
				field: "owner",
				value: PARTNERS[0],
				base_event_id: null,
			};
			const answer = await save(url, args);
			const made = (await db.query("select id,status from deal_conflict"))
				.rows[0];
			assert.equal(
				JSON.stringify(answer),
				JSON.stringify({
					ok: false,
					conflict: {
						id: made.id,
						status: made.status,
						deal_id: D,
						field: "owner",
						value_a: null,
						actor_a: "partner_one",
						event_a: event,
						value_b: PARTNERS[0],
						actor_b: "partner_one",
					},
				}),
			);
			const stored = (await db.query("select response from tool_call")).rows[0]
				.response;
			assert.equal(
				JSON.stringify(await save(url, args)),
				JSON.stringify({ replayed: true, ...stored }),
			);
			assert.equal(
				(await db.query("select count(*) from deal_conflict")).rows[0].count,
				"1",
			);
			await db.query(
				"insert into event (actor_id,verb,subject_type,subject_id,field,new_value,cause,occurred_at,recorded_at) values ($1,'patch-deal-field','deal',$2,'attention','{\"attention\":true}','automation_job',now(),clock_timestamp())",
				[A, D],
			);
			const fresh = await save(url, {
				...args,
				idempotency_key: randomUUID(),
				base_event_id: event,
			});
			assert.equal(fresh.ok, true);
			for (const extra of [
				{ base_event_id: randomUUID() },
				{
					field: "operating_state",
					value: { state: "active" },
					base_event_id: event,
				},
				{ occurred_on: "2020-01-01" },
				{ value: "wrong" },
				{ field: "operating_state", value: { state: "parked" } },
				{ field: "operating_state", value: { state: "active", note: "x" } },
				{
					field: "operating_state",
					value: { state: "parked", reason: "other", note: "x".repeat(501) },
				},
			]) {
				await assert.rejects(
					save(url, { ...args, idempotency_key: randomUUID(), ...extra }),
					SaveRefusal,
				);
			}
			const disjoint = await save(url, {
				...args,
				idempotency_key: randomUUID(),
				field: "operating_state",
				value: { state: "parked", reason: "other", note: "  " },
			});
			assert.deepEqual(disjoint.change, {
				field: "operating_state",
				value: { state: "parked", reason: "other", note: null },
			});
			assert.equal(
				(await db.query("select owner from deal")).rows[0].owner,
				null,
			);
			assert.equal(
				(await db.query("select count(*) from event")).rows[0].count,
				"2",
			);
		} finally {
			await db.end();
		}
	}));

test("crossed edits need only the existing writer column grants", () =>
	withSnapshot(async (url) => {
		const db = new pg.Client({ connectionString: url });
		await db.connect();
		const role = `writer_${randomUUID().replaceAll("-", "")}`;
		try {
			await db.query(seed);
			await db.query(
				"insert into event (actor_id,verb,subject_type,subject_id,field,new_value,cause,occurred_at) values ($1,'patch-deal-field','deal',$2,'owner','{\"owner\":null}','automation_job',now())",
				[A, D],
			);
			await db.query(`create role ${role} login noinherit`);
			await db.query(
				`grant select on actor,event,deal,deal_conflict,v_ref_index to ${role}`,
			);
			await db.query(
				`grant select (idempotency_key,request_hash,response,created_at) on tool_call to ${role}`,
			);
			await db.query(
				`grant insert (deal_id,field,value_a,actor_a,event_a,value_b,actor_b) on deal_conflict to ${role}`,
			);
			await db.query(
				`grant insert (idempotency_key,verb,actor_id,request_hash,response,via,client_id,organization_tenant_id,sponsoring_human_slug,personal_scope,authorization_class,correlation_id) on tool_call to ${role}`,
			);
			const login = new URL(url);
			login.username = role;
			const args = {
				idempotency_key: randomUUID(),
				deal: D,
				field: "owner",
				value: null,
				base_event_id: null,
			};
			assert.equal((await save(login.href, args)).ok, false);
			assert.equal((await save(login.href, args)).replayed, true);
		} finally {
			await db.query(`drop owned by ${role}`);
			await db.query(`drop role ${role}`);
			await db.end();
		}
	}));
