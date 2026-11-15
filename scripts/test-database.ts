import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import pg from "pg";

export class NoDatabase extends Error {}

// Restoring business.sql holds about 2,100 locks in one transaction, so
// concurrent restores exhaust the server's lock table. A check restores it
// once and every snapshot inside the check copies that database instead.
export async function withSnapshot(
	run: (url: string, name: string) => Promise<void>,
	template = process.env.TEST_SNAPSHOT,
) {
	const url = new URL(
		process.env.TEST_DATABASE_URL ??
			"postgres://postgres@127.0.0.1:5432/postgres",
	);
	if (
		!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
		url.search
	) {
		throw new Error(
			"TEST_DATABASE_URL must identify a local throwaway PostgreSQL server without query parameters",
		);
	}
	const admin = new pg.Client({ connectionString: url.href });
	await admin.connect().catch((error: unknown) => {
		if (!(error instanceof Error && "code" in error)) throw error;
		if (error.code !== "ECONNREFUSED") throw error;
		const port = url.port || "5432";
		throw new NoDatabase(
			`No PostgreSQL server answered at ${url.host}. Start one with: docker run --rm -p 127.0.0.1:${port}:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:18`,
		);
	});
	const name = `engine_test_${randomUUID().replaceAll("-", "")}`;
	try {
		await admin.query(
			`CREATE DATABASE "${name}" TEMPLATE "${template ?? "template0"}"`,
		);
		// The server's own zone must not shape a test; a non-UTC one makes a
		// missing UTC pin fail on every server.
		await admin.query(
			`ALTER DATABASE "${name}" SET TimeZone = 'America/Chicago'`,
		);
		url.pathname = `/${name}`;
		if (!template) await restore(url.href);
		await run(url.href, name);
	} finally {
		await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
		await admin.end();
	}
}

async function restore(url: string) {
	const db = new pg.Client({ connectionString: url });
	await db.connect();
	try {
		await db.query(
			await readFile(
				new URL("../schema/business.sql", import.meta.url),
				"utf8",
			),
		);
	} finally {
		await db.end();
	}
}
