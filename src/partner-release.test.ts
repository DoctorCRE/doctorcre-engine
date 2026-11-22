import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { type Unstable_Config, unstable_readConfig } from "wrangler";

test("partner sign-in resolves a separate app origin and auth database per release", () => {
	const config = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));
	const production: Unstable_Config = unstable_readConfig({ config, env: "" });
	const staging: Unstable_Config = unstable_readConfig(
		{ config, env: "staging" },
		{ hideWarnings: true },
	);

	assert.equal(production.vars.PARTNER_APP_ORIGIN, "https://app.doctorcre.com");
	assert.equal(
		staging.vars.PARTNER_APP_ORIGIN,
		"https://doctorcre-app-staging.joe-bookout-carr-us.workers.dev",
	);

	const databases = [...production.hyperdrive, ...staging.hyperdrive];
	for (const release of [production, staging]) {
		const auth = release.hyperdrive.find(
			({ binding }) => binding === "PARTNER_AUTH_DATABASE",
		);
		assert.ok(auth, `${release.name} needs a partner auth database`);
		assert.match(auth.id, /^[0-9a-f]{32}$/);
		assert.notEqual(
			auth.id,
			"0".repeat(32),
			`${release.name} needs a provisioned partner auth Hyperdrive ID`,
		);
		assert.equal(databases.filter(({ id }) => id === auth.id).length, 1);
	}
});
