import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanEmailBody } from "./home-email-thread.ts";

test("cleans a large body with an incomplete header promptly", () => {
	const body = `Current message.\nFrom: Pat\n${" ".repeat(100_000)}\n${"x".repeat(100_000)}`;
	const start = performance.now();
	const result = cleanEmailBody(body, null);
	const elapsed = performance.now() - start;
	assert.ok(result.endsWith("x".repeat(100_000)));
	assert.ok(elapsed < 50, `cleanup took ${elapsed} ms`);
});

test("cuts only confirmed header blocks and preserves indented body", () => {
	for (const headers of [
		"From: Pat\nSent: yesterday",
		"From: Pat\n <pat@example.test>\nTo: Sam\nDate: yesterday",
		"From: Pat\n  Sent: yesterday",
	]) {
		assert.equal(
			cleanEmailBody(`Current message.\n${headers}\nOld message.`, null),
			"Current message.",
		);
	}
	assert.equal(
		cleanEmailBody(
			"Current message.\nFrom: Pat\n  Keep this line.\nBody.",
			null,
		),
		"Current message.\n  Keep this line.\nBody.",
	);
});
