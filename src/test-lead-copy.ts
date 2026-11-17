import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import pg from "pg";
import { asAdmin } from "../scripts/test-database.ts";

export async function leadCopyTest(file: string) {
	const read = (schemaFile: string) =>
		readFile(new URL(`../schema/${schemaFile}`, import.meta.url), "utf8");
	const [schema, attribution, copy] = await Promise.all([
		read("next.sql"),
		read("copy-attribution.sql"),
		read(file),
	]);
	const name = `copy_leads_${randomUUID().replaceAll("-", "")}`;
	const url = new URL(
		process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1/postgres",
	);
	url.pathname = `/${name}`;
	const db = new pg.Client({
		connectionString: url.href,
		options: "-c search_path=next -c TimeZone=UTC",
	});
	const setup = async () => {
		assert.ok(process.env.TEST_SNAPSHOT, "Run npm run check");
		await asAdmin(
			`create database "${name}" template "${process.env.TEST_SNAPSHOT}"`,
		);
		await db.connect();
		await db.query(`create schema next; ${schema}; ${attribution}`);
		await db.query(
			"insert into public.contact_state (slug,label,contactable,sort) values ('active','Example active',true,1)",
		);
	};
	const cleanup = async () => {
		await db.end();
		await asAdmin(`drop database if exists "${name}" with (force)`);
	};
	return { db, copy, setup, cleanup };
}
