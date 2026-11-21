import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanEmailThread } from "./home-email-thread.ts";

function message(body: string, sender = "maya@example.test") {
	return { body, sender };
}

const footer =
	"Maya Example\nOffice Manager\nDirect: 555-010-2000\nmaya@example.test";
const header =
	"From: Sam Example <sam@example.test>\nDate: Mon, Jan 5, 2026\nTo: Maya Example\nSubject: Suite 200";

test("keeps authored calendar fields and instructions", () => {
	const note =
		"Walkthrough details.\nDate: January 5, 2026\nSubject: Building walkthrough\nMeet at the west door.";
	assert.deepEqual(cleanEmailThread([message(note)]), [note]);
});

test("keeps replies between quoted questions inside a forward", () => {
	const questions = "Is the plan ready?\nWhere are the keys?";
	const intro =
		"Begin forwarded message:\nAnswers below.\nOn Mon, Jan 5, 2026 at 9:30 AM Sam Example <sam@example.test> wrote:";
	const reply = `${intro}\n> Is the plan ready?\nIt is ready.\n> Where are the keys?\nAt the side door.`;
	assert.deepEqual(
		cleanEmailThread([message(questions, "sam@example.test"), message(reply)]),
		[questions, `${intro}\nIt is ready.\nAt the side door.`],
	);
});

test("keeps standalone links and callbacks after a signature", () => {
	const notes = [
		"https://example.test/floor-plan",
		"P.S. CALL 555-010-3000",
	].map((postscript) => `The office is open.\n\n${footer}\n\n${postscript}`);
	const updates = [
		"I sent the plan.",
		"The keys are ready.",
		"Thanks for the note.",
	];
	const signed = updates.map((update) => message(`${update}\n${footer}`));
	assert.deepEqual(
		cleanEmailThread([...signed, ...notes.map((note) => message(note))]),
		[...updates, ...notes],
	);
});

test("keeps a whole instruction that ends with another message's footer line", () => {
	const instruction = "Please address the envelope to Maya Example";
	const suffix = "Office Manager\nDirect: 555-010-2000\nmaya@example.test";
	const updates = [
		"I sent the plan.",
		"The keys are ready.",
		"Leave it upstairs.",
	];
	assert.deepEqual(
		cleanEmailThread([
			...updates.map((update) => message(`${update}\n${footer}`)),
			message(`${instruction}\n${suffix}`),
		]),
		[...updates, instruction],
	);
});

test("keeps a floor-plan link on a meeting join label", () => {
	const note =
		"Use this link for the plan.\nJoin Zoom Meeting: https://example.test/floor-plan";
	assert.deepEqual(cleanEmailThread([message(note)]), [note]);
});

test("matches complete earlier lines after whitespace and quote-marker normalization", () => {
	const oldest = "Could you send the suite 200 plan?\nUse the west door.";
	const later = "I only have the survey.";
	const reply =
		"Here is the plan.\r\n  >> Could you send the\u00a0suite\t200 plan?\r\n\t> Use the west door.\r\n> A line missing from the archive.\r\nPlease text when you arrive.";
	assert.deepEqual(
		cleanEmailThread([message(oldest), message(later), message(reply)]),
		[
			oldest,
			later,
			"Here is the plan.\n> A line missing from the archive.\nPlease text when you arrive.",
		],
	);
});

test("removes a complete reply header and its matching lines, including Outlook formatting", () => {
	const earlier = "Could you send the suite 200 plan?\nUse the west door.";
	const reply = "Here is the plan.\nCC: Please copy the surveyor.";
	const postscript = "P.S. Bring the signed plan.";
	const outlook =
		"> *From:* Sam Example\n\n> *Sent:* Mon, Jan 5, 2026\n> *To:* Maya Example\n> *Subject:* Suite 200";
	for (const boundary of [header, outlook]) {
		assert.deepEqual(
			cleanEmailThread([
				message(earlier),
				message(`${reply}\n${boundary}\n\n${earlier}\n${postscript}`),
			]),
			[earlier, `${reply}\n\n${postscript}`],
		);
	}
});

test("the reply header needs a matching line immediately after it", () => {
	const earlier = "Could you send the suite 200 plan?";
	const reply = `Here is the plan.\n${header}\nPlease use the west door.\n> ${earlier}`;
	assert.deepEqual(cleanEmailThread([message(earlier), message(reply)]), [
		earlier,
		`Here is the plan.\n${header}\nPlease use the west door.`,
	]);
});

