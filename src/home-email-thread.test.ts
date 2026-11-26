import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanEmailThread } from "./home-email-thread.ts";

function message(body: string, sender = "maya@example.test") {
	const sender_name =
		sender.toLowerCase() === "maya@example.test" ? "Maya Example" : null;
	return { body, sender, sender_name };
}

const footer =
	"Maya Example\nOffice Manager\nDirect: 555-010-2000\nmaya@example.test";
const header =
	"From: Sam Example <sam@example.test>\nDate: Mon, Jan 5, 2026\nTo: Maya Example\nSubject: Suite 200";

test("folds repeated instructions and unstored forwards without discarding them", () => {
	const tails = [
		`Please copy the surveyor on every update.\n${footer}`,
		`Begin forwarded message:\nA note from another sender.`,
	];
	const openings = [
		"The plan is ready.",
		"I sent the plan.",
		"Use the west door.",
	];
	for (const folded of tails) {
		assert.deepEqual(
			cleanEmailThread(openings.map((body) => message(`${body}\n${folded}`))),
			openings.map((body) => ({ body, folded })),
		);
	}
});

test("keeps a greater-than comparison and the paragraph that follows visible", () => {
	const body =
		"Lease criteria:\n> 10,000 square feet\n\nPlease confirm the loading dock is available.";
	assert.deepEqual(cleanEmailThread([message(body)]), [{ body, folded: null }]);
});

test("keeps instructions after flattened, multiline, and legal footers visible", () => {
	const instruction = "Please bring the signed lease.";
	for (const [separator, folded] of [
		[" ", "Thanks, Maya Example | Direct: 555-010-2000."],
		["\n\n", footer],
		["\n\n", "This email may contain\nconfidential information."],
		[" ", "This email may contain confidential information."],
	]) {
		const body = `Tuesday works.${separator}${instruction}`;
		assert.deepEqual(
			cleanEmailThread([
				message(
					`Tuesday works.${separator}${folded}${separator}${instruction}`,
				),
			]),
			[{ body, folded }],
		);
	}
	const body =
		"Tuesday works.\n\nThis email contains confidential pricing. Please approve the offer.";
	assert.deepEqual(cleanEmailThread([message(body)]), [{ body, folded: null }]);
});

test("folds quote runs and quotes after an opener while keeping inline answers visible", () => {
	const opener = "On Mon, Jan 5, 2026 at 9:30 AM Sam Example\nwrote:";
	const history = `${opener}\n> Is the plan ready?\nIt is ready.\n> Where are the keys?\n> Which door?\nAt the side door.`;
	assert.deepEqual(
		cleanEmailThread([message(`Answers below.\n\n${history}`)]),
		[
			{
				body: "Answers below.\n\nIt is ready.\nAt the side door.",
				folded: `${opener}\n> Is the plan ready?\n> Where are the keys?\n> Which door?`,
			},
		],
	);
});

test("folds an unconfirmed signature before older mail with a complete header", () => {
	const history = `${footer}\n\n${header}\n\nThe keys are ready.`;
	assert.deepEqual(
		cleanEmailThread([message(`Here is the plan.\n\n${history}`)]),
		[{ body: "Here is the plan.", folded: history }],
	);
});

test("promotes an entirely folded message to its visible body", () => {
	const body = `${header}\n\nThe keys are ready.`;
	assert.deepEqual(cleanEmailThread([message(body)]), [{ body, folded: null }]);
});

test("folds a complete inline reply header in a flattened body", () => {
	const history = `${header.replaceAll("\n", " ")} The keys are ready.`;
	assert.deepEqual(
		cleanEmailThread([message(`Here is the plan. ${history}`)]),
		[{ body: "Here is the plan.", folded: history }],
	);
});

test("folds a single quote after a flattened reply header", () => {
	const history = `${header.replaceAll("\n", " ")}\n> The keys are ready.`;
	assert.deepEqual(
		cleanEmailThread([message(`Here is the plan.\n${history}`)]),
		[{ body: "Here is the plan.", folded: history }],
	);
});

