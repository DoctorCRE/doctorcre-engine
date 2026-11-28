import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import pg from "pg";
import {
	asAdmin,
	releaseTestDatabase,
	testDatabaseName,
} from "../scripts/test-database.ts";

export function readSchema(file: string): Promise<string> {
	return readFile(new URL(`../schema/${file}`, import.meta.url), "utf8");
}

export function copyTest() {
	const name = testDatabaseName();
	const url = new URL(
		process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1/postgres",
	);
	url.pathname = `/${name}`;
	const db = new pg.Client({
		connectionString: url.href,
		options: "-c search_path=next -c TimeZone=UTC",
	});
	const setup = async () => {
		const template = process.env.TEST_COPY_SNAPSHOT;
		assert.ok(template, "Run npm run check");
		await asAdmin(
			`create database "${name}" template "${template}"`,
			// Compiling the copy queries costs more than running them on small fixtures.
			`alter database "${name}" set jit = off`,
		);
		await db.connect();
	};
	const cleanup = async () => {
		await db.end();
		await releaseTestDatabase(name);
	};
	return { db, setup, cleanup, connectionString: url.href };
}
