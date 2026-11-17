import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { withSnapshot } from "../scripts/test-database.ts";
import { Refusal } from "./answer.ts";
import type { JsonObject } from "./database.d.ts";
import { addDealUpdate } from "./deal-update.ts";
import { runSave } from "./save.ts";
import worker from "./worker.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [A, B, C, D1, D2] = [id(1), id(2), id(4), id(11), id(12)];
const PAST = "2020-01-01";
const LATER = "2999-01-01";
const NEW = "2999-02-01";

// D1's newest open step is A's, so it is due on the deal's past next date.
// A step due today is not overdue yet.
const seed = `insert into actor (id,slug,kind,display_name) values
('${A}','partner_one','human','Example Partner'),('${B}','partner_two','human','Other Partner');
insert into contact_state (slug,label,contactable,sort) values ('active','Example',true,1);
insert into deal_type_ref (slug,label,sort) values ('example','Example',1);
insert into deal_phase (slug,label) values ('example','Example');
with p as (insert into party (kind,name,created_by,updated_by) values ('org','Example Clinic','${A}','${A}') returning id)
insert into client (id,party_id,created_by,updated_by) select '${C}',id,'${A}','${A}' from p;
insert into deal (id,client_id,name,deal_type,phase,owner,next_date,created_by,updated_by)
select d,'${C}','Example Deal','example','example','partner_one',n,'${A}','${A}'
from (values ('${D1}'::uuid,'${PAST}'::date),('${D2}',null)) v(d,n);
insert into next_action (id,subject_type,subject_id,owner_id,due_on,description,created_by,updated_at,item_title,source_ref) values
('${id(21)}','deal','${D1}','${A}','${LATER}','Example current step','${A}','2026-01-03',null,null),
('${id(22)}','deal','${D1}','${B}','${PAST}','Example other step','${B}','2026-01-02',null,null),
('${id(24)}','deal','${D1}','${A}','${PAST}','Example step','${A}','2026-01-01','Example checklist item','example:1'),
('${id(25)}','deal','${D2}','${B}','${LATER}','Example current step','${B}','2026-01-03',null,null),
('${id(26)}','deal','${D2}','${A}',current_date,'Example own step','${A}','2026-01-01',null,null);
insert into capture_session (id,nonce,device_id,actor_id,mode,started_at,consent_announced_at,session_token_hash,expires_at,state_at)
values ('${id(30)}','example-nonce','example-device','${A}','meeting','2025-01-01','2025-01-01','example-hash','2025-01-02','2025-01-01');
insert into capture_post_call_candidate (id,session_id,idempotency_key,batch_hash,item_index,kind,deal_id,assignee_slug,action_description,evidence_quote,confidence)
select v,'${id(30)}',v::text,'example-batch',row_number() over () - 1,'assigned_action','${D1}','partner_one','Example action','Example evidence',1
from unnest(array['${id(31)}','${id(32)}']::uuid[]) v;
insert into capture_post_call_action (id,candidate_id,deal_id,owner_id,due_on,description,accepted_by,updated_at,item_title,source_ref) values
('${id(41)}','${id(31)}','${D1}','${A}','${PAST}','Example post-call step','${A}','2026-01-04',null,null),
('${id(42)}','${id(32)}','${D1}','${B}','${PAST}','Example other post-call','${B}','2026-01-04',null,null);`;

// The writer grants a deal update needs, and nothing else.
async function writerLogin(db: pg.Client, url: string, role: string) {
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
		"execute on function carr_business_date(timestamptz),carr_is_partner_actor(uuid),carr_is_partner_made(uuid,text)",
	])
		await db.query(`grant ${grant} to ${role}`);
	await db.query(
		"revoke execute on function carr_business_date(timestamptz),carr_is_partner_actor(uuid),carr_is_partner_made(uuid,text) from public",
	);
	const login = new URL(url);
	login.username = role;
	return login;
}

const origin = "https://app.example.test";

