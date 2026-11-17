import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { withSnapshot } from "../scripts/test-database.ts";
import worker from "./worker.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [A, B, C] = [id(1), id(2), id(4)];
const [D1, D2, D3] = [id(11), id(12), id(13)];
const PAST = "2020-01-01";
const LATER = "2999-01-01";
const PROMPT =
	"Doc needs the new next step and date for this deal. Use set-next-step to record both.";
const origin = "https://app.example.test";

const seed = `insert into actor (id,slug,kind,display_name) values
('${A}','partner_one','human','Example Partner'),('${B}','partner_two','human','Other Partner');
insert into contact_state (slug,label,contactable,sort) values ('active','Example',true,1);
insert into deal_type_ref (slug,label,sort) values ('example','Example',1);
insert into deal_phase (slug,label) values ('example','Example'),('later','Later');
with p as (insert into party (kind,name,created_by,updated_by) values ('org','Example Clinic','${A}','${A}') returning id)
insert into client (id,party_id,created_by,updated_by) select '${C}',id,'${A}','${A}' from p;
insert into deal (id,client_id,name,deal_type,phase,owner,next_date,created_by,updated_by)
select d,'${C}','Example Deal','example','example','partner_one',n,'${A}','${A}'
from (values ('${D1}'::uuid,'${PAST}'::date),('${D2}',null),('${D3}','${PAST}')) v(d,n);
insert into next_action (id,subject_type,subject_id,owner_id,due_on,description,created_by,updated_at,item_title,source_ref) values
('${id(21)}','deal','${D1}','${A}','${PAST}','Example overdue step','${A}','2026-01-03',null,null),
('${id(23)}','deal','${D1}','${B}','${LATER}','Example later step','${B}','2026-01-02',null,null),
('${id(24)}','deal','${D1}','${A}','${PAST}','Example step','${A}','2026-01-01','Example checklist item','example:1'),
('${id(25)}','deal','${D2}','${B}','${LATER}','Example current step','${B}','2026-01-03',null,null),
('${id(26)}','deal','${D2}','${A}','${PAST}','Example forgotten step','${A}','2026-01-01',null,null);
insert into capture_session (id,nonce,device_id,actor_id,mode,started_at,consent_announced_at,session_token_hash,expires_at,state_at)
values ('${id(30)}','example-nonce','example-device','${A}','meeting','2025-01-01','2025-01-01','example-hash','2025-01-02','2025-01-01');
insert into capture_post_call_candidate (id,session_id,idempotency_key,batch_hash,item_index,kind,deal_id,assignee_slug,action_description,evidence_quote,confidence)
select v,'${id(30)}',v::text,'example-batch',row_number() over () - 1,'assigned_action','${D1}','partner_one','Example action','Example evidence',1
from unnest(array['${id(31)}','${id(32)}','${id(33)}']::uuid[]) v;
insert into capture_post_call_action (id,candidate_id,deal_id,owner_id,due_on,description,accepted_by,item_title,source_ref) values
('${id(41)}','${id(31)}','${D1}','${A}','${PAST}','Example post-call step','${A}',null,null),
('${id(42)}','${id(32)}','${D1}','${B}','${PAST}','Example other post-call','${B}',null,null),
('${id(43)}','${id(33)}','${D1}','${A}','${PAST}','Example post-call item','${A}','Example checklist item','example:2');`;

const request = (url: string, args: object) =>
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

const move = (deal: string, extra: object = {}) => ({
	idempotency_key: randomUUID(),
	deal,
	field: "phase",
	value: "later",
	base_event_id: null,
	...extra,
});

