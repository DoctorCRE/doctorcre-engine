import { randomBytes, randomUUID } from "node:crypto";
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
async function withAdmin<T>(run: (admin: pg.Client) => Promise<T>) {
	const url = serverUrl();
	const admin = new pg.Client({
		connectionString: url.href,
		application_name: process.env.TEST_DATABASE_PREFIX,
	});
	await admin.connect().catch((error: unknown) => {
		if (!(error instanceof Error && "code" in error)) throw error;
		if (error.code !== "ECONNREFUSED") throw error;
		const port = url.port || "5432";
		throw new NoDatabase(
			`No PostgreSQL server answered at ${url.host}. Start one with: docker run --rm -p 127.0.0.1:${port}:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:18`,
		);
	});
	try {
		return await run(admin);
	} finally {
		await admin.end();
	}
}

export function asAdmin(...statements: string[]) {
	return withAdmin(async (admin) => {
		for (const statement of statements) await admin.query(statement);
	});
}

export function testDatabaseName() {
	const prefix = process.env.TEST_DATABASE_PREFIX;
	if (prefix && !/^engine_[a-f0-9]{20}_$/.test(prefix))
		throw new Error("Invalid test database prefix");
	return (prefix || "engine_test_") + randomUUID().replaceAll("-", "");
}

export function dropTestDatabase(name: string) {
	return asAdmin(`drop database if exists "${name}" with (force)`);
}

export async function withCheckDatabases(run: () => Promise<void>) {
	const prefix = `engine_${randomBytes(10).toString("hex")}_`;
	process.env.TEST_DATABASE_PREFIX = prefix;
	try {
		await run();
	} finally {
		await withAdmin(async (admin) => {
			// A cancelled worker can leave a database creation running on the server.
			while (
				(
					await admin.query(
						`select pg_terminate_backend(pid, 1000) from pg_stat_activity
					where application_name = $1 and pid <> pg_backend_pid()`,
						[prefix],
					)
				).rowCount
			) {}
			const { rows } = await admin.query<{ datname: string }>(
				"select datname from pg_database where datname ~ $1",
				[`^${prefix}[a-f0-9]{32}$`],
			);
			for (const { datname } of rows)
				await admin.query(`drop database if exists "${datname}" with (force)`);
		});
	}
}

// One restore holds about 2,100 locks, so a check's snapshots copy its restore (#237).
export async function withSnapshot(
	run: (url: string, name: string) => Promise<void>,
	template = process.env.TEST_SNAPSHOT,
) {
	const name = testDatabaseName();
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
		await dropTestDatabase(name);
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
