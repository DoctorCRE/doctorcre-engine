import assert from "node:assert/strict";
import { test } from "node:test";

test("GET /health", async (t) => {
	t.mock.timers.enable({
		apis: ["Date"],
		now: Date.parse("2026-01-01T00:00:00Z"),
	});
	const { default: app } = await import("./worker.ts");
	const id = "made-up-version-id";
	const tag = "a1b2c3d";
	const env = { CF_VERSION_METADATA: { id, tag } };
	const startedAt = "2026-01-01T00:01:00.000Z";
	t.mock.timers.setTime(Date.parse(startedAt));
	assert.equal((await app.request("/api/engine/whoami", {}, env)).status, 401);

	await t.test(
		"reports when another route first served a request on every call",
		async () => {
			for (const now of ["2026-01-01T00:02:00Z", "2026-01-01T00:03:00Z"]) {
				t.mock.timers.setTime(Date.parse(now));
				const res = await app.request("/health", {}, env);
				assert.equal(res.status, 200);
				assert.deepEqual(await res.json(), {
					ok: true,
					version: id,
					release: tag,
					started_at: startedAt,
				});
			}
		},
	);

	await t.test(
		"omits release and start time when the tag is missing or blank",
		async () => {
			for (const metadata of [{ id }, { id, tag: "" }, { id, tag: " \t" }]) {
				const res = await app.request(
					"/health",
					{},
					{ CF_VERSION_METADATA: metadata },
				);
				assert.equal(res.status, 200);
				assert.deepEqual(await res.json(), { ok: true, version: id });
			}
		},
	);
});
