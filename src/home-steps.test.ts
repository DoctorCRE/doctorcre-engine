import assert from "node:assert/strict";
import { test } from "node:test";
import { homeStepCopy } from "./home-steps.ts";

test("removes the fallback title from the start of a long instruction", () => {
	const result = homeStepCopy({
		title:
			"follow up on Example Vendor about the outstanding proposal and confirm the next steps with the team before Friday",
		context_label: "Example Vendor",
		status: "open",
		due_on: null,
		hold_until: null,
		call_at: null,
		call_contact: null,
	});
	assert.deepEqual(result, {
		title: "Follow up on Example Vendor",
		why: "About the outstanding proposal and confirm the next steps with the team before Friday.",
	});
});