test("folds a trailing signature and legal notice without removing either", () => {
	const notice =
		"This email may contain confidential information.\nIf you received it in error, please delete it.";
	const signature = `${footer}\n\n${notice}`;
	assert.deepEqual(
		cleanEmailThread([message(`Here is the plan.\n\n${signature}`)]),
		[{ body: "Here is the plan.", folded: signature }],
	);
});

function availableText(messages: Parameters<typeof cleanEmailThread>[0]) {
	return cleanEmailThread(messages).map(({ body, folded }) =>
		folded ? `${body}\n${folded}` : body,
	);
}

function oneLine(text: string) {
	return text.trim().replace(/\s+/g, " ");
}

test("keeps authored calendar fields and instructions", () => {
	const note =
		"Walkthrough details.\nDate: January 5, 2026\nSubject: Building walkthrough\nMeet at the west door.";
	assert.deepEqual(cleanEmailThread([message(note)]), [
		{ body: note, folded: null },
	]);
});

test("keeps replies between quoted questions inside a forward", () => {
	const questions = "Is the plan ready?\nWhere are the keys?";
	const intro =
		"Begin forwarded message:\nAnswers below.\nOn Mon, Jan 5, 2026 at 9:30 AM Sam Example <sam@example.test> wrote:";
	const reply = `${intro}\n> Is the plan ready?\nIt is ready.\n> Where are the keys?\nAt the side door.`;
	assert.deepEqual(
		cleanEmailThread([message(questions, "sam@example.test"), message(reply)]),
		[
			{ body: questions, folded: null },
			{ body: "It is ready.\nAt the side door.", folded: intro },
		],
	);
});

test("keeps standalone links and callbacks after a signature", () => {
	for (const postscript of [
		"https://example.test/floor-plan",
		"P.S. CALL 555-010-3000",
	]) {
		assert.deepEqual(
			cleanEmailThread([
				message(`The office is open.\n\n${footer}\n\n${postscript}`),
			]),
			[{ body: `The office is open.\n\n${postscript}`, folded: footer }],
		);
	}
});

test("keeps a whole instruction that ends with another message's footer line", () => {
	const body = "Please address the envelope to Maya Example";
	const folded = "Office Manager\nDirect: 555-010-2000\nmaya@example.test";
	const updates = [
		"I sent the plan.",
		"The keys are ready.",
		"Leave it upstairs.",
	];
	assert.deepEqual(
		cleanEmailThread([
			...updates.map((update) => message(`${update}\n${footer}`)),
			message(`${body}\n${folded}`),
		]),
		[...updates.map((body) => ({ body, folded: footer })), { body, folded }],
	);
});

test("keeps a floor-plan link on a meeting join label", () => {
	const note =
		"Use this link for the plan.\nJoin Zoom Meeting: https://example.test/floor-plan";
	assert.deepEqual(cleanEmailThread([message(note)]), [
		{ body: note, folded: null },
	]);
});

