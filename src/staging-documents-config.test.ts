import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { z } from "zod";

const buckets = z.array(
	z.object({ binding: z.string(), bucket_name: z.string().min(1) }),
);

test("staging deal documents use a separate bucket from production", async () => {
	const config = z
		.object({
			r2_buckets: buckets,
			env: z.object({ staging: z.object({ r2_buckets: buckets }) }),
		})
		.parse(JSON.parse(await readFile("wrangler.jsonc", "utf8")));
	const production = config.r2_buckets.find(
		(bucket) => bucket.binding === "DEAL_DOCUMENTS",
	);
	const staging = config.env.staging.r2_buckets.find(
		(bucket) => bucket.binding === "DEAL_DOCUMENTS",
	);
	assert.ok(production);
	assert.ok(staging);
	assert.notEqual(staging.bucket_name, production.bucket_name);
});