test("phase moves drop only the partner's overdue work and match the old answers", () =>
	withSnapshot(async (url) => {
		const db = new pg.Client({ connectionString: url });
		await db.connect();
		const role = `writer_${randomUUID().replaceAll("-", "")}`;
		try {
			await db.query(seed);
			await db.query("set timezone='UTC'");
			await db.query(`create role ${role} login noinherit`);
			for (const grant of [
				"select on actor,event,deal,deal_conflict,v_ref_index,next_action,capture_post_call_action,v_deal_room_board,v_deal_current_action",
				"select (idempotency_key,request_hash,response,created_at) on tool_call",
				"insert (idempotency_key,verb,actor_id,request_hash,response,via,client_id,organization_tenant_id,sponsoring_human_slug,personal_scope,authorization_class,correlation_id) on tool_call",
				"insert (actor_id,agent_rationale,authorization_class,cause,client_id,correlation_id,field,human_quote,idempotency_key,new_value,occurred_at,old_value,organization_tenant_id,personal_scope,recorded_at,sponsoring_human_slug,subject_id,subject_type,verb,via) on event",
				"update (phase,next_date,updated_by) on deal",
				"update (status,updated_at,updated_by) on next_action",
				"update (completed_at,status,updated_at) on capture_post_call_action",
				"execute on function carr_business_date(timestamptz),carr_is_partner_actor(uuid),carr_is_partner_made(uuid,text)",
			])
				await db.query(`grant ${grant} to ${role}`);
			await db.query(
				"revoke execute on function carr_business_date(timestamptz),carr_is_partner_actor(uuid),carr_is_partner_made(uuid,text) from public",
			);
			const login = new URL(url);
			login.username = role;
			const events = async (key: string) =>
				(
					await db.query(
						"select id,field,old_value,new_value,to_jsonb(recorded_at)#>>'{}' as recorded_at,to_jsonb(occurred_at)#>>'{}' as occurred_at from event where idempotency_key=$1 order by recorded_at,id",
						[key],
					)
				).rows;
			const answered = async (args: { idempotency_key: string }, at = url) => {
				const response = await request(at, args);
				const text = await response.text();
				assert.equal(response.status, 200, text);
				const [phase] = await events(args.idempotency_key);
				const tail = `"event_id":"${phase.id}","event_recorded_at":"${phase.recorded_at}"}`;
				const receipt = (
					await db.query(
						"select response from tool_call where idempotency_key=$1",
						[args.idempotency_key],
					)
				).rows[0].response;
				assert.equal(
					await (await request(at, args)).text(),
					JSON.stringify({ replayed: true, ...receipt }),
				);
				return { text, tail };
			};
			const open = async () =>
				(
					await db.query(
						"select id from next_action where status='open' union all select id from capture_post_call_action where status='open' order by id",
					)
				).rows.map((r) => r.id);

			const replaced = move(D1, { human_quote: "Example quote" });
			const first = await answered(replaced, login.href);
			assert.equal(
				first.text,
				`{"ok":true,"deal_id":"${D1}","field":"phase","superseded_action_ids":["${id(21)}","${id(41)}"],"superseded_post_call_action_ids":["${id(41)}"],"next_step_required":false,"old_value":"example","new_value":"later",${first.tail}`,
			);
			const superseded = [id(21), id(41)];
			assert.deepEqual(
				(await events(replaced.idempotency_key)).map((e) => [
					e.field,
					e.old_value,
					e.new_value,
				]),
				[
					["phase", { phase: "example" }, { phase: "later" }],
					[
						"next_action",
						{
							actions: [
								{
									id: id(21),
									description: "Example overdue step",
									due_on: PAST,
								},
								{
									id: id(41),
									description: "Example post-call step",
									due_on: PAST,
								},
							],
						},
						{ superseded_action_ids: superseded, status: "dropped" },
					],
					[
						"next_date",
						{ next_date: PAST },
						{ next_date: LATER, superseded_action_ids: superseded },
					],
					[
						"next_step",
						{ next_step: "Example overdue step" },
						{
							next_step: "Example later step",
							superseded_action_ids: superseded,
						},
					],
				],
			);
			assert.deepEqual(await open(), [
				id(23),
				id(24),
				id(25),
				id(26),
				id(42),
				id(43),
			]);
			assert.deepEqual(
				(
					await db.query("select phase,next_date::text from deal where id=$1", [
						D1,
					])
				).rows,
				[{ phase: "later", next_date: LATER }],
			);

			const kept = move(D2, { occurred_on: "2026-01-15" });
			const second = await answered(kept);
			assert.equal(
				second.text,
				`{"ok":true,"deal_id":"${D2}","field":"phase","next_step_required":true,"prompt":"${PROMPT}","superseded_action_ids":["${id(26)}"],"superseded_post_call_action_ids":[],"old_value":"example","new_value":"later",${second.tail}`,
			);
			const keptEvents = await events(kept.idempotency_key);
			assert.deepEqual(
				keptEvents.map((e) => e.field),
				["phase", "next_action"],
			);
			assert.equal(keptEvents[0].occurred_at, "2026-01-15T18:00:00+00:00");
			assert.notEqual(keptEvents[1].occurred_at, keptEvents[0].occurred_at);

			await db.query(
				`update next_action set status='open' where id='${id(26)}'`,
			);
			const same = move(D2, { base_event_id: keptEvents[0].id });
			const third = await answered(same);
			assert.equal(
				third.text,
				`{"ok":true,"deal_id":"${D2}","field":"phase","old_value":"later","new_value":"later",${third.tail}`,
			);
			assert.equal((await events(same.idempotency_key)).length, 1);
			assert.ok((await open()).includes(id(26)));

			const unplanned = move(D3);
			const fourth = await answered(unplanned);
			assert.equal(
				fourth.text,
				`{"ok":true,"deal_id":"${D3}","field":"phase","superseded_action_ids":[],"superseded_post_call_action_ids":[],"next_step_required":true,"prompt":"${PROMPT}","old_value":"example","new_value":"later",${fourth.tail}`,
			);
			assert.deepEqual(
				(await events(unplanned.idempotency_key)).map((e) => [
					e.field,
					e.old_value,
					e.new_value,
				]),
				[
					["phase", { phase: "example" }, { phase: "later" }],
					[
						"next_date",
						{ next_date: PAST },
						{ next_date: null, superseded_action_ids: [] },
					],
					[
						"next_step",
						{ next_step: null },
						{ next_step: null, superseded_action_ids: [] },
					],
				],
			);
		} finally {
			await db.query(`drop owned by ${role}`);
			await db.query(`drop role ${role}`);
			await db.end();
		}
	}));

