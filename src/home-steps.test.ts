import assert from "node:assert/strict";
import { test } from "node:test";
import { stepCopy } from "./home-steps.ts";

const longInstruction =
	"Confirm the accessibility requirements for the proposed suite with the landlord and ask for the revised drawing in writing.";
const longUrl = `https://example.test/plan?Next=${"a".repeat(100)}`;
const noNames = new Map();
const names = new Map([
	["C-013", { text: "Example Clinic", url: "/relationships?node=party:1" }],
]);

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
		assert.deepEqual(stepCopy({ what, item_title }, noNames), {
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
		const { title, instruction } = stepCopy(
			{ what, item_title: null },
			noNames,
		);
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
			stepCopy(
				{
					what: `Read [the plan](${url}) before replying`,
					item_title: "Review the plan",
				},
				noNames,
			),
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
			stepCopy(
				{
					what,
					item_title: "Review the plan",
				},
				noNames,
			),
			{ title: "Review the plan", instruction: what },
		);
	});
}

for (const [scenario, what, title, instruction = null] of [
	[
		"a step a partner wrote with another touch",
		"Final touch: add photos to the listing.",
		"Final touch: add photos to the listing.",
	],
	[
		"a personal touch a partner wrote",
		"Personal touch — send Pat Example a gift card",
		"Personal touch — send Pat Example a gift card",
	],
	[
		"an empty record code",
		"Nurture touch — Example Place (). 45-day client cadence.",
		"Check in with Example Place (client)",
	],
	[
		"a record code after the name",
		"Nurture touch — Example Place (C-099). 45-day client cadence.",
		"Check in with Example Place (client)",
	],
	[
		"a note after the cadence",
		"Relationship touch — Example Supply. 90-day vendor cadence. Ask about renewal.",
		"Check in with Example Supply (vendor)",
		"Ask about renewal",
	],
	[
		"a hyphenated role",
		"Relationship touch — Example Supply. 90-day key-account cadence.",
		"Check in with Example Supply (key-account)",
	],
	[
		"a name that is a known record code",
		"Relationship touch — C-013. 90-day client cadence.",
		"Check in with Example Clinic (client)",
	],
	[
		"a name that is an unknown record code",
		"Relationship touch — C-099. 90-day client cadence.",
		"Check in with an old record (client)",
	],
	[
		"a company and its person",
		"Nurture touch — Example Dental Group. Pat Example (C-013). 60-day client cadence.",
		"Check in with Example Dental Group (client)",
		"Pat Example (Example Clinic)",
	],
	[
		"a title with a period inside the name",
		"Nurture touch — Dr. Pat Example (C-013). 45-day client cadence.",
		"Check in with Dr. Pat Example (client)",
	],
	[
		"cadence wording the template did not write",
		"Relationship touch — Example Supply 90-day vendor cadence",
		"Relationship touch — Example Supply 90-day vendor cadence",
	],
] as const) {
	test(`an automatic check-in reads plainly for ${scenario}`, () => {
		assert.deepEqual(stepCopy({ what, item_title: null }, names), {
			title,
			instruction,
		});
	});
}
