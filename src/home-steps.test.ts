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
	["a long single sentence", null, longInstruction, "Example Vendor"],
	[
		"a long URL with a query string",
		null,
		`Review ${longUrl}`,
		"Example Vendor",
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

for (const opening of [
	"Confirm by Fri. Nov 27 and",
	"Call at 9 a.m. Central and",
	"Call at 202. 555. 0142 and",
	"Use https://example.test/plan? and",
	"Send the plan. then",
]) {
	test(`uses the record name for a long instruction starting with "${opening}"`, () => {
		const what = `${opening} check the final signed drawing with the site manager before sending the revised plan to the tenant.`;
		assert.deepEqual(
			stepCopy({ what, item_title: null, context_label: "Example Deal" }),
			{ title: "Example Deal", instruction: what },
		);
	});
}

for (const url of [
	"https://example.test/C-026/2026-11-27?rev=2",
	"https://example.test/plan(revised)/C-026/2026-11-27?rev=2",
]) {
	test(`a Markdown link keeps its full destination ${url}`, () => {
		assert.deepEqual(
			stepCopy({
				what: `Read [the plan](${url}) before replying`,
				item_title: "Review the plan",
				context_label: "Example Deal",
			}),
			{
				title: "Review the plan",
				instruction: `Read the plan (${url}) before replying`,
			},
		);
	});
}
