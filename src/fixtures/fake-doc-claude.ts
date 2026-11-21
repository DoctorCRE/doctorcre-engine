#!/usr/bin/env node
import { deepEqual } from "node:assert/strict";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const emit = (event: unknown) =>
	process.stdout.write(`${JSON.stringify(event)}\n`);

if (args.includes("auth")) {
	deepEqual(args, ["auth", "status"]);
	emit({ loggedIn: true, authMethod: "claude.ai" });
} else {
	const input = JSON.parse(readFileSync(0, "utf8"));
	const question = input.turn.question;
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
		emit({
			type: "result",
			subtype: "success",
			is_error: false,
			result: JSON.stringify(answer),
		});
	}
}
