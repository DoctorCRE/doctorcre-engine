import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { withSnapshot } from "../scripts/test-database.ts";
import { PARTNERS } from "./clients/read.ts";
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
insert into deal (id,client_id,name,deal_type,phase,created_by,updated_by) values ('${D}','${C}','Example Deal','example','example','${A}','${A}');
insert into participant_role (slug,label,side) values ('lead','Example','actor');
insert into deal_participant (deal_id,actor_id,role,set_by) values ('${D}','${A}','lead','${A}');`;

const request = (url: string, args: Record<string, unknown>) =>
	worker.request(
		`${origin}/api/engine/patch-deal-field`,
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

test("owner and parking saves match the documented old answers and commit atomically", () =>
	withSnapshot(async (url) => {
		const db = new pg.Client({ connectionString: url });
		await db.connect();
		try {
			await db.query(seed);
			await db.query("set timezone='UTC'");
			let base: string | null = null;
			for (const [field, value, old_value, new_value] of [
				["owner", PARTNERS[0], null, PARTNERS[0]],
				["owner", null, PARTNERS[0], null],
				[
					"operating_state",
					{ state: "parked", reason: "other", note: "  Example note  " },
					{ note: null, state: "active", reason: null },
					{ state: "parked", reason: "other", note: "Example note" },
				],
				[
					"operating_state",
					{ state: "active" },
					{ note: "Example note", state: "parked", reason: "other" },
					{ state: "active", reason: null, note: null },
				],
			] as const) {
				if (
					field === "operating_state" &&
					typeof new_value === "object" &&
					new_value?.state === "parked"
				)
					base = null;
				const key = randomUUID();
				const args: Record<string, unknown> = {
					idempotency_key: key,
					deal: D,
					field,
					value,
					base_event_id: base,
					human_quote: "Example quote",
					change_reason: "Example reason",
				};
				const response = await request(url, args);
				const text = await response.text();
				assert.equal(response.status, 200, text);
				const event = (
					await db.query(
						"select id,to_jsonb(recorded_at)#>>'{}' as recorded_at,old_value,new_value,cause,human_quote,agent_rationale from event where idempotency_key=$1",
						[key],
					)
				).rows[0];
				assert.equal(
					text,
					JSON.stringify({
						ok: true,
						deal_id: D,
						field,
						old_value,
						new_value,
						event_id: event.id,
						event_recorded_at: event.recorded_at,
					}),
				);
				assert.deepEqual(event.old_value, { [field]: old_value });
				assert.deepEqual(event.new_value, { [field]: new_value });
				assert.equal(event.cause, "human_stated");
				assert.equal(event.human_quote, "Example quote");
				assert.equal(event.agent_rationale, "Example reason");
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
				const row = (
					await db.query(
						"select owner,parked_at,parked_by,parking_reason,parking_note,version from deal where id=$1",
						[D],
					)
				).rows[0];
				if (field === "owner") {
					assert.equal(row.owner, value);
					const leads = (
						await db.query(
							"select actor_id from deal_participant where to_at is null",
						)
					).rows;
					assert.deepEqual(leads, value ? [{ actor_id: B }] : []);
				} else {
					assert.equal(row.parked_by, new_value?.state === "parked" ? A : null);
					assert.equal(row.parked_at !== null, new_value?.state === "parked");
				}
				base = event.id;
			}
			const ownerBase = (
				await db.query(
					"select id from event where field='owner' order by recorded_at desc,id desc limit 1",
				)
			).rows[0].id;
			const role = `writer_${randomUUID().replaceAll("-", "")}`;
			await db.query(`create role ${role} login noinherit`);
			try {
				for (const grant of [
					"select on actor,event,deal,deal_participant,participant_role,deal_conflict,v_ref_index",
					"select (idempotency_key,request_hash,response,created_at) on tool_call",
					"insert (idempotency_key,verb,actor_id,request_hash,response,via,client_id,organization_tenant_id,sponsoring_human_slug,personal_scope,authorization_class,correlation_id) on tool_call",
					"insert (actor_id,agent_rationale,authorization_class,cause,client_id,correlation_id,field,human_quote,idempotency_key,new_value,occurred_at,old_value,organization_tenant_id,personal_scope,recorded_at,sponsoring_human_slug,subject_id,subject_type,verb,via) on event",
					"insert (deal_id,actor_id,role,set_by) on deal_participant",
					"update (to_at) on deal_participant",
					"update (owner,operating_state,parking_reason,parking_note,parked_at,parked_by,updated_by) on deal",
					"insert (deal_id,field,value_a,actor_a,event_a,value_b,actor_b) on deal_conflict",
				])
					await db.query(`grant ${grant} to ${role}`);
				const login = new URL(url);
				login.username = role;
				const args = {
					idempotency_key: randomUUID(),
					deal: D,
					field: "owner",
					value: PARTNERS[0],
					base_event_id: ownerBase,
				};
				const answers = await Promise.all([
					request(login.href, args),
					request(login.href, args),
				]);
				const bodies = await Promise.all(
					answers.map(async (r) => {
						assert.equal(r.status, 200);
						return JSON.parse(await r.text());
					}),
				);
				assert.equal(bodies.filter((b) => b.replayed).length, 1);
				assert.equal(
					(await db.query("select count(*) from event")).rows[0].count,
					"5",
				);
				await db.query("update actor set active=false where id=$1", [B]);
				const refused = await request(url, {
					idempotency_key: randomUUID(),
					deal: D,
					field: "owner",
					value: PARTNERS[0],
					base_event_id: bodies[0].event_id,
				});
				const refusal = JSON.parse(await refused.text());
				assert.equal(
					JSON.stringify(refusal),
					JSON.stringify({
						error: "unknown_owner",
						correlation_id: refusal.correlation_id,
						hint: "Owner is one of joe, dell or claude.",
					}),
				);
				assert.equal(
					(
						await db.query(
							"select count(*) from deal_participant where to_at is null",
						)
					).rows[0].count,
					"1",
				);
				assert.equal(
					(await db.query("select count(*) from event")).rows[0].count,
					"5",
				);
				await db.query("update actor set active=true where id=$1", [B]);
				const next = { ...args, base_event_id: bodies[0].event_id };
				const crossed = await Promise.all([
					request(login.href, {
						...next,
						idempotency_key: randomUUID(),
						value: null,
					}),
					request(login.href, { ...next, idempotency_key: randomUUID() }),
				]);
				const choices = await Promise.all(
					crossed.map(async (r) => JSON.parse(await r.text())),
				);
				assert.equal(choices.filter((b) => b.ok === true).length, 1);
				assert.equal(
					choices.filter((b) => b.ok === false && b.conflict).length,
					1,
				);
				const parking = {
					deal: D,
					field: "operating_state",
					value: { state: "parked", reason: "other", note: " " },
					base_event_id: base,
				};
				const parked = await request(login.href, {
					...parking,
					idempotency_key: randomUUID(),
				});
				assert.equal(parked.status, 200, await parked.clone().text());
				const parkAnswer = JSON.parse(await parked.text());
				const revived = await request(login.href, {
					...parking,
					value: { state: "active" },
					base_event_id: parkAnswer.event_id,
					idempotency_key: randomUUID(),
				});
				assert.equal(revived.status, 200, await revived.text());
			} finally {
				await db.query(`drop owned by ${role}`);
				await db.query(`drop role ${role}`);
			}
		} finally {
			await db.end();
		}
	}));
