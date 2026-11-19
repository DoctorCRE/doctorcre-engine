import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import pg from "pg";
import { asAdmin } from "../scripts/test-database.ts";

export const readSchema = (file: string) =>
	readFile(new URL(`../schema/${file}`, import.meta.url), "utf8");

export function copyTest() {
	const name = `copy_${randomUUID().replaceAll("-", "")}`;
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
		const [schema, attribution] = await Promise.all([
			readSchema("next.sql"),
			readSchema("copy-attribution.sql"),
		]);
		await asAdmin(
			`create database "${name}" template "${process.env.TEST_SNAPSHOT}"`,
		);
		await db.connect();
		await db.query(`alter default privileges revoke execute on functions from public;
			create schema next; ${schema}; ${attribution}`);
	};
	const cleanup = async () => {
		await db.end();
		await asAdmin(`drop database if exists "${name}" with (force)`);
	};
	return { db, setup, cleanup, connectionString: url.href };
}
