import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

test("GET /health reports when ClientWebsiteAccess served the first request", async (t) => {
	const hooks = registerHooks({
		resolve(specifier, context, nextResolve) {
			if (specifier === "cloudflare:workers") {
				return {
					url: "data:text/javascript,export class WorkerEntrypoint { constructor(_ctx, env) { this.env = env } }",
					shortCircuit: true,
				};
			}
			return nextResolve(specifier, context);
		},
	});
	t.after(() => hooks.deregister());
	t.mock.timers.enable({
		apis: ["Date"],
		now: Date.parse("2026-01-01T00:00:00Z"),
	});
	const { default: app, ClientWebsiteAccess } = await import(
		"./worker-entry.ts"
	);
	const id = "made-up-version-id";
	const tag = "a1b2c3d";
	const env = {
		CF_VERSION_METADATA: { id, tag },
		DATABASE_WRITER: { connectionString: "unused" },
	};
	// The stub only needs the bindings that Cloudflare passes to the entrypoint.
	const rpc: unknown = Reflect.construct(ClientWebsiteAccess, [undefined, env]);
	assert.ok(rpc instanceof ClientWebsiteAccess);

	const startedAt = "2026-01-01T00:01:00.000Z";
	t.mock.timers.setTime(Date.parse(startedAt));
	assert.equal(await rpc.redeemGrant("test-site", "invalid-grant"), false);

	t.mock.timers.setTime(Date.parse("2026-01-01T00:02:00Z"));
	const res = await app.request("/health", {}, env);
	assert.equal(res.status, 200);
	assert.deepEqual(await res.json(), {
		ok: true,
		version: id,
		release: tag,
		started_at: startedAt,
	});
});
