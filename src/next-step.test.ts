import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { withSnapshot } from "../scripts/test-database.ts";
import worker from "./worker.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [A, B, C] = [id(1), id(2), id(4)];
const [D1, D2, D3, D4] = [id(11), id(12), id(13), id(14)];
const PAST = "2020-01-01";
const LATER = "2999-01-01";
const NEW = "2999-02-01";
const origin = "https://app.example.test";

const seed = `insert into actor (id,slug,kind,display_name) values
('${A}','partner_one','human','Example Partner'),('${B}','partner_two','human','Other Partner');
insert into contact_state (slug,label,contactable,sort) values ('active','Example',true,1);
insert into deal_type_ref (slug,label,sort) values ('example','Example',1);
insert into deal_phase (slug,label) values ('example','Example');
with p as (insert into party (kind,name,created_by,updated_by) values ('org','Example Clinic','${A}','${A}') returning id)
insert into client (id,party_id,created_by,updated_by) select '${C}',id,'${A}','${A}' from p;
insert into deal (id,client_id,name,deal_type,phase,owner,next_date,created_by,updated_by)
select d,'${C}','Example Deal','example','example','partner_one',n,'${A}','${A}'
from (values ('${D1}'::uuid,'${PAST}'::date),('${D2}',null),('${D3}','${PAST}'),('${D4}','${PAST}')) v(d,n);
insert into deal_note (id,deal_id,kind,text,actor_id,created_at) values
('${id(51)}','${D1}','next_step','Example prior step','${B}','2026-01-01');
insert into next_action (id,subject_type,subject_id,owner_id,due_on,description,created_by,updated_at,item_title,source_ref) values
('${id(21)}','deal','${D1}','${A}','${PAST}','Example overdue step','${A}','2026-01-03',null,null),
('${id(23)}','deal','${D1}','${B}','${LATER}','Example later step','${B}','2026-01-02',null,null),
('${id(24)}','deal','${D1}','${A}','${PAST}','Example step','${A}','2026-01-01','Example checklist item','example:1'),
('${id(25)}','deal','${D2}','${B}','${LATER}','Example current step','${B}','2026-01-03',null,null),
('${id(26)}','deal','${D2}','${A}','${LATER}','Example own step','${A}','2026-01-01',null,null),
('${id(27)}','deal','${D3}','${A}','${PAST}','Example assessed step','${A}','2026-01-01',null,null),
('${id(28)}','deal','${D4}','${A}','${PAST}','Example pending step','${A}','2026-01-01',null,null);
insert into event (occurred_at,actor_id,verb,subject_type,subject_id,field,new_value,cause) values
(now(),'${A}','example-verb','deal','${D3}','overdue_assessment','{"action":{"id":"${id(27)}"},"resolved":false}','automation_job'),
(now(),'${A}','example-verb','deal','${D4}','overdue_assessment_pending','{"actions":[{"id":"${id(28)}","source":"next_action"}]}','automation_job');
insert into capture_session (id,nonce,device_id,actor_id,mode,started_at,consent_announced_at,session_token_hash,expires_at,state_at)
values ('${id(30)}','example-nonce','example-device','${A}','meeting','2025-01-01','2025-01-01','example-hash','2025-01-02','2025-01-01');
insert into capture_post_call_candidate (id,session_id,idempotency_key,batch_hash,item_index,kind,deal_id,assignee_slug,action_description,evidence_quote,confidence)
select v,'${id(30)}',v::text,'example-batch',row_number() over () - 1,'assigned_action','${D1}','partner_one','Example action','Example evidence',1
from unnest(array['${id(31)}','${id(32)}']::uuid[]) v;
insert into capture_post_call_action (id,candidate_id,deal_id,owner_id,due_on,description,accepted_by,item_title,source_ref) values
('${id(41)}','${id(31)}','${D1}','${A}','${PAST}','Example post-call step','${A}',null,null),
('${id(42)}','${id(32)}','${D1}','${B}','${PAST}','Example other post-call','${B}',null,null);`;

