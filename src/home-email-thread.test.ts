import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanEmailBody, cleanEmailThread } from "./home-email-thread.ts";

test("cleans a large body with an incomplete header promptly", () => {
	const body = `Current message.\nFrom: Pat\n${" ".repeat(100_000)}\n${"x".repeat(100_000)}`;
	const start = performance.now();
	const result = cleanEmailBody(body, null);
	const elapsed = performance.now() - start;
	assert.ok(result.endsWith("x".repeat(100_000)));
	assert.ok(elapsed < 50, `cleanup took ${elapsed} ms`);
});

test("cleans a 200,000-character body with dividers and incomplete headers in under 100 ms", () => {
	const noise = `${"-".repeat(50_000)} ${"_".repeat(50_000)} ${"From: Pat Sent: 1 On Friday ".repeat(4_000)}`;
	const message = `Current message. ${noise}`;
	const body = `${message.slice(0, 199_999)}.`;
	const start = performance.now();
	const result = cleanEmailBody(body, null);
	const elapsed = performance.now() - start;
	assert.equal(result, body);
	assert.ok(elapsed < 100, `cleanup took ${elapsed} ms`);
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

test("keeps only the sender's new words from common mail shapes", () => {
	const cases = [
		{
			shape: "CRLF signature with title, phone and email",
			body: "Could you send the suite 200 plan?\r\n\r\nThanks,\r\nMaya\r\nMaya Example | Office Manager\r\nExample Dental Group\r\nC: 555-010-2000\r\nmaya@example.test",
			kept: "Could you send the suite 200 plan?",
		},
		{
			shape: "signature with no sign-off",
			body: "Tuesday works.\n\nMaya Example\nExample Dental Group\n(555) 010-2000",
			kept: "Tuesday works.",
		},
		{
			shape: "Outlook divider and multi-line header block",
			body: "Here is the plan.\r\n\r\n________________________________\r\n*From:* Maya Example <maya@example.test>\r\n\r\n*Sent:* Monday, January 5, 2026 9:00 AM\r\n*To:* Example Partner <partner@example.test>\r\n*Cc:* Office <office@example.test>\r\n*Subject:* Suite 200\r\n\r\nCould you send the plan?",
			kept: "Here is the plan.",
		},
		{
			shape: "wrapped On ... wrote: line",
			body: "Tuesday at 10 works.\r\n\r\nOn Mon, Jan 5, 2026 at 9:30 AM Example Partner <\r\npartner@example.test> wrote:\r\nHere is the plan.\r\nFrom: Maya Example\r\nCould you send it?",
			kept: "Tuesday at 10 works.",
		},
		{
			shape: "forwarded block",
			body: "Sharing the landlord's note below.\r\n\r\n---------- Forwarded message ---------\r\nFrom: Landlord Example <landlord@example.test>\r\nDate: Tue, Jan 6, 2026\r\nSubject: Suite 200\r\n\r\nThe suite opens in March.",
			kept: "Sharing the landlord's note below.",
		},
		{
			shape: "mobile footer",
			body: "Sounds good.\n\nSent from my iPhone",
			kept: "Sounds good.",
		},
	];
	for (const { shape, body, kept } of cases) {
		assert.equal(cleanEmailBody(body, "Maya Example"), kept, shape);
	}
});

test("keeps the sender's words that only look like a footer", () => {
	for (const body of [
		"Thanks,\nMaya\nP.S. Bring the keys on Tuesday.",
		"Here are the two numbers.\n----\nCall the landlord at 555-010-3000.",
		"Best,\nhttps://example.test/floor-plan",
	]) {
		assert.equal(cleanEmailBody(body, "Maya Example"), body);
	}
});

test("keeps sentences that follow a sign-off or the sender's name", () => {
	for (const body of [
		"Thanks,\nMaya\nPlease call (555) 010-2000 if the plan is wrong.",
		"Thanks,\nMaya\nThe tour is 2026-01-06 at the side door.",
		"The after-hours line is below.\n\nMaya Example\n(555) 010-2000\n\nPlease text before you arrive.",
		"I left the plan at the desk.\n\nMaya Example called.\nThe number is (555) 010-2000.",
	]) {
		assert.equal(cleanEmailBody(body, "Maya Example"), body);
	}
});

test("never empties a message that is only a sign-off or a signature", () => {
	for (const body of [
		"-----",
		"Thanks",
		"Cheers",
		"Thanks!",
		"Thanks,\nMaya",
		"Maya Example\n(555) 010-2000\nmaya@example.test",
	]) {
		assert.equal(cleanEmailBody(body, "Maya Example"), body);
	}
});

test("keeps sentences that start like a header, contact label or mobile footer", () => {
	for (const body of [
		"Please come in.\n\nFrom: the side door, not the lobby.",
		"From: the side door.\nDate: Tuesday is better than Monday.",
		"Cell: the one on Main Street is the right suite.",
		"Sent from my office this morning with the keys.",
	]) {
		assert.equal(cleanEmailBody(body, "Maya Example"), body);
	}
});

test("cuts quoted history only at a whole On <date> ... wrote: line", () => {
	for (const body of [
		"On Monday we can tour.\nI already wrote:\nthe suite is ready.",
		"On Friday the landlord wrote:\nThe suite opens in March.",
	]) {
		assert.equal(cleanEmailBody(body, "Maya Example"), body);
	}
});

const maya = "Maya Example";
const mayaSignature =
	"Best, Maya Example Office Manager | Example Dental Group Direct: (555) 010-2000 | Main: (555) 010-3000 |";
const outlookHeader =
	"From: Sam Partner <sam@example.test> Sent: Monday, October 26, 2026 12:19 PM To: Maya Example <maya@example.test> Cc: Office <office@example.test> Subject: RE: Suite 200";

const signature =
	"Maya Example | regional leasing manager | Direct: 555-010-2000 | Main: 555-010-3000 | Telephone: 555-010-4000 | Fax: 555-010-5000 | Cell: 555-010-6000 | maya@example.test | License 12345";

function message(
	body: string,
	sender = "maya@example.test",
	sender_name = maya,
) {
	return { body, sender, sender_name };
}

test("keeps a repeated opening inside a reply and cuts a complete bare repeat", () => {
	const first =
		"Thanks for taking the time to walk through the building with us today. I will send the survey.";
	const reply =
		"Quick update. Thanks for taking the time to walk through the building with us today. I can meet on Monday.";
	const inline = `You wrote: ${first} I can meet on Monday.`;
	assert.deepEqual(
		cleanEmailThread([
			message(first),
			message(reply, "sam@example.test", "Sam Partner"),
			message(inline, "sam@example.test", "Sam Partner"),
			message(`I have the survey. ${first}`, "sam@example.test", "Sam Partner"),
		]),
		[first, reply, inline, "I have the survey."],
	);
});

test("keeps a shared closing instruction from the same sender", () => {
	for (const closing of [
		"Please copy the surveyor on every update.",
		"Thanks for copying the surveyor on every update.",
	]) {
		const bodies = [
			`The plan is ready. ${closing}`,
			`I sent the plan. ${closing}`,
		];
		assert.deepEqual(
			cleanEmailThread(bodies.map((body) => message(body))),
			bodies,
		);
	}
});

test("keeps a shared closing instruction before a shared contact footer", () => {
	const closing = "Please copy the surveyor on every update.";
	for (const { separator, footer } of [
		{ separator: "\n\n", footer: "Direct: 555-010-2000\nmaya@example.test" },
		{
			separator: " ",
			footer: "Best, Maya Example | Direct: 555-010-2000 | maya@example.test",
		},
	]) {
		const bodies = ["The plan is ready.", "I sent the plan."].map(
			(update) => `${update} ${closing}`,
		);
		assert.deepEqual(
			cleanEmailThread(
				bodies.map((body) => message(`${body}${separator}${footer}`)),
			),
			bodies,
			footer,
		);
	}
});

test("cuts quoted Outlook headers and wrapped reply openers", () => {
	const earlier = "Could you send the suite 200 plan?";
	const reply = "Here is the plan.";
	for (const boundary of [
		"> From: Maya Example\n> Date: Mon, Jan 5, 2026\n> To: Sam Partner\n> Subject: Suite 200",
		"> > On Mon, Jan 5, 2026 at 9:30 AM\n\t>> Maya Example <maya@example.test> wrote:",
	]) {
		assert.deepEqual(
			cleanEmailThread([
				message(earlier),
				message(
					`${reply}\n\n${boundary}\n> ${earlier}\n> Older thread text.`,
					"sam@example.test",
				),
			]),
			[earlier, reply],
			boundary,
		);
	}
});

test("keeps an authored CC sentence before an Outlook header", () => {
	const earlier =
		"Could you send the survey and the plan for suite 200 by Friday?";
	const reply = "Here is the plan.\nCC: Please also copy the surveyor.";
	const headers =
		"From: Maya Example\nDate: Mon, Jan 5, 2026\nTo: Sam Partner\nSubject: Suite 200";
	assert.deepEqual(
		cleanEmailThread([
			message(earlier),
			message(`${reply}\n${headers}\n${earlier}`, "sam@example.test"),
		]),
		[earlier, reply],
	);
});

test("cuts a wrapped quote opener before the earlier text", () => {
	const earlier =
		"Could you send the survey and the plan for suite 200 by Friday?";
	assert.deepEqual(
		cleanEmailThread([
			message(earlier),
			message(
				`Here is the plan.\r\n\r\nOn Mon, Jan 5, 2026 at 9:30 AM Maya Example <\r\nmaya@example.test> wrote:\r\n> ${earlier}`,
				"sam@example.test",
			),
		]),
		[earlier, "Here is the plan."],
	);
});

test("cuts a short earlier message after a divider even with older text after it", () => {
	const earlier = "Could you send the suite 200 plan?";
	assert.deepEqual(
		cleanEmailThread([
			message(earlier),
			message(`Here is the plan.\n\n________\n> ${earlier}\nOlder email text.`),
		]),
		[earlier, "Here is the plan."],
	);
});

test("cuts a reordered Date header and a rewrapped quote of a nonadjacent email", () => {
	const first =
		"Could you send the survey and the plan for suite 200 by Friday?";
	const second = "I only have the survey in my inbox at the moment.";
	const third = "I can send the plan.\nPlease use the west door";
	assert.deepEqual(
		cleanEmailThread([
			message(first),
			message(second, "sam@example.test", "Sam Example"),
			message(
				`${third} Subject: RE: Suite 200. To: Pat Example Date: Tue, Jan 6, 2026 From: Maya Example <maya@example.test>\n> COULD YOU SEND THE SURVEY\n> and the plan for suite 200 by Friday?`,
				"pat@example.test",
				"Pat Example",
			),
		]),
		[first, second, third],
	);
});

test("drops the shared signature by sender address after cutting quotes", () => {
	const first = "Please leave the marked survey on the desk in suite 200.";
	const second = "I've sent it to the surveyor instead.";
	const third = "Let me know if you need the plan too";
	const otherSender = `The back door is open. ${signature}`;
	assert.deepEqual(
		cleanEmailThread([
			message(`${first} ${signature}`),
			message(
				`${second} ${signature.toUpperCase()} ${first}`,
				"MAYA@example.test",
				"M. Example",
			),
			message(`${third}\n${signature.replaceAll(" | ", "\n| ")}`),
			message(otherSender, "other@example.test"),
		]),
		[first, second, third, otherSender],
	);
});

test("drops recurring calendar boilerplate and keeps a message made entirely of it", () => {
	const invite = "Teams Meeting Dial in by phone 555-010-2000 View map Guests";
	assert.deepEqual(
		cleanEmailThread([
			message(`Please meet at the west door. ${invite}`),
			message(`The meeting has moved to Thursday. ${invite}`),
			message(invite),
		]),
		[
			"Please meet at the west door.",
			"The meeting has moved to Thursday.",
			invite,
		],
	);
});

test("cleans an eleven-message carried chain of ten thousand characters per message in under 50 ms", () => {
	const bodies: string[] = [];
	const expected: string[] = [];
	for (let index = 0; index < 11; index++) {
		const own = `Update ${index + 1}: the surveyor will leave the plans by the west door.`;
		const previous = bodies.at(-1);
		const body = previous
			? `${own} ${signature} From: Maya Example Date: Jan 6, 2026 To: Sam Example Subject: Plans ${previous}`
			: `${own} ${"Plan ".repeat(2000).slice(0, 9999 - own.length - signature.length - 1)} ${signature}`;
		expected.push(previous ? own : body.slice(0, -signature.length).trimEnd());
		bodies.push(body.slice(0, 10_000));
	}
	const messages = bodies.map((body) => message(body));
	const start = performance.now();
	const cleaned = cleanEmailThread(messages);
	const elapsed = performance.now() - start;
	assert.deepEqual(cleaned, expected);
	assert.ok(elapsed < 50, `cleanup took ${elapsed} ms`);
});

test("keeps only the sender's new words when the body was stored as one line", () => {
	const cases = [
		{
			shape: "signature and Outlook header run",
			body: `Tuesday works for the tour. ${mayaSignature} ${outlookHeader} Could you send the suite 200 plan?`,
			kept: "Tuesday works for the tour.",
		},
		{
			shape: "external-sender banner",
			body: "You don't often get email from maya@example.test. Learn why this is important Could you send the suite 200 plan?",
			kept: "Could you send the suite 200 plan?",
		},
		{
			shape: "nested On ... wrote: quotes",
			body: "Sounds good. On Mon, Oct 26, 2026 at 12:19 PM Sam Partner <sam@example.test> wrote: Here is the plan. On Sun, Oct 25, 2026 at 9:00 AM Maya Example <maya@example.test> wrote: Could you send it?",
			kept: "Sounds good.",
		},
		{
			shape: "Outlook divider and original message marker",
			body: `Here is the plan. ________________________________ ${outlookHeader} Could you send it? -----Original Message----- Old text.`,
			kept: "Here is the plan.",
		},
		{
			shape: "sign-off after a sentence with no period",
			body: "Let me know if Tuesday works Thank you, Maya (555) 010-2000 maya@example.test",
			kept: "Let me know if Tuesday works",
		},
	];
	for (const { shape, body, kept } of cases) {
		assert.equal(cleanEmailBody(body, maya), kept, shape);
	}
});

test("keeps one-line sentences that only resemble a sign-off, header or quote", () => {
	for (const body of [
		"I wanted to say thanks, Maya Example (555) 010-2000.",
		"Thanks, Maya. Please call (555) 010-2000 if the plan is wrong.",
		"Tuesday works. Thank you, Maya. Please leave the keys outside.",
		"Best, Maya Example Please bring the keys on Tuesday.",
		"From: the side door. Sent: the plan on Tuesday. Subject: parking.",
		"On Monday we can tour. On 5 May I sent the plan and you replied.",
		"Thanks, Maya Example (555) 010-2000",
	]) {
		assert.equal(cleanEmailBody(body, maya), body);
	}
});

test("removes a one-line signature with punctuation after the sender's name", () => {
	for (const punctuation of [".", ","]) {
		assert.equal(
			cleanEmailBody(
				`Tuesday works. Thank you, Maya${punctuation} (555) 010-2000 maya@example.test`,
				maya,
			),
			"Tuesday works.",
		);
	}
});

test("a carried chain of eleven one-line messages shows each message's new text once", () => {
	const sam = {
		name: "Sam Partner",
		signature:
			"Thanks, Sam Sam Partner | Partner Example Realty Cell: 555-010-4000",
	};
	const thread: { sender: string; body: string; kept: string }[] = [];
	for (let index = 0; index < 11; index++) {
		const { name, signature } =
			index % 2 ? sam : { name: maya, signature: mayaSignature };
		const kept = `Message ${index + 1} about suite 200 is here.`;
		const earlier = thread.at(-1);
		const quote = !earlier
			? ""
			: index % 3 === 0
				? ` On Mon, Oct ${index + 10}, 2026 at 9:00 AM ${earlier.sender} <old@example.test> wrote: ${earlier.body}`
				: ` From: ${earlier.sender} <old@example.test> Sent: Monday, October ${index + 10}, 2026 9:00 AM To: ${name} <new@example.test> Subject: RE: Suite 200 ${earlier.body}`;
		const banner =
			index % 2
				? "You don't often get email from sam@example.test. Learn why this is important "
				: "";
		thread.push({
			sender: name,
			body: `${banner}${kept} ${signature}${quote}`,
			kept,
		});
	}
	assert.deepEqual(
		thread.map(({ body, sender }) => cleanEmailBody(body, sender)),
		thread.map(({ kept }) => kept),
	);
});
