import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import pg from "pg";

export class NoDatabase extends Error {}

function serverUrl() {
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
	return url;
}

// Parallel test processes need the connection slots while tests run (#241).
export async function asAdmin(...statements: string[]) {
	const url = serverUrl();
	const admin = new pg.Client({ connectionString: url.href });
	await admin.connect().catch((error: unknown) => {
		if (!(error instanceof Error && "code" in error)) throw error;
		if (error.code !== "ECONNREFUSED") throw error;
		const port = url.port || "5432";
		throw new NoDatabase(
			`No PostgreSQL server answered at ${url.host}. Start one with: docker run --rm -p 127.0.0.1:${port}:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:18`,
		);
	});
	try {
		for (const statement of statements) await admin.query(statement);
	} finally {
		await admin.end();
	}
}

// One restore holds about 2,100 locks, so a check's snapshots copy its restore (#237).
export async function withSnapshot(
	run: (url: string, name: string) => Promise<void>,
	template = process.env.TEST_SNAPSHOT,
) {
	const name = `engine_test_${randomUUID().replaceAll("-", "")}`;
	const url = serverUrl();
	url.pathname = `/${name}`;
	try {
		await asAdmin(
			`CREATE DATABASE "${name}" TEMPLATE "${template ?? "template0"}"`,
			// The server's own zone must not shape a test; a non-UTC one makes a
			// missing UTC pin fail on every server.
			`ALTER DATABASE "${name}" SET TimeZone = 'America/Chicago'`,
		);
		if (!template) await restore(url.href);
		await run(url.href, name);
	} finally {
		await asAdmin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
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
