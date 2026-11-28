import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import pg from "pg";

export class NoDatabase extends Error {}

const dropBatchSize = 16;

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

export async function releaseTestDatabase(name: string) {
	const prefix = process.env.TEST_DATABASE_PREFIX;
	if (!prefix || !name.startsWith(prefix)) {
		await asAdmin(`drop database if exists "${name}" with (force)`);
		return;
	}
	await withAdmin(async (admin) => {
		const { rowCount } = await admin.query(
			"select from pg_database where datname = $1",
			[name],
		);
		if (!rowCount) return;
		await admin.query(`alter database "${name}" allow_connections false`);
		if ((await checkDatabases(admin, prefix, true)).length < dropBatchSize)
			return;

		// Each worker that reaches the limit waits so finished databases cannot pile up.
		await admin.query("select pg_advisory_lock(hashtextextended($1, 0))", [
			prefix,
		]);
		const finished = await checkDatabases(admin, prefix, true);
		if (finished.length >= dropBatchSize)
			await dropDatabases(finished.slice(0, dropBatchSize));
	});
}

export async function withCheckDatabases(
	run: (prefix: string) => Promise<void>,
) {
	const prefix = `engine_${randomBytes(10).toString("hex")}_`;
	try {
		await run(prefix);
	} finally {
		await dropDatabases(
			await withAdmin((admin) => checkDatabases(admin, prefix, false)),
		);
	}
}

async function checkDatabases(
	admin: pg.Client,
	prefix: string,
	finished: boolean,
) {
	const { rows } = await admin.query<{ datname: string }>(
		`select datname from pg_database
		where datname ~ $1 and (not $2::boolean or not datallowconn)`,
		[`^${prefix}[a-f0-9]{32}$`, finished],
	);
	return rows.map(({ datname }) => datname);
}

async function dropDatabases(names: string[]) {
	const failures: unknown[] = [];
	// Concurrent drops can share the checkpoint each drop asks for.
	for (let i = 0; i < names.length; i += dropBatchSize) {
		const results = await Promise.allSettled(
			names
				.slice(i, i + dropBatchSize)
				.map((name) => asAdmin(`drop database "${name}" with (force)`)),
		);
		for (const result of results)
			if (result.status === "rejected") failures.push(result.reason);
	}
	if (failures.length)
		throw new AggregateError(failures, "Test database cleanup failed");
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
		await releaseTestDatabase(name);
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
