import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { URL } from "node:url";
import pg from "pg";
import {
	NoDatabase,
	withCheckDatabases,
	withSnapshot,
} from "./test-database.ts";

async function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
	const child = spawn(command, args, { env, stdio: "inherit" });
	const [status] = await once(child, "close");
	if (status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

function npmRun(script: string, env: NodeJS.ProcessEnv) {
	return run("npm", ["run", script], env);
}

async function loadNextSection(url: string) {
	const db = new pg.Client({
		connectionString: url,
		options: "-c search_path=next",
	});
	await db.connect();
	try {
		const [schema, attribution] = await Promise.all([
			readFile(new URL("../schema/next.sql", import.meta.url), "utf8"),
			readFile(
				new URL("../schema/copy-attribution.sql", import.meta.url),
				"utf8",
			),
		]);
		// Auth migrations in separate databases share this role.
		await db.query(`alter default privileges revoke execute on functions from public;
			create schema next; ${schema}; ${attribution};
			do $$ begin
				create role engine_partner_auth nologin;
			exception when duplicate_object or unique_violation then null;
			end $$`);
	} finally {
		await db.end();
	}
}

// Nothing connects to the outer snapshot, so it can serve as the template.
await withSnapshot((_, snapshot) =>
	withSnapshot(async (url) => {
		const env = {
			...process.env,
			DATABASE_URL: url,
			TEST_DATABASE_URL: url,
			TEST_SNAPSHOT: snapshot,
		};
		await npmRun("types:db", env);
		await withSnapshot(async (nextUrl, copySnapshot) => {
			await loadNextSection(nextUrl);
			await npmRun("types:next", { ...env, DATABASE_URL: nextUrl });
			// Small runners can run more files while their tests wait for PostgreSQL.
			const cpus = availableParallelism();
			const concurrency = Math.min(
				8,
				Math.max(cpus - 1, Math.min(2 * cpus, 6)),
			);
			await withCheckDatabases(async (prefix) => {
				// Both commands must finish before the snapshots are dropped.
				const results = await Promise.allSettled([
					npmRun("types", env),
					run(
						process.execPath,
						["--test", `--test-concurrency=${concurrency}`, "src/**/*.test.ts"],
						{
							...env,
							TEST_COPY_SNAPSHOT: copySnapshot,
							TEST_DATABASE_PREFIX: prefix,
						},
					),
				]);
				for (const result of results) {
					if (result.status === "rejected") throw result.reason;
				}
			});
		}, snapshot);
	}, snapshot),
).catch((error: unknown) => {
	if (!(error instanceof NoDatabase)) throw error;
	console.error(error.message);
	process.exitCode = 1;
});
