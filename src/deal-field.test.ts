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
insert into deal (id,client_id,name,deal_type,phase,created_by,updated_by) values ('${D}','${C}','Example Deal','example','example','${A}','${B}');
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

for (const [field, cases] of [
	[
		"owner",
		[
			[PARTNERS[0], null, PARTNERS[0]],
			[null, PARTNERS[0], null],
		],
	],
	[
		"operating_state",
		[
			[
				{ state: "parked", reason: "other", note: "  Example note  " },
				{ note: null, state: "active", reason: null },
				{ state: "parked", reason: "other", note: "Example note" },
			],
			[
				{ state: "active" },
				{ note: "Example note", state: "parked", reason: "other" },
				{ state: "active", reason: null, note: null },
			],
		],
	],
] as const) {
	test(`${field} saves and replays match the documented old answers`, () =>
		withDeal(async (url, db) => {
			let base: string | null = null;
			for (const [value, old_value, new_value] of cases) {
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
						"select owner,parked_at,parked_by,updated_by from deal where id=$1",
						[D],
					)
				).rows[0];
				assert.equal(row.updated_by, A);
				if (field === "owner") {
					assert.equal(row.owner, value);
					const leads = (
						await db.query(
							"select actor_id from deal_participant where to_at is null",
						)
					).rows;
					assert.deepEqual(leads, value ? [{ actor_id: B }] : []);
				} else {
					assert.ok(new_value && typeof new_value === "object");
					assert.equal(row.parked_by, new_value.state === "parked" ? A : null);
					assert.equal(row.parked_at !== null, new_value.state === "parked");
				}
				base = event.id;
			}
		}));
}

test("owner retries and parking saves use only the existing writer grants", () =>
	withDeal(async (url, db) => {
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
				base_event_id: null,
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
				"1",
			);
			const parking = {
				deal: D,
				field: "operating_state",
				value: { state: "parked", reason: "other", note: " " },
				base_event_id: null,
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
	}));

test("an inactive owner refusal rolls back the lead change and history", () =>
	withDeal(async (url, db) => {
		await db.query("update actor set active=false where id=$1", [B]);
		const refused = await request(url, {
			idempotency_key: randomUUID(),
			deal: D,
			field: "owner",
			value: PARTNERS[0],
			base_event_id: null,
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
			(await db.query("select count(*) from event")).rows[0].count,
			"0",
		);
		assert.deepEqual(
			(
				await db.query(
					"select actor_id from deal_participant where to_at is null",
				)
			).rows,
			[{ actor_id: A }],
		);
		assert.equal(
			(await db.query("select count(*) from tool_call")).rows[0].count,
			"0",
		);
	}));

test("crossed owner edits commit one save and one conflict", () =>
	withDeal(async (url) => {
		const next = {
			deal: D,
			field: "owner",
			value: PARTNERS[0],
			base_event_id: null,
		};
		const crossed = await Promise.all([
			request(url, {
				...next,
				idempotency_key: randomUUID(),
				value: null,
			}),
			request(url, { ...next, idempotency_key: randomUUID() }),
		]);
		const choices = await Promise.all(
			crossed.map(async (r) => JSON.parse(await r.text())),
		);
		assert.equal(choices.filter((b) => b.ok === true).length, 1);
		assert.equal(choices.filter((b) => b.ok === false && b.conflict).length, 1);
	}));

for (const [field, value] of [
	["owner", PARTNERS[0]],
	["operating_state", { state: "parked", reason: "other" }],
] as const) {
	test(`${field} history is stamped after the field lock`, () =>
		withDeal(async (url, db) => {
			const key = randomUUID();
			await db.query("begin");
			await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
				`${D}:${field}`,
			]);
			let saveFinished = false;
			const pending = Promise.resolve(
				request(url, {
					idempotency_key: key,
					deal: D,
					field,
					value,
					base_event_id: null,
				}),
			);
			const finish = () => {
				saveFinished = true;
			};
			void pending.then(finish, finish);

			let stamp: string | undefined;
			try {
				// Restoring or dropping the snapshot can be slow under load.
				const deadline = AbortSignal.timeout(10_000);
				while (!saveFinished && stamp === undefined) {
					deadline.throwIfAborted();
					const { rows } = await db.query<{
						stamp: string;
					}>(`select clock_timestamp()::text as stamp
						from pg_locks
						where locktype = 'advisory' and not granted
						and database = (select oid from pg_database where datname = current_database())
						and pg_backend_pid() = any(pg_blocking_pids(pid))
						limit 1`);
					stamp = rows[0]?.stamp;
				}
			} finally {
				await db.query("rollback");
				await pending;
			}
			const response = await pending;
			assert.equal(response.status, 200, await response.text());
			assert.ok(stamp, "the save must wait for the field lock");
			const { rows } = await db.query<{ after_lock: boolean }>(
				"select recorded_at > $1::timestamptz as after_lock from event where idempotency_key=$2",
				[stamp, key],
			);
			assert.equal(
				rows[0]?.after_lock,
				true,
				"history must be stamped after releasing the field lock",
			);
		}));
}
