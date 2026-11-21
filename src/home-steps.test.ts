import assert from "node:assert/strict";
import { test } from "node:test";
import { stepCopy } from "./home-steps.ts";

const longInstruction =
	"Confirm the accessibility requirements for the proposed suite with the landlord and ask for the revised drawing in writing.";
const longUrl = `https://example.test/plan?Next=${"a".repeat(100)}`;

for (const [scenario, item_title, what, title] of [
	["a saved title", " Send the plan ", longInstruction, "Send the plan"],
	["blank saved title", "  ", "Check the suite.", "Check the suite."],
	[
		"a short instruction",
		null,
		"Call the office | Ask for Pat",
		"Call the office | Ask for Pat",
	],
	[
		"a short first sentence",
		null,
		`Send the offer. ${longInstruction}`,
		"Send the offer.",
	],
	[
		"an abbreviation within the first sentence",
		null,
		`Call Dr. Example and Gen. Sample about the plan. ${longInstruction}`,
		"Call Dr. Example and Gen. Sample about the plan.",
	],
	[
		"an initial within a long sentence",
		null,
		`Ask Á. Morgan to ${longInstruction}`,
		"Example Vendor",
	],
	["a long single sentence", null, longInstruction, "Example Vendor"],
	[
		"a long URL with a query string",
		null,
		`Review ${longUrl}`,
		"Example Vendor",
	],
	[
		"a short first sentence before a URL",
		null,
		`Review the plan. Open ${longUrl}`,
		"Review the plan.",
	],
	["a long word", null, "e\u0301".repeat(91), "Example Vendor"],
] as const) {
	test(`shows the whole instruction below the title for ${scenario}`, () => {
		assert.deepEqual(
			stepCopy({ what, item_title, context_label: "Example Vendor" }),
			{
				title,
				instruction: what,
			},
		);
	});
}
