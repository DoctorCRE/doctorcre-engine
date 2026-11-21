import assert from "node:assert/strict";
import { test } from "node:test";
import { homeStepCopy } from "./home-steps.ts";

const preparation =
	"Before sending, check the suite number against the latest drawing and confirm the landlord's mailing address.";
const longInstruction =
	"Confirm the accessibility requirements for the proposed suite with the landlord and ask for the revised drawing in writing";
const japaneseTitle = `${"確認".repeat(43)}内容を`;
const longWord = "e\u0301".repeat(90);
const longUrl = `https://example.test/${"a".repeat(100)}`;

for (const [scenario, what, title, why, contact = null] of [
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
		"preparation before a separator",
		`Send the offer. ${preparation} | Example Leasing`,
		"Send the offer",
		`Example Leasing. ${preparation}`,
	],
	[
		"a phone number and a contingency",
		"(202) 555-0142 — Call about the floor plan. If no one answers, leave a message with the office and retry later.",
		"Call about the floor plan",
		"(202) 555-0142. If no one answers, leave a message with the office and retry later.",
	],
	[
		"a date-only suffix",
		"Lease review | Tue Oct 27",
		"Lease review",
		"Tue Oct 27.",
	],
	[
		"an organization-only suffix",
		"Lease review | Example Leasing",
		"Lease review",
		"Example Leasing.",
	],
	["a time-only suffix", "Lease review | 4:30 PM", "Lease review", "4:30 PM."],
	[
		"a title with a dash and more than one spaced pipe",
		"Lease review — suite 4 | revised plans | Example Leasing, Tue Oct 27 4:30 PM",
		"Lease review",
		"suite 4 | revised plans | Example Leasing, Tue Oct 27 4:30 PM.",
	],
	[
		"an organization with a comma and meeting time after an em dash",
		"Lease review — Example Leasing, Inc., Tue Oct 27 4:30 PM",
		"Lease review",
		"Example Leasing, Inc., Tue Oct 27 4:30 PM.",
	],
	[
		"an organization and timestamp after an em dash",
		"Review the draft plan — Example Leasing, 2026-10-27T21:30:00Z",
		"Review the draft plan",
		"Example Leasing, Oct 27, 2026, 4:30 PM.",
	],
	[
		"an en dash separator",
		"Lease review – Example Leasing",
		"Lease review",
		"Example Leasing.",
	],
	[
		"a hyphenated word and a meeting time without a separator",
		"Send a follow-up, Tue Oct 27 4:30 PM",
		"Send a follow-up, Tue Oct 27 4:30 PM",
		"",
	],
	[
		"an instruction starting with Tour",
		"Tour the suite with Léa | Example Leasing, Tue Oct 27 4:30 PM",
		"Tour the suite with Léa",
		"Example Leasing, Tue Oct 27 4:30 PM.",
	],
	[
		"a French instruction",
		"Confirmez la visite avec Léa | Example Leasing, Tue Oct 27 4:30 PM",
		"Confirmez la visite avec Léa",
		"Example Leasing, Tue Oct 27 4:30 PM.",
	],
	[
		"a heading starting with Review",
		"Review of the proposed renewal | Example Leasing",
		"Review of the proposed renewal",
		"Example Leasing.",
	],
	[
		"a Japanese word spanning the limit",
		`${japaneseTitle}共有してください | Example Leasing, Tue Oct 27 4:30 PM`,
		japaneseTitle,
		"Example Leasing, Tue Oct 27 4:30 PM. 共有してください.",
	],
	[
		"a single word longer than the grapheme limit",
		`${longWord}e\u0301`,
		longWord,
		"e\u0301.",
	],
	["a long URL after an action", `Review ${longUrl}`, "Review", longUrl],
	[
		"a long URL before an explicit suffix",
		`Review ${longUrl} before the call | Example Leasing`,
		"Review",
		`${longUrl} Example Leasing. before the call.`,
	],
	[
		"a URL that fits in the title",
		"Review https://example.test/revised-plans",
		"Review https://example.test/revised-plans",
		"",
	],
	[
		"a step with only an over-limit URL",
		longUrl,
		"Follow up on Example Vendor",
		longUrl,
	],
	[
		"a step with only a copied record code",
		"C-123",
		"Follow up on Example Vendor",
		"",
	],
	[
		"a step with only a phone number",
		"(202) 555-0142",
		"Follow up on Example Vendor",
		"(202) 555-0142.",
		"Pat Example",
	],
	[
		"a copied meeting subject",
		"Lease review with Pat | Example Leasing, Tue Oct 27 4:30 PM",
		"Lease review with Pat",
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
		"Lease renewal discussion for the north building with the property team about accessibility",
		"Example Leasing, Tue Oct 27 4:30 PM. and the revised floor plan.",
	],
	[
		"a long action with a meeting time",
		`${longInstruction} | Example Leasing, Tue Oct 27 4:30 PM`,
		"Confirm the accessibility requirements for the proposed suite with the landlord and ask",
		"Example Leasing, Tue Oct 27 4:30 PM. for the revised drawing in writing.",
	],
	[
		"a long single instruction",
		longInstruction,
		"Confirm the accessibility requirements for the proposed suite with the landlord and ask",
		"for the revised drawing in writing.",
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
				call_contact: contact,
			}),
			{ title, why },
		);
	});
}