test("unmarked repeated words and matches on only part of a line stay visible", () => {
	const earlier = "Use the west door.";
	const reply = `Quick update.\n${earlier}\n> Use the west door. I can arrive Monday.\nYou wrote: ${earlier} I can arrive Monday.`;
	assert.deepEqual(
		cleanEmailThread([message(earlier), message(reply, "sam@example.test")]),
		[earlier, reply],
	);
});

const unstoredHistory = [
	[
		"reordered quote header",
		"> Subject: Suite 200\n> To: Maya Example\n> Date: Mon, Jan 5, 2026\n> From: Sam Example\n> Old text.",
	],
	[
		"wrapped reply opener",
		"On Mon, Jan 5, 2026 at 9:30 AM Sam Example <\nsam@example.test> wrote:\n> Old text.",
	],
	["forwarded divider", "---------- Forwarded message ---------\nOld text."],
	["underscore divider", "________________________________\nOld text."],
	["truncated address", "From: Sam Example <sam@example.test"],
	[
		"wrapped sender",
		`${header.replace("Sam Example", "Sam\nExample")}\nOld text.`,
	],
	[
		"wrapped sender and company",
		`${header.replace(
			"Sam Example <sam@example.test>",
			"Sam Example/\nExample Realty",
		)}\nOld text.`,
	],
	[
		"folded leading header",
		`${header.replaceAll("\n", " ")} The keys are at the desk.`,
	],
	[
		"leading header with blank To and a long Cc",
		`${header.replace(
			"To: Maya Example",
			`To:\nCc: ${"Broker Example <broker@example.test>; ".repeat(24)}`,
		)}\n\nThe keys are at the desk.`,
	],
	[
		"leading forward with header and nested opener",
		`Begin forwarded message:\n${header}\n\nThe keys are at the desk.\n\nOn Jan 4, 2026 Pat Example wrote:\nOlder message.`,
	],
	[
		"leading forward with a note before an inner header",
		`Begin forwarded message:\n\u200b\nThe plan is signed.\n${header}\nOlder message.`,
	],
	[
		"folded header glued to an ellipsis",
		"One more thing...From: Sam Partner <sam@example.test>. Date: Mon, Jan 5, 2026 at 9:00 AM. To: Maya Example <maya@example.test>...Older message.",
	],
	[
		"folded forwarded marker",
		"Please withdraw this inquiry. Begin forwarded message: Name: Robin Example Email: robin@example.test",
	],
	[
		"external sender banner",
		"You don't often get email from maya@example.test. Learn why this is important Could you send the plan?",
	],
];

for (const [shape, text] of unstoredHistory) {
	test(`preserves ${shape} without evidence of carried history`, () => {
		const earlier = "Can you send the new plan?";
		const reply = `Here is the plan.\n${text}`;
		assert.deepEqual(cleanEmailThread([message(earlier), message(reply)]), [
			earlier,
			reply,
		]);
	});
}

test("keeps the sign-off, contact and address lines of an unsupported signature", () => {
	const notes = [
		"Here is the plan.\r\nThanks,\r\nMaya Example\r\nGeneral Dentist\r\n123 Example St.\r\nExample City, TX 75001\r\nFax: (555) 010-2000\r\nmaya@example.test\r\nLicense #12345",
		"Here is the plan. Regards, Maya Example, DMDGeneral Dentist | (555) 010-2000",
		"Here is the plan. Maya Example,DMDGeneral Dentist Example City, TX",
		"Here is the plan. Maya Example Office Manager | +1 (555) 010-2000 | maya@example.test",
		"Here is the plan.\nSent from my iPhone",
		"The keys are at the desk.\n\nMaya Example\nOffice Manager\nDirect: 555-010-2000\nexample.com",
		"Here is the door label.\nMaya Example\nUse The West Door",
		"Here is the door label. Thanks, Maya Use The West Door",
		"Tuesday works. Thank you, Maya. (555) 010-2000 maya@example.test",
		"Tuesday works. Thank you, Maya, (555) 010-2000 maya@example.test",
	];
	for (const note of notes) {
		assert.deepEqual(cleanEmailThread([message(note)]), [note]);
	}
});

