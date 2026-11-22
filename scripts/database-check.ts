import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { URL } from "node:url";
import pg from "pg";
import { NoDatabase, withSnapshot } from "./test-database.ts";

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
	const result = spawnSync(command, args, { env, stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(`${command} ${args.join(" ")} failed`);
}

function npmRun(script: string, env: NodeJS.ProcessEnv) {
	run("npm", ["run", script], env);
}

async function loadNextSection(url: string) {
	const db = new pg.Client({
		connectionString: url,
		options: "-c search_path=next",
	});
	await db.connect();
	try {
		const [schema, privacy, attribution] = await Promise.all([
			readFile(new URL("../schema/next.sql", import.meta.url), "utf8"),
			readFile(
				new URL("../schema/add-call-read-policies.sql", import.meta.url),
				"utf8",
			),
			readFile(
				new URL("../schema/copy-attribution.sql", import.meta.url),
				"utf8",
			),
		]);
		await db.query(`alter default privileges revoke execute on functions from public;
			create schema next; ${schema}; ${attribution}`);
		await db.query(privacy);
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
		npmRun("types:db", env);
		await withSnapshot(async (nextUrl, copySnapshot) => {
			await loadNextSection(nextUrl);
			npmRun("types:next", { ...env, DATABASE_URL: nextUrl });
			npmRun("types", env);
			// Small runners can run more files while their tests wait for PostgreSQL.
			const cpus = availableParallelism();
			const concurrency = Math.max(cpus - 1, Math.min(2 * cpus, 6));
			run(
				process.execPath,
				["--test", `--test-concurrency=${concurrency}`, "src/**/*.test.ts"],
				{ ...env, TEST_COPY_SNAPSHOT: copySnapshot },
			);
		}, snapshot);
	}, snapshot),
).catch((error: unknown) => {
	if (!(error instanceof NoDatabase)) throw error;
	console.error(error.message);
	process.exitCode = 1;
});
