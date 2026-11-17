import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createTestHarness } from "wrangler";

test("R2 stores a length-bounded file, verifies its hash, and accepts retries and races", async () => {
	const dir = await mkdtemp(join(tmpdir(), "attachment-r2-"));
	const main = join(dir, "worker.ts");
	await writeFile(
		main,
		`import { storeFile } from ${JSON.stringify(new URL("./post-media.ts", import.meta.url).pathname)};
 export default { async fetch(request, env) {
  const hash = new URL(request.url).pathname.slice(1);
  try {
   const result = await storeFile(env.FILES, hash, request.body, Number(request.headers.get('content-length')));
   return Response.json({result, stored: !!await env.FILES.head('sha256/' + hash)});
  } catch (error) { return Response.json({error: error.message}, {status: 500}); }
 }};`,
	);
	const server = createTestHarness({
		workers: [
			{
				config: {
					name: "attachment-test",
					main,
					compatibility_date: "2026-11-11",
					compatibility_flags: ["nodejs_compat"],
					r2_buckets: [{ binding: "FILES", bucket_name: "made-up-files" }],
				},
			},
		],
	});
	const put = (
		hash: string,
		bytes: string,
		length = Buffer.byteLength(bytes),
	) =>
		server.fetch(`http://example.test/${hash}`, {
			method: "PUT",
			headers: { "content-length": String(length) },
			body: bytes,
		});
	try {
		await server.listen();
		const bytes = "%PDF-example";
		const hash = createHash("sha256").update(bytes).digest("hex");
		assert.deepEqual(await (await put(hash, bytes)).json(), {
			result: { key: `sha256/${hash}`, type: "application/pdf" },
			stored: true,
		});
		assert.deepEqual(await (await put(hash, bytes)).json(), {
			result: { refused: "already_stored" },
			stored: true,
		});
		const bad = "0".repeat(64);
		assert.deepEqual(await (await put(bad, bytes)).json(), {
			result: { refused: "sha256_mismatch" },
			stored: false,
		});
		const raceBytes = "%PDF-race";
		const raceHash = createHash("sha256").update(raceBytes).digest("hex");
		const race = await Promise.all([
			put(raceHash, raceBytes),
			put(raceHash, raceBytes),
		]);
		const answers = await Promise.all(race.map((r) => r.json()));
		assert.deepEqual(
			new Set(answers.map((a) => JSON.stringify(a))),
			new Set([
				JSON.stringify({
					result: { key: `sha256/${raceHash}`, type: "application/pdf" },
					stored: true,
				}),
				JSON.stringify({ result: { refused: "already_stored" }, stored: true }),
			]),
		);
	} finally {
		await server.close();
		await rm(dir, { recursive: true, force: true });
	}
});