test("matches complete earlier lines after whitespace and quote-marker normalization", () => {
	const oldest = "Could you send the suite 200 plan?\nUse the west door.";
	const later = "I only have the survey.";
	const reply =
		"Here is the plan.\r\n  >> Could you send the\u00a0suite\t200 plan?\r\n\t> Use the west door.\r\n> A line missing from the archive.\r\nPlease text when you arrive.";
	assert.deepEqual(
		cleanEmailThread([message(oldest), message(later), message(reply)]),
		[
			{ body: oldest, folded: null },
			{ body: later, folded: null },
			{
				body: "Here is the plan.\nPlease text when you arrive.",
				folded: "> A line missing from the archive.",
			},
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
			availableText([
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
	assert.deepEqual(availableText([message(earlier), message(reply)]), [
		earlier,
		`Here is the plan.\n${header}\nPlease use the west door.`,
	]);
});

test("unmarked repeated words and matches on only part of a line stay visible", () => {
	const earlier = "Use the west door.";
	const reply = `Quick update.\n${earlier}\n> Use the west door. I can arrive Monday.\nYou wrote: ${earlier} I can arrive Monday.`;
	assert.deepEqual(
		availableText([message(earlier), message(reply, "sam@example.test")]),
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
		assert.deepEqual(
			availableText([message(earlier), message(reply)]).map(oneLine),
			[earlier, oneLine(reply)],
		);
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
		assert.deepEqual(availableText([message(note)]).map(oneLine), [
			oneLine(note),
		]);
	}
});

test("same-sender recurrence needs two other messages", () => {
	const block = "Please copy the surveyor.\nThanks again.";
	const openings = [
		"I sent the plan.",
		"The keys are ready.",
		"Use the west door.",
		"The office is open.",
	];
	const messages = openings.map((opening, index) =>
		message(
			`${opening}\n${index === 2 ? block.replace("copy the", "copy  the") : block}`,
			index === 3
				? "sam@example.test"
				: index === 1
					? "MAYA@example.test"
					: undefined,
		),
	);
	assert.deepEqual(
		cleanEmailThread(messages.filter((_, index) => index !== 2)),
		[0, 1, 3].map((index) => ({
			body: `${openings[index]}\n${block}`,
			folded: null,
		})),
	);
	assert.deepEqual(
		cleanEmailThread(messages),
		openings.map((body, index) =>
			index === 3
				? { body: `${body}\n${block}`, folded: null }
				: {
						body,
						folded:
							index === 2 ? block.replace("copy the", "copy  the") : block,
					},
		),
	);
});

test("does not borrow a number in a sentence when another message puts it in a footer", () => {
	const note =
		"Here is the plan. Call the office at 555-010-2000\nmaya@example.test";
	const signed = "The plan is attached.\n555-010-2000\nmaya@example.test";
	assert.deepEqual(availableText([message(note), message(signed)]), [
		note,
		signed,
	]);
});

test("an instruction stays visible after a footer that recurs at the end of other messages", () => {
	const signed = [
		"The plan is ready.",
		"I sent the plan.",
		"The keys are upstairs.",
	];
	const messages = signed.map((body) => message(`${body}\n${footer}`));
	for (const postscript of [
		"Please text before you arrive.",
		"Please Text Before You Arrive.",
	]) {
		const body = `The keys are at the desk.\n\n${postscript}`;
		assert.deepEqual(
			cleanEmailThread([
				...messages,
				message(`The keys are at the desk.\n\n${footer}\n\n${postscript}`),
			]),
			[
				...signed.map((body) => ({ body, folded: footer })),
				{ body, folded: footer },
			],
		);
	}
});

test("a repeated instruction after a signature stays visible when it occurs twice", () => {
	const instruction = "Please text before you arrive.";
	const folded = "Maya Example\nDirect: 555-010-2000";
	const openings = ["The plan is ready.", "I sent the plan."];
	assert.deepEqual(
		cleanEmailThread(
			openings.map((opening) =>
				message(`${opening}\n${folded}\n${instruction}`),
			),
		),
		openings.map((opening) => ({ body: `${opening}\n${instruction}`, folded })),
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
				availableText([message(`${before}\n\n${invite}\n${after}`)]).map(
					oneLine,
				),
				[`${before} ${after}`],
			);
		}
	}
});

test("keeps a standalone invite and other messages with no surviving lines", () => {
	const earlier = "Use the west door.";
	const quote = `> ${earlier}`;
	const signature = `\n${footer}\n\n`;
	for (const body of ["", "  ", "Thanks", teams, zoom]) {
		assert.deepEqual(availableText([message(body)]), [body]);
	}
	assert.deepEqual(availableText([message(earlier), message(quote)]), [
		earlier,
		quote,
	]);
	assert.deepEqual(
		availableText([message(signature), message(footer), message(footer)]),
		[signature, footer, footer],
	);
});

test("invite details without a template and unrelated links remain visible", () => {
	const note =
		"Meeting ID: 12345\nPasscode: example\nJoin on your computer\nJoin with Google Meet\nhttps://meet.google.com/abc-defg-hij";
	const linkedNote =
		"Please join remotely.\nJoin Microsoft Teams Meeting\nhttps://example.test/join\nMeeting ID: 1234\n\nhttps://example.test/floor-plan";
	assert.deepEqual(availableText([message(note), message(linkedNote)]), [
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
	assert.deepEqual(availableText([message(folded), ...messages]), [
		folded,
		...replies,
	]);
});

function splitMessage(
	authored: string,
	history = "",
	sender = "maya@example.test",
) {
	return {
		...message([authored, history].filter(Boolean).join("\n\n"), sender),
		authored,
		history,
	};
}

test("moves a plain-text Outlook reply header block out of stored authored ahead of stored history", () => {
	const outlookHeader =
		"From: Sam Example <sam@example.test>\nSent: Mon, Jan 5, 2026 9:30 AM\nTo: Maya Example <maya@example.test>\nSubject: Suite 200";
	const singleStarred =
		"*From:* Sam Example <sam@example.test>\n*Sent:* Mon, Jan 5, 2026 9:30 AM\n*To:* Maya Example <maya@example.test>\n*Subject:* Suite 200";
	const doubleStarred =
		"**From:** Sam Example <sam@example.test>\n**Sent:** Mon, Jan 5, 2026 9:30 AM\n**To:** Maya Example <maya@example.test>\n**Subject:** Suite 200";
	const quotedEarlier = "Can we meet Tuesday at two?";
	const storedHistory = "Earlier thread history.";

	for (const block of [
		`${outlookHeader}\n\n${quotedEarlier}`,
		`${singleStarred}\n\n${quotedEarlier}`,
		`${doubleStarred}\n\n${quotedEarlier}`,
		`________________________________\n${outlookHeader}\n\n${quotedEarlier}`,
		`--------\n${singleStarred}\n\n${quotedEarlier}`,
		`> ${outlookHeader.replaceAll("\n", "\n> ")}\n>\n> ${quotedEarlier}`,
	]) {
		assert.deepEqual(
			cleanEmailThread([splitMessage(`Tuesday works.\n\n${block}`)]),
			[{ body: "Tuesday works.", folded: block }],
		);
		assert.deepEqual(
			cleanEmailThread([
				splitMessage(`Tuesday works.\n\n${block}`, storedHistory),
			]),
			[{ body: "Tuesday works.", folded: `${block}\n\n${storedHistory}` }],
		);
	}

	assert.deepEqual(
		cleanEmailThread([
			splitMessage(
				`________________________________\n${outlookHeader}\n\n${quotedEarlier}`,
				storedHistory,
			),
		]),
		[
			{
				body: "",
				folded: `________________________________\n${outlookHeader}\n\n${quotedEarlier}\n\n${storedHistory}`,
			},
		],
	);

	const proseDate =
		"Walkthrough details.\nDate: January 5, 2026\nMeet at the west door.";
	assert.deepEqual(
		cleanEmailThread([
			splitMessage(
				`${proseDate}\n\n${outlookHeader}\n\n${quotedEarlier}`,
				storedHistory,
			),
		]),
		[
			{
				body: proseDate,
				folded: `${outlookHeader}\n\n${quotedEarlier}\n\n${storedHistory}`,
			},
		],
	);

	const noteOnly =
		"Walkthrough details.\nDate: January 5, 2026\nSubject: Building walkthrough\nMeet at the west door.";
	assert.deepEqual(cleanEmailThread([splitMessage(noteOnly, storedHistory)]), [
		{ body: noteOnly, folded: storedHistory },
	]);
});
