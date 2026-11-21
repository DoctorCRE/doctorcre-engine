#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const emit = (event: unknown) =>
	process.stdout.write(`${JSON.stringify(event)}\n`);
const finished = (result: unknown) =>
	emit({
		type: "result",
		subtype: "success",
		is_error: false,
		result: JSON.stringify(result),
	});

if (args.includes("auth")) {
	const capture = join(import.meta.dirname, "auth-args.json");
	if (existsSync(capture)) writeFileSync(capture, JSON.stringify(args));
	emit({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "pro" });
} else {
	const input = JSON.parse(readFileSync(0, "utf8"));
	const question = input.turn?.question ?? input.subject;
	if (!input.turn) {
		const valueAfter = (flag: string) => args[args.indexOf(flag) + 1];
		assert.ok(args.includes("--strict-mcp-config"));
		assert.equal(valueAfter("--tools"), "");
		assert.deepEqual(JSON.parse(valueAfter("--mcp-config") ?? ""), {
			mcpServers: {},
		});
		assert.equal(process.env.DOC_LINK_CREDENTIAL, undefined);
		const prompt = valueAfter("--system-prompt") ?? "";
		assert.match(prompt, /untrusted data/);
		assert.ok(!prompt.includes(input.body));
	}
	if (question === "Expired sign-in") {
		emit({ type: "assistant", error: "authentication_failed" });
		emit({ type: "result", subtype: "error_during_execution", is_error: true });
		process.exitCode = 1;
	} else if (question === "Plan limit") {
		emit({
			type: "rate_limit_event",
			rate_limit_info: {
				status: "rejected",
				resetsAt: 200,
				errorCode: "credits_required",
			},
		});
		emit({ type: "result", subtype: "error_during_execution", is_error: true });
		process.exitCode = 1;
	} else if (!input.turn) {
		const quote = input.body.split("\n")[0];
		finished(
			input.destinations
				? {
						facts: [{ destination: input.destinations[0], text: quote, quote }],
					}
				: { summary: quote, action_title: null, quote },
		);
	} else {
		emit({ type: "system", subtype: "init" });
		emit({
			type: "rate_limit_event",
			rate_limit_info: { status: "allowed_warning" },
		});
		emit({
			type: "assistant",
			message: { content: [{ type: "text", text: "intermediate" }] },
		});
		const answer = {
			kind: "answer",
			text:
				question === "Inspect"
					? JSON.stringify({
							args,
							input,
							credential: process.env.DOC_LINK_CREDENTIAL,
							inheritedKey: process.env.ANTHROPIC_API_KEY,
						})
					: "The requested record is open.",
			sources: ["deal:example"],
			proposal: null,
		};
		finished(
			question === "No match"
				? { kind: "clarification", text: "Which client?", sources: [] }
				: answer,
		);
	}
}