const request = (url: string, args: object) =>
	worker.request(
		`${origin}/api/engine/set-next-step`,
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

const step = (deal: string, extra: object = {}) => ({
	idempotency_key: randomUUID(),
	deal,
	text: "  Example new step  ",
	base_version: 1,
	next_date: NEW,
	...extra,
});

const withDeals = (run: (url: string, db: pg.Client) => Promise<void>) =>
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

test("a new next step replaces the partner's steps, keeps the old one as history and matches the old answers", () =>
	withDeals(async (url, db) => {
		const role = `writer_${randomUUID().replaceAll("-", "")}`;
		try {
			await db.query(`create role ${role} login noinherit`);
			for (const grant of [
				"select on actor,event,deal,deal_note,v_ref_index,next_action,capture_post_call_action,v_deal_room_board,v_deal_current_action",
				"select (idempotency_key,request_hash,response,created_at) on tool_call",
				"insert (idempotency_key,verb,actor_id,request_hash,response,via,client_id,organization_tenant_id,sponsoring_human_slug,personal_scope,authorization_class,correlation_id) on tool_call",
				"insert (actor_id,agent_rationale,authorization_class,cause,client_id,correlation_id,field,human_quote,idempotency_key,new_value,occurred_at,old_value,organization_tenant_id,personal_scope,recorded_at,sponsoring_human_slug,subject_id,subject_type,verb,via) on event",
				"insert (actor_id,created_at,deal_id,kind,text) on deal_note",
				"insert (created_by,description,due_on,owner_id,status,subject_id,subject_type,updated_at,updated_by) on next_action",
				"update (next_date,updated_by) on deal",
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
			const changes = async (key: string) => {
				const { rows } = await db.query({
					text: "select field,old_value,new_value from event where idempotency_key=$1",
					values: [key],
					rowMode: "array",
				});
				return new Set(rows);
			};
			// The whole answer, built from what the save wrote, then its replay.
			const answered = async (
				args: { idempotency_key: string; deal: string },
				supersedes: string | null,
			) => {
				const response = await request(login.href, args);
				const text = await response.text();
				assert.equal(response.status, 200, text);
				const { rows } = await db.query(
					`select n.id as note, to_jsonb(n.created_at)#>>'{}' as created_at, a.id as action
					from deal_note n join next_action a on a.subject_id=n.deal_id and a.description=n.text
					where n.deal_id=$1 and n.actor_id=$2`,
					[args.deal, A],
				);
				const [made] = rows;
				assert.equal(
					text,
					JSON.stringify({
						ok: true,
						deal_id: args.deal,
						next_step_id: made.note,
						next_action_id: made.action,
						supersedes,
						created_at: made.created_at,
					}),
				);
				const receipt = await db.query(
					"select response from tool_call where idempotency_key=$1",
					[args.idempotency_key],
				);
				assert.equal(
					await (await request(login.href, args)).text(),
					JSON.stringify({ replayed: true, ...receipt.rows[0].response }),
				);
				return made.action as string;
			};
			const open = async () =>
				(
					await db.query(
						"select id from next_action where status='open' union all select id from capture_post_call_action where status='open' order by id",
					)
				).rows.map((r) => r.id);
			const ids = (...n: number[]) => JSON.stringify(n.map(id));

			const replaced = step(D1);
			const made = await answered(replaced, id(51));
			assert.deepEqual(
				await changes(replaced.idempotency_key),
				new Set(
					JSON.parse(`[
					["next_action",{"actions":[{"id":"${id(21)}","description":"Example overdue step","due_on":"${PAST}"},{"id":"${id(41)}","description":"Example post-call step","due_on":"${PAST}"}]},{"superseded_action_ids":${ids(21, 41)},"status":"dropped"}],
					["next_date",{"next_date":"${PAST}"},{"next_date":"${LATER}","superseded_action_ids":${ids(21, 41)}}],
					["next_step",{"next_step":"Example overdue step"},{"next_step":"Example later step","superseded_action_ids":${ids(21, 41)}}],
					["next_step",{"next_step":"Example prior step","board_next_step":"Example later step","board_next_action_id":"${id(23)}"},{"next_step":"Example new step","next_date":"${NEW}","next_action_id":"${made}","replaced_action_ids":[]}],
					["next_date",{"next_date":"${LATER}"},{"next_date":"${NEW}"}]]`),
				),
			);
			const { rows } = await db.query(
				"select next_date::text, (select count(*)::int from deal_note where deal_id=$1) as notes from deal where id=$1",
				[D1],
			);
			assert.deepEqual(rows, [{ next_date: NEW, notes: 2 }]);

			const undated = step(D2, { text: "Example call back", next_date: null });
			const call = await answered(undated, null);
			assert.deepEqual(
				await changes(undated.idempotency_key),
				new Set(
					JSON.parse(`[
					["next_step",{"next_step":null,"board_next_step":"Example current step","board_next_action_id":"${id(25)}"},{"next_step":"Example call back","next_date":null,"next_action_id":"${call}","replaced_action_ids":${ids(26)}}],
					["next_date",{"next_date":null},{"next_date":null}]]`),
				),
			);
			assert.deepEqual(
				await open(),
				[...[23, 24, 25, 27, 28, 42].map(id), made, call].sort(),
			);
		} finally {
			await db.query(`drop owned by ${role}`);
			await db.query(`drop role ${role}`);
		}
	}));

test("a next step refuses a stale version, blank text and bad dates, and takes the next date lock before the next step lock", () =>
	withDeals(async (url, db) => {
		for (const [extra, status, error, more] of [
			[{ base_version: 0 }, 409, "version_conflict", { current_version: 1 }],
			[{ text: " " }, 400, "unhandled_verb_failure", {}],
			[
				{ next_date: "2999-2-1" },
				400,
				"invalid_field_value",
				{ fields: ["next_date"] },
			],
			[{ next_date: 5 }, 400, "invalid_field_value", { fields: ["next_date"] }],
			// The held step is kept, so the partner's new open step collides with it.
			[{ deal: D3 }, 400, "database_refused_the_statement", {}],
			[{ deal: D4 }, 400, "database_refused_the_statement", {}],
		] as const) {
			const response = await request(url, step(D1, extra));
			const { correlation_id, hint, ...body } = JSON.parse(
				await response.text(),
			);
			assert.equal(response.status, status);
			assert.ok(correlation_id && hint);
			assert.deepEqual(body, { error, ...more });
		}
		const { rows: written } = await db.query(
			"select (select count(*)::int from event where verb='set-next-step') as events, (select count(*)::int from deal_note) as notes",
		);
		assert.deepEqual(written, [{ events: 0, notes: 1 }]);
		const held = await db.query(
			"select status from next_action where id = any($1::uuid[])",
			[[id(27), id(28)]],
		);
		assert.deepEqual(held.rows, [{ status: "open" }, { status: "open" }]);

		const holder = new pg.Client({ connectionString: url });
		await holder.connect();
		try {
			const lock = (field: string) =>
				`hashtextextended('${D1}' || ':' || '${field}', 0)`;
			await holder.query("begin");
			await holder.query(`select pg_advisory_xact_lock(${lock("next_date")})`);
			const pending = request(url, step(D1));
			for (let tries = 0; ; tries++) {
				const { rows } = await db.query(
					"select 1 from pg_locks where locktype='advisory' and not granted",
				);
				if (rows.length) break;
				assert.ok(tries < 10_000, "the save waits for the next date lock");
			}
			const free = `select pg_try_advisory_xact_lock(${lock("next_step")}) as free`;
			assert.deepEqual((await db.query(free)).rows, [{ free: true }]);
			await holder.query("commit");
			assert.equal((await pending).status, 200);
		} finally {
			await holder.end();
		}
	}));
