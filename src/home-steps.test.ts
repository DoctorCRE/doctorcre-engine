import assert from "node:assert/strict";
import { test } from "node:test";
import { homeStepCopy } from "./home-steps.ts";

const preparation =
	"Before sending, check the suite number against the latest drawing and confirm the landlord's mailing address.";
const longInstruction =
	"Confirm the accessibility requirements for the proposed suite with the landlord and ask for the revised drawing in writing";

for (const [scenario, what, title, why] of [
	[
		"preparation after an action",
		`Send the offer. ${preparation}`,
		"Send the offer",
		preparation,
	],
	[
		"lowercase preparation",
		"Send the offer. before sending, check the suite number.",
		"Send the offer",
		"Before sending, check the suite number.",
	],
	[
		"a phone number and a contingency",
		"(202) 555-0142 — Call about the floor plan. If no one answers, leave a message with the office and retry later.",
		"Call about the floor plan",
		"(202) 555-0142. If no one answers, leave a message with the office and retry later.",
	],
	[
		"a copied meeting subject",
		"Lease review with Pat | Example Leasing, Tue Oct 27 4:30 PM",
		"Follow up on Lease review with Pat",
		"Example Leasing, Tue Oct 27 4:30 PM.",
	],
	[
		"an action with a meeting time",
		"Review the lease with Pat | Example Leasing, Tue Oct 27 4:30 PM",
		"Review the lease with Pat",
		"Example Leasing, Tue Oct 27 4:30 PM.",
	],
	[
		"a visit instruction with a meeting time",
		"Visit the suite with Pat | Example Leasing, Tue Oct 27 4:30 PM",
		"Visit the suite with Pat",
		"Example Leasing, Tue Oct 27 4:30 PM.",
	],
	[
		"a long copied meeting subject",
		"Lease renewal discussion for the north building with the property team about accessibility and the revised floor plan | Example Leasing, Tue Oct 27 4:30 PM",
		"Follow up on Lease renewal discussion for the north building with the property team about",
		"Accessibility and the revised floor plan. Example Leasing, Tue Oct 27 4:30 PM.",
	],
	[
		"a long action with a meeting time",
		`${longInstruction} | Example Leasing, Tue Oct 27 4:30 PM`,
		"Confirm the accessibility requirements for the proposed suite with the landlord and ask",
		"For the revised drawing in writing. Example Leasing, Tue Oct 27 4:30 PM.",
	],
	[
		"a long single instruction",
		longInstruction,
		"Follow up on Example Vendor",
		`${longInstruction}.`,
	],
] as const) {
	test(`shows the title and why for ${scenario}`, () => {
		assert.deepEqual(
			homeStepCopy({
				title: what,
				context_label: "Example Vendor",
				status: "open",
				due_on: null,
				hold_until: null,
				call_at: null,
				call_contact: null,
			}),
			{ title, why },
		);
	});
}

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
