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

const stop = new AbortController();
function interrupt(exitCode: number) {
	if (stop.signal.aborted) return;
	process.exitCode = exitCode;
	stop.abort();
}
process.on("SIGINT", () => interrupt(130));
process.on("SIGTERM", () => interrupt(143));

async function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
	stop.signal.throwIfAborted();
	const detached = process.platform !== "win32";
	const child = spawn(command, args, { env, stdio: "inherit", detached });
	const terminate = () => {
		if (!child.pid) return;
		try {
			if (detached) process.kill(-child.pid, "SIGTERM");
			else child.kill("SIGTERM");
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ESRCH")
			)
				throw error;
		}
	};
	stop.signal.addEventListener("abort", terminate, { once: true });
	try {
		const [status] = await once(child, "close");
		stop.signal.throwIfAborted();
		if (status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
	} finally {
		stop.signal.removeEventListener("abort", terminate);
	}
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

await withCheckDatabases(() =>
	// Nothing connects to the outer snapshot, so it can serve as the template.
	withSnapshot((_, snapshot) =>
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
				const concurrency = Math.max(cpus - 1, Math.min(2 * cpus, 6));
				// Both commands must finish before the snapshots are dropped.
				const results = await Promise.allSettled([
					npmRun("types", env),
					run(
						process.execPath,
						["--test", `--test-concurrency=${concurrency}`, "src/**/*.test.ts"],
						{ ...env, TEST_COPY_SNAPSHOT: copySnapshot },
					),
				]);
				for (const result of results) {
					if (result.status === "rejected") throw result.reason;
				}
			}, snapshot);
		}, snapshot),
	),
).catch((error: unknown) => {
	if (stop.signal.aborted && error === stop.signal.reason) return;
	if (!(error instanceof NoDatabase)) throw error;
	console.error(error.message);
	process.exitCode = 1;
});
