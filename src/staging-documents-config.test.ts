import assert from "node:assert/strict";
import { test } from "node:test";
import { unstable_readConfig } from "wrangler";
import { z } from "zod";

const buckets = z.array(
	z.object({ binding: z.string(), bucket_name: z.string().min(1) }),
);

test("staging deal documents use a separate bucket from production", () => {
	const production = buckets
		.parse(unstable_readConfig({ config: "wrangler.jsonc" }).r2_buckets)
		.find((bucket) => bucket.binding === "DEAL_DOCUMENTS");
	const staging = buckets
		.parse(
			unstable_readConfig({ config: "wrangler.jsonc", env: "staging" })
				.r2_buckets,
		)
		.find((bucket) => bucket.binding === "DEAL_DOCUMENTS");
	assert.ok(production);
	assert.ok(staging);
	assert.notEqual(staging.bucket_name, production.bucket_name);
});