const request = (url: string, args: JsonObject) =>
	worker.request(
		`${origin}/api/engine/add-deal-note`,
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

const save = (url: string, args: JsonObject) =>
	runSave(
		url,
		{
			partner: "partner_one",
			verb: "add-deal-note",
			args,
			correlation_id: randomUUID(),
		},
		addDealUpdate,
	);

const update = (deal: string, extra: JsonObject = {}) => ({
	idempotency_key: randomUUID(),
	deal,
	text: "  Example update  ",
	...extra,
});

const withDeals = (run: (url: string, db: pg.Client) => Promise<void>) =>
	withSnapshot(async (url) => {
		const db = new pg.Client({ connectionString: url });
		await db.connect();
		try {
			await db.query("set timezone='UTC'");
			await db.query(seed);
			await run(url, db);
		} finally {
			await db.end();
		}
	});

test("a deal update holds the partner's overdue work for checking and matches the old answers and events", () =>
	withDeals(async (url, db) => {
		const role = `writer_${randomUUID().replaceAll("-", "")}`;
		try {
			const login = await writerLogin(db, url, role);
			const changes = async (key: string) =>
				(
					await db.query(
						"select verb,field,old_value,new_value from event where idempotency_key=$1 order by recorded_at,id",
						[key],
					)
				).rows.map((e) => [e.verb, e.field, e.old_value, e.new_value]);
			// The whole answer, built from what the save wrote, then its replay.
			const answered = async (
				args: JsonObject,
				rest: () => Promise<JsonObject>,
			) => {
				const answer = JSON.stringify(await save(login.href, args));
				const { rows } = await db.query(
					"select id, created_at from deal_note where deal_id=$1 and kind='note'",
					[args.deal],
				);
				const [note] = rows;
				assert.equal(
					answer,
					JSON.stringify({
						ok: true,
						deal_id: args.deal,
						note_id: note.id,
						created_at: note.created_at,
						...(await rest()),
					}),
				);
				const receipt = await db.query(
					"select response from tool_call where idempotency_key=$1",
					[args.idempotency_key],
				);
				assert.equal(
					JSON.stringify(await save(login.href, args)),
					JSON.stringify({ replayed: true, ...receipt.rows[0].response }),
				);
				return note.id as string;
			};
			const held = update(D1);
			const note = await answered(held, async () => ({
				next_step_required: false,
				overdue_assessment: {
					pending: true,
					reason: "awaiting_assessment",
					items: [],
				},
				preserved_action_ids: [id(21)],
			}));
			const actions = [
				{
					id: id(21),
					source: "next_action",
					description: "Example current step",
					version: 1,
					updated_at: "2026-01-03 00:00:00+00",
					due_on: PAST,
				},
				{
					id: id(41),
					source: "post_call_action",
					description: "Example post-call step",
					version: null,
					updated_at: "2026-01-04 00:00:00+00",
					due_on: PAST,
				},
			];
			const fromNote = { note_id: note, update: "Example update" };
			assert.deepEqual(await changes(held.idempotency_key), [
				["add-deal-note", "note", null, { note: "Example update" }],
				[
					"add-deal-note",
					"overdue_assessment_pending",
					null,
					{ ...fromNote, actions },
				],
				...actions.map((action) => [
					"add-deal-note",
					"overdue_assessment_fallback",
					null,
					{
						action,
						...fromNote,
						resolved: false,
						review_required: true,
						verdict: "unavailable",
						reason: "awaiting_assessment",
					},
				]),
			]);

			// The board had no date, so the old prompt stays beside the new step.
			const planned = update(D2, {
				next_step: " Example plan ",
				next_date: NEW,
			});
			let step = { id: "", action: "" };
			await answered(planned, async () => {
				const { rows } = await db.query(
					"select n.id, a.id as action from deal_note n join next_action a on a.subject_id=n.deal_id and a.description=n.text where n.deal_id=$1 and n.kind='next_step'",
					[D2],
				);
				[step] = rows;
				return {
					preserved_action_ids: [],
					next_step_required: false,
					prompt:
						"Doc needs the new next step and date for this deal. Use set-next-step to record both.",
					next_step_id: step.id,
					next_action_id: step.action,
				};
			});
			assert.deepEqual(await changes(planned.idempotency_key), [
				["add-deal-note", "note", null, { note: "Example update" }],
				[
					"set-next-step",
					"next_step",
					{
						next_step: null,
						board_next_step: "Example current step",
						board_next_action_id: id(25),
					},
					{
						next_step: "Example plan",
						next_date: NEW,
						next_action_id: step.action,
						replaced_action_ids: [id(26)],
					},
				],
				["set-next-step", "next_date", { next_date: null }, { next_date: NEW }],
			]);
			const { rows: open } = await db.query(
				"select id from next_action where status='open' union all select id from capture_post_call_action where status='open' order by id",
			);
			assert.deepEqual(
				open.map((r) => r.id),
				[...[21, 22, 24, 25, 41, 42].map(id), step.action].sort(),
			);
		} finally {
			await db.query(`drop owned by ${role}`);
			await db.query(`drop role ${role}`);
		}
	}));

test("a deal update refuses blank text, a half plan and a client, and its plan cannot replace a held step", () =>
	withDeals(async (url, db) => {
		for (const extra of [
			{ text: " " },
			{ next_step: "Example plan" },
			{ next_date: NEW },
			{ next_step: " ", next_date: NEW },
			{ next_step: "Example plan", next_date: "2999-02-30" },
		])
			await assert.rejects(save(url, update(D2, extra)), {
				refusal: new Refusal(400, "unhandled_verb_failure"),
			});
		await assert.rejects(save(url, update(C)), {
			refusal: new Refusal(422, "not_a_deal"),
		});
		// The held step stays open, so the partner's new open step collides with it.
		await assert.rejects(
			save(url, update(D1, { next_step: "Example plan", next_date: NEW })),
			{ code: "23505" },
		);
		const { rows } = await db.query(
			"select (select count(*)::int from event) as events, (select count(*)::int from deal_note) as notes",
		);
		assert.deepEqual(rows, [{ events: 0, notes: 0 }]);
	}));

test("a deal update sent to the engine is saved and replayed as the old writer answered it", () =>
	withDeals(async (url, db) => {
		const role = `writer_${randomUUID().replaceAll("-", "")}`;
		try {
			const login = (await writerLogin(db, url, role)).href;
			const plain = update(D2);
			const response = await request(login, plain);
			const text = await response.text();
			assert.equal(response.status, 200, text);
			const { rows } = await db.query(
				"select id, created_at from deal_note where deal_id=$1",
				[D2],
			);
			assert.equal(
				text,
				JSON.stringify({
					ok: true,
					deal_id: D2,
					note_id: rows[0].id,
					created_at: rows[0].created_at,
					preserved_action_ids: [],
					next_step_required: true,
					prompt:
						"Doc needs the new next step and date for this deal. Use set-next-step to record both.",
				}),
			);
			const receipt = await db.query(
				"select response from tool_call where idempotency_key=$1",
				[plain.idempotency_key],
			);
			assert.equal(
				await (await request(login, plain)).text(),
				JSON.stringify({ replayed: true, ...receipt.rows[0].response }),
			);
			const events = await db.query(
				"select verb, field, old_value, new_value from event",
			);
			assert.deepEqual(events.rows, [
				{
					verb: "add-deal-note",
					field: "note",
					old_value: null,
					new_value: { note: "Example update" },
				},
			]);
			const reused = await request(login, { ...plain, text: "Other update" });
			assert.equal(reused.status, 409);
			assert.equal(JSON.parse(await reused.text()).error, "key_reuse");
		} finally {
			await db.query(`drop owned by ${role}`);
			await db.query(`drop role ${role}`);
		}
	}));

test("a deal update sent to the engine refuses as the old writer did, and one with overdue work goes back to the old system unwritten", () =>
	withDeals(async (url, db) => {
		for (const [args, status, error, more] of [
			[update(D1), 501, "old_system_required", {}],
			// The held step is kept, so the partner's new open step collides with it.
			[
				update(D1, { next_step: "Example plan", next_date: NEW }),
				400,
				"database_refused_the_statement",
				{},
			],
			[update(D2, { text: " " }), 400, "unhandled_verb_failure", {}],
			[update(D2, { next_date: NEW }), 400, "unhandled_verb_failure", {}],
			[update(C), 422, "not_a_deal", {}],
			[update(id(99)), 404, "unhandled_verb_failure", {}],
			[
				{ idempotency_key: randomUUID(), deal: D2 },
				400,
				"missing_required",
				{ fields: ["text"] },
			],
			[
				update(D2, { base_version: 1 }),
				400,
				"unregistered_operation_fields",
				{ fields: ["base_version"] },
			],
			[
				update(D2, { idempotency_key: "example" }),
				400,
				"invalid_idempotency_key",
				{ fields: ["idempotency_key"] },
			],
		] as const) {
			const response = await request(url, args);
			const { correlation_id, hint, ...body } = JSON.parse(
				await response.text(),
			);
			assert.equal(response.status, status, error);
			assert.ok(correlation_id && hint);
			assert.deepEqual(body, { error, ...more });
		}
		const { rows } = await db.query(
			`select (select count(*)::int from event) as events, (select count(*)::int from deal_note) as notes,
			(select count(*)::int from tool_call) as receipts,
			(select count(*)::int from next_action where status='open') as open,
			(select next_date::text from deal where id=$1) as next_date`,
			[D1],
		);
		assert.deepEqual(rows, [
			{ events: 0, notes: 0, receipts: 0, open: 5, next_date: PAST },
		]);
	}));
