import type pg from "pg";
import { readSchema } from "../test-copy.ts";

export async function seedAgenda(db: pg.Client, snapshot: object) {
	await db.query(
		`create schema next; set search_path = next; ${await readSchema("next.sql")}`,
	);
	await db.query(
		`set session_replication_role = origin; begin;
		select set_config('engine.job', 'old_system', true);
		with p as (insert into party (kind, name) values ('person', 'Example User') returning id)
		insert into app_user (id, slug) select id, 'partner_one' from p;`,
	);
	await db.query(
		`insert into calendar_agenda (user_id, observed_at, snapshot)
		select id, ($1::json->>'observed_at')::timestamptz, $1::json from app_user`,
		[JSON.stringify(snapshot)],
	);
	await db.query("commit; set search_path = public");
}
