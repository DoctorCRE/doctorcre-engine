import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1);
const partner = id(2);
const deal = id(3);
const otherDeal = id(4);
const property = id(5);
const meeting = id(6);
const call = id(7);
const plan = id(8);
const otherPlan = id(9);
const missing = id(99);

const addPlan = (planId: string, dealId = deal) =>
	`insert into tour_plan (id, deal_id, planned_on) values ('${planId}', '${dealId}', '2026-12-01')`;
const addStop = (planId: string, position: number, propertyId = property) =>
	`insert into tour_stop (tour_plan_id, property_id, position) values ('${planId}', '${propertyId}', ${position})`;

for (const migrated of [false, true]) {
	test(
		migrated ? "existing next schema with tour migration" : "fresh tour schema",
		async (t) => {
			const { db, setup, cleanup, connectionString } = copyTest();
			await setup();
			t.after(cleanup);
			if (migrated) {
				await db.query("drop table tour_stop, tour_plan");
			}
			await db.query(`begin; set local engine.job = 'old_system';
			insert into party (id, kind, name) values
				('${owner}', 'person', 'Example One'), ('${partner}', 'person', 'Example Two');
			insert into app_user (id, slug) values ('${owner}', 'joe'), ('${partner}', 'dell');
			insert into deal (id, name, owner_user_id) values
				('${deal}', 'Example Deal', '${owner}'), ('${otherDeal}', 'Example Two', '${partner}');
			insert into property (id, address) values ('${property}', 'Example Property');
			insert into activity (id, kind, happened_at) values
				('${meeting}', 'meeting', now()), ('${call}', 'call', now());
			commit;`);
			const migration = await readSchema("add-tour-plans.sql");
			if (migrated) await db.query(migration);

			await db.query(`set role engine; set engine.user_id = '${owner}'`);
			await assert.rejects(db.query(addPlan(plan, missing)), { code: "23503" });
			await assert.rejects(
				db.query("insert into tour_plan (planned_on) values ('2026-12-01')"),
				{ code: "23502", column: "deal_id" },
			);
			await assert.rejects(
				db.query(`insert into tour_plan (deal_id) values ('${deal}')`),
				{ code: "23502", column: "planned_on" },
			);
			await assert.rejects(db.query(addPlan(plan)), {
				code: "23514",
				constraint: "tour_plan_requires_stop",
			});
			await assert.rejects(db.query(addStop(missing, 1)), { code: "23503" });
			await db.query(
				`${addPlan(plan)}; ${addStop(plan, 1)}; ${addStop(plan, 2)};`,
			);
			if (migrated) {
				await db.query("reset role");
				await db.query(migration);
				await db.query("set role engine");
			}
			await assert.rejects(db.query(addStop(plan, 0)), { code: "23514" });
			await assert.rejects(db.query(addStop(plan, 1)), { code: "23505" });
			await assert.rejects(db.query(addStop(plan, 3, missing)), {
				code: "23503",
			});
			await assert.rejects(
				db.query(
					`insert into tour_stop (tour_plan_id, position) values ('${plan}', 3)`,
				),
				{ code: "23502", column: "property_id" },
			);

			await db.query(`set engine.user_id = '${partner}'`);
			await assert.rejects(db.query("delete from tour_stop"), {
				code: "23514",
				constraint: "tour_plan_requires_stop",
			});
			await db.query(`update tour_plan set notes = 'Bring a floor plan';
			delete from tour_stop; ${addStop(plan, 1)}; ${addStop(plan, 2)};`);

			const {
				rows: [before],
			} = await db.query<{ revision: number }>(
				"select revision from tour_plan",
			);
			assert.ok(before);
			await db.query(`set engine.user_id = '${owner}';
				delete from tour_stop; ${addStop(plan, 2)}; ${addStop(plan, 3)};`);
			await db.query(`set engine.user_id = '${partner}'`);
			const stale = await db.query(
				"update tour_plan set notes = 'Stale edit' where id = $1 and revision = $2",
				[plan, before.revision],
			);
			assert.equal(stale.rowCount, 0);
			const {
				rows: [after],
			} = await db.query<{ revision: number; changed_by_user_id: string }>(
				"select revision, changed_by_user_id from tour_plan",
			);
			assert.ok(after);
			assert.ok(after.revision > before.revision);
			assert.equal(after.changed_by_user_id, owner);

			const other = new pg.Client({
				connectionString,
				options: "-c search_path=next",
			});
			await other.connect();
			try {
				await other.query(`set role engine; set engine.user_id = '${owner}';
				begin isolation level repeatable read; select from tour_stop;`);
				await db.query("delete from tour_stop where position = 3");
				await assert.rejects(
					other.query("delete from tour_stop where position = 2; commit"),
					{ code: "40001" },
				);
			} finally {
				await other.end();
			}

			await db.query("reset role");
			await assert.rejects(
				db.query(`update tour_plan set deal_id = '${otherDeal}'`),
				{ code: "23514", constraint: "tour_plan_same_deal" },
			);
			await db.query("set role engine");
			await assert.rejects(
				db.query(`update tour_plan set completed_activity_id = '${call}'`),
				{ code: "23503" },
			);
			await assert.rejects(
				db.query(
					`update tour_plan set completed_activity_id = '${meeting}', cancelled_at = now()`,
				),
				{ code: "23514", constraint: "tour_plan_one_outcome" },
			);
			await db.query(`update tour_plan set completed_activity_id = '${meeting}';
			${addPlan(otherPlan)}; ${addStop(otherPlan, 2)};`);
			await assert.rejects(
				db.query(
					`update tour_plan set completed_activity_id = '${meeting}' where id = '${otherPlan}'`,
				),
				{ code: "23505" },
			);
			await db.query(
				`update tour_plan set cancelled_at = now() where id = '${otherPlan}'`,
			);
			for (const finalPlan of [plan, otherPlan]) {
				await assert.rejects(db.query(addStop(finalPlan, 3)), {
					code: "23514",
					constraint: "tour_plan_open",
				});
				await assert.rejects(
					db.query(
						`update tour_plan set planned_on = '2026-12-02' where id = '${finalPlan}'`,
					),
					{ code: "23514", constraint: "tour_plan_open" },
				);
			}
			await db.query(
				"reset role; set role engine_reader; reset engine.user_id",
			);
			assert.deepEqual(
				(
					await db.query(`select notes, completed_activity_id, position, property_id
				from tour_plan p join tour_stop s on s.tour_plan_id = p.id where p.id = '${plan}'`)
				).rows,
				[
					{
						notes: "Bring a floor plan",
						completed_activity_id: meeting,
						position: 2,
						property_id: property,
					},
				],
			);
			assert.deepEqual(
				(
					await db.query(`select changed_by_user_id from change where table_name = 'tour_plan'
				and record ->> 'id' = '${otherPlan}' and new_value ? 'cancelled_at' and action = 'update'`)
				).rows,
				[{ changed_by_user_id: partner }],
			);
			await assert.rejects(db.query(addPlan(missing)), { code: "42501" });
		},
	);
}