test("phase moves refuse blank phases and unusable start dates before any change", () =>
	withSnapshot(async (url) => {
		const db = new pg.Client({ connectionString: url });
		await db.connect();
		try {
			await db.query(seed);
			const tomorrow = new Date(Date.now() + 86_400_000)
				.toISOString()
				.slice(0, 10);
			for (const [extra, error, more] of [
				[{ value: " " }, "invalid_field_value", { fields: ["field"] }],
				[{ occurred_on: tomorrow }, "unhandled_verb_failure", {}],
				[{ occurred_on: "2026-02-30" }, "unhandled_verb_failure", {}],
			] as const) {
				const response = await request(url, move(D1, extra));
				const body = JSON.parse(await response.text());
				assert.equal(response.status, 400);
				assert.deepEqual(body, {
					error,
					correlation_id: body.correlation_id,
					hint: body.hint,
					...more,
				});
			}
			assert.equal(
				(await db.query("select count(*)::int as n from event")).rows[0].n,
				0,
			);
		} finally {
			await db.end();
		}
	}));

test("a phase move takes the next date lock before the phase lock", () =>
	withSnapshot(async (url) => {
		const db = new pg.Client({ connectionString: url });
		const holder = new pg.Client({ connectionString: url });
		await db.connect();
		await holder.connect();
		try {
			await db.query(seed);
			const lock = (field: string) =>
				`hashtextextended('${D1}' || ':' || '${field}', 0)`;
			await holder.query("begin");
			await holder.query(`select pg_advisory_xact_lock(${lock("next_date")})`);
			const pending = request(url, move(D1));
			for (let tries = 0; ; tries++) {
				const { rows } = await db.query(
					"select 1 from pg_locks where locktype='advisory' and not granted",
				);
				if (rows.length) break;
				assert.ok(
					tries < 10_000,
					"the phase move waits for the next date lock",
				);
			}
			assert.deepEqual(
				(
					await db.query(
						`select pg_try_advisory_xact_lock(${lock("phase")}) as free`,
					)
				).rows,
				[{ free: true }],
			);
			await holder.query("commit");
			assert.equal((await pending).status, 200);
		} finally {
			await holder.end();
			await db.end();
		}
	}));
