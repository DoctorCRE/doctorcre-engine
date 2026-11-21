import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanEmailBody } from "./home-email-thread.ts";

test("cleans a large body with an incomplete header promptly", () => {
	const body = `Current message.\nFrom: Pat\n${" ".repeat(100_000)}\n${"x".repeat(100_000)}`;
	const start = performance.now();
	const result = cleanEmailBody(body, null);
	const elapsed = performance.now() - start;
	assert.ok(result.endsWith("x".repeat(100_000)));
	assert.ok(elapsed < 50, `cleanup took ${elapsed} ms`);
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