test("signature lines need two other messages from the same sender", () => {
	const first = `I sent the plan.\n${footer}`;
	const second = `The keys are ready.\n${footer}`;
	const third = `Use the west door.\n${footer.replace("Office Manager", "Office  Manager")}\n\n`;
	const other = `The office is open.\n${footer}`;
	assert.deepEqual(
		cleanEmailThread([
			message(first),
			message(second),
			message(other, "sam@example.test"),
		]),
		[first, second, other],
	);
	assert.deepEqual(
		cleanEmailThread([
			message(first),
			message(second, "MAYA@example.test"),
			message(third),
			message(other, "sam@example.test"),
		]),
		["I sent the plan.", "The keys are ready.", "Use the west door.", other],
	);
});

test("does not borrow a number in a sentence when another message puts it in a footer", () => {
	const note =
		"Here is the plan. Call the office at 555-010-2000\nmaya@example.test";
	const signed = "The plan is attached.\n555-010-2000\nmaya@example.test";
	assert.deepEqual(cleanEmailThread([message(note), message(signed)]), [
		note,
		signed,
	]);
});

test("a recurring block before a closing paragraph stays visible", () => {
	for (const closing of [
		"Please text when you pick up the keys.",
		"Please Text Before You Arrive.",
	]) {
		const current = `The keys are at the desk.\n\n${footer}\n\n${closing}`;
		const updates = [
			"I sent the plan.",
			"The keys are ready.",
			"Use the west door.",
		];
		assert.deepEqual(
			cleanEmailThread([
				...updates.map((update) => message(`${update}\n${footer}`)),
				message(current),
			]),
			[...updates, current],
		);
	}
});

test("names and a repeated instruction after a repeated phone line need more than two messages", () => {
	const bodies = ["The plan is ready.", "I sent the plan."].map(
		(update) =>
			`${update}\nMaya Example\nDirect: 555-010-2000\nPlease text before you arrive.`,
	);
	assert.deepEqual(
		cleanEmailThread(bodies.map((body) => message(body))),
		bodies,
	);
});

const teams =
	"Microsoft Teams meeting\nJoin the meeting now\nMeeting ID: 123 456 789\nPasscode: abc";
const zoom =
	"Join Zoom Meeting: https://example.zoom.us/j/123456789\nMeeting ID: 123 456 789\nPasscode: def";

test("removes whole invite template lines and keeps the authored paragraphs around them", () => {
	for (const invite of [teams, zoom]) {
		const before = "Join with Google Meet if the office is closed.";
		for (const after of [
			"I'll bring the keys to the office after the call.",
			"https://example.test/floor-plan",
			"Meeting ID: 867 is the label to use on your plan.",
		]) {
			assert.deepEqual(
				cleanEmailThread([message(`${before}\n\n${invite}\n${after}`)]),
				[`${before}\n\n${after}`],
			);
		}
	}
});

test("keeps a standalone invite and other messages with no surviving lines", () => {
	const earlier = "Use the west door.";
	const quote = `> ${earlier}`;
	const signature = `\n${footer}\n\n`;
	for (const body of ["", "  ", "Thanks", teams, zoom]) {
		assert.deepEqual(cleanEmailThread([message(body)]), [body]);
	}
	assert.deepEqual(cleanEmailThread([message(earlier), message(quote)]), [
		earlier,
		quote,
	]);
	assert.deepEqual(
		cleanEmailThread([message(signature), message(footer), message(footer)]),
		[signature, footer, footer],
	);
});

test("invite details without a template and unrelated links remain visible", () => {
	const note =
		"Meeting ID: 12345\nPasscode: example\nJoin on your computer\nJoin with Google Meet\nhttps://meet.google.com/abc-defg-hij";
	const linkedNote =
		"Please join remotely.\nJoin Microsoft Teams Meeting\nhttps://example.test/join\nMeeting ID: 1234\n\nhttps://example.test/floor-plan";
	assert.deepEqual(cleanEmailThread([message(note), message(linkedNote)]), [
		note,
		"Please join remotely.\nhttps://example.test/join\nMeeting ID: 1234\n\nhttps://example.test/floor-plan",
	]);
});

test("preserves large folded lines and removes individually matched lines in a carried chain", () => {
	const folded = `From: Pat ${" ".repeat(100_000)}${"x".repeat(100_000)}`;
	const replies = Array.from(
		{ length: 11 },
		(_, index) => `Update ${index}. ${"Plan ".repeat(2000).trimEnd()}`,
	);
	const messages = replies.map((reply, index) =>
		message(
			[reply, ...replies.slice(0, index).map((earlier) => `> ${earlier}`)].join(
				"\n",
			),
		),
	);
	assert.deepEqual(cleanEmailThread([message(folded), ...messages]), [
		folded,
		...replies,
	]);
});
