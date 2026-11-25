import assert from "node:assert/strict";
import { test } from "node:test";
import { stepCopy } from "./home-steps.ts";

const longInstruction =
	"Confirm the accessibility requirements for the proposed suite with the landlord and ask for the revised drawing in writing.";
const longUrl = `https://example.test/plan?Next=${"a".repeat(100)}`;

for (const [scenario, item_title, what, title, instruction = what] of [
	["a saved title", " Send the plan ", longInstruction, "Send the plan"],
	["blank saved title", "  ", "Check the suite.", "Check the suite.", null],
	[
		"a short instruction",
		null,
		"Call the office | Ask for Pat",
		"Call the office | Ask for Pat",
		null,
	],
	[
		"a saved title that matches its instruction",
		"Send the plan",
		"Send the plan",
		"Send the plan",
		null,
	],
	[
		"a long single sentence",
		null,
		longInstruction,
		"Confirm the accessibility requirements for the proposed suite with the landlord and ask…",
	],
	["a long URL with a query string", null, `Review ${longUrl}`, "Review…"],
	["an empty display instruction", null, "C-026", "Next step", null],
	[
		"a short URL",
		null,
		"Read https://example.test/plan?a=b",
		"Read https://example.test/plan?a=b",
		null,
	],
	["a long word", null, "e\u0301".repeat(91), `${"e\u0301".repeat(89)}…`],
	[
		"an automatic vendor check-in",
		null,
		"Relationship touch — V-ABC-001 Example Supply. 90-day vendor cadence.",
		"Check in with Example Supply (vendor)",
		null,
	],
	[
		"an automatic client check-in",
		null,
		"Relationship touch: Example Clinic. 60-day client cadence.",
		"Check in with Example Clinic (client)",
		null,
	],
	[
		"an automatic check-in without a cadence",
		null,
		"Nurture touch — Example Place",
		"Check in with Example Place",
		null,
	],
	[
		"a saved title on an automatic check-in",
		"Call Pat",
		"Relationship touch — Example Contact. 90-day contact cadence.",
		"Call Pat",
		"Check in with Example Contact (contact)",
	],
] as const) {
	test(`shows distinct heading and body text for ${scenario}`, () => {
		assert.deepEqual(stepCopy({ what, item_title }), {
			title,
			instruction,
		});
	});
}

for (const opening of [
	"Confirm by Fri. Nov 27 and",
	"Call at 9 a.m. Central and",
	"Call at 202. 555. 0142 and",
	"Use https://example.test/plan? and",
	"Send the plan. then",
]) {
	test(`shortens a long instruction starting with "${opening}" into its title`, () => {
		const what = `${opening} check the final signed drawing with the site manager before sending the revised plan to the tenant.`;
		const { title, instruction } = stepCopy({ what, item_title: null });
		assert.equal(instruction, what);
		assert.match(title, /…$/);
		assert.ok(what.startsWith(title.slice(0, -1)), title);
		assert.ok([...title].length <= 90, title);
	});
}

for (const url of [
	"https://example.test/C-026/2026-11-27?rev=2",
	"https://example.test/plan(revised)/C-026/2026-11-27?rev=2",
	"/p(a(b))/C-026",
]) {
	test(`a Markdown link keeps its full destination ${url}`, () => {
		assert.deepEqual(
			stepCopy({
				what: `Read [the plan](${url}) before replying`,
				item_title: "Review the plan",
			}),
			{
				title: "Review the plan",
				instruction: `Read the plan (${url}) before replying`,
			},
		);
	});
}

for (const what of [
	'Read [the plan](/p(a(b))/C-026 "Reference title") before replying',
	"Read [the plan](/p(a(b))/C-026",
	"Read [the [sample] plan](/p(a(b))/C-026) before replying",
]) {
	test(`preserves the original instruction when the link is unclear: ${what}`, () => {
		assert.deepEqual(
			stepCopy({
				what,
				item_title: "Review the plan",
			}),
			{ title: "Review the plan", instruction: what },
		);
	});
}
