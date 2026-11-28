#!/usr/bin/env node
import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const path = join(import.meta.dirname, "user-settings.json");
const settings = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
const isolated = args.includes("--setting-sources");
const emit = (event: unknown) =>
	process.stdout.write(`${JSON.stringify(event)}\n`);
const finished = (result: unknown) =>
	emit({
		type: "result",
		subtype: "success",
		is_error: false,
		result: JSON.stringify(result),
	});

const valueAfter = (flag: string) => args[args.indexOf(flag) + 1];
const doc = args.includes("--mcp-config")
	? JSON.parse(valueAfter("--mcp-config") ?? "").mcpServers.doc
	: undefined;
const connectionFails = Boolean(
	settings.fixtureDisconnected && doc?.headers["Doc-Claim-Id"] !== "readiness",
);
type FixtureInput = {
	readiness?: boolean;
	turn?: { question: string };
	subject?: string;
	body: string;
	candidates?: unknown[];
	destinations?: unknown[];
};
let streamedInput: FixtureInput | undefined;
if (args.includes("--input-format")) {
	assert.equal(valueAfter("--input-format"), "stream-json");
	for await (const line of createInterface({ input: process.stdin })) {
		const message = JSON.parse(line);
		if (message.type === "user") {
			streamedInput = JSON.parse(message.message.content);
			break;
		}
		assert.equal(message.type, "control_request");
		emit({
			type: "control_response",
			response: {
				request_id: message.request_id,
				subtype: "success",
				response:
					message.request.subtype === "mcp_status"
						? {
								mcpServers: [
									{
										name: "doc",
										status: connectionFails ? "failed" : "connected",
									},
								],
							}
						: {},
			},
		});
	}
	if (!streamedInput) process.exit(0);
}

if (args.includes("auth")) {
	const capture = join(import.meta.dirname, "auth-args.json");
	if (existsSync(capture)) appendFileSync(capture, `${JSON.stringify(args)}\n`);
	emit({
		loggedIn: !(isolated && settings.fixtureIsolatedSignedOut),
		authMethod:
			!isolated && settings.env?.ANTHROPIC_AUTH_TOKEN
				? "oauth_token"
				: "claude.ai",
		subscriptionType: "pro",
	});
} else {
	const input: FixtureInput =
		streamedInput ?? JSON.parse(readFileSync(0, "utf8"));
	const probe = input.readiness === true;
	if (!probe && input.turn && settings.fixtureAction)
		appendFileSync(join(import.meta.dirname, "action.log"), "ran\n");
	const question = input.turn?.question ?? input.subject;
	let prompt = "";
	if (probe ? isolated : !input.turn) {
		assert.equal(valueAfter("--setting-sources"), "");
		assert.deepEqual(JSON.parse(valueAfter("--settings") ?? ""), {
			disableAllHooks: true,
			disableClaudeAiConnectors: true,
		});
		assert.equal(valueAfter("--permission-mode"), "dontAsk");
		assert.ok(args.includes("--no-chrome"));
		assert.ok(args.includes("--strict-mcp-config"));
		assert.equal(valueAfter("--tools"), "");
		assert.deepEqual(JSON.parse(valueAfter("--mcp-config") ?? ""), {
			mcpServers: {},
		});
		assert.equal(process.env.DOC_LINK_CREDENTIAL, undefined);
		prompt = valueAfter("--system-prompt") ?? "";
		if (!probe) {
			assert.match(prompt, /untrusted data/);
			assert.ok(!prompt.includes(input.body));
		}
	}
	if (!isolated) {
		assert.match(
			doc.headers["Doc-Claim-Id"],
			probe ? /^readiness$/ : /^[a-f0-9-]{36}$/,
		);
		assert.match(process.env.DOC_LINK_CREDENTIAL ?? "", /^[A-Za-z0-9_-]{43}$/);
		emit({
			type: "system",
			subtype: "init",
			mcp_servers: [
				{
					name: "doc",
					status:
						connectionFails ||
						(!probe && settings.fixtureDisconnectsAfterPrompt)
							? "failed"
							: "connected",
				},
			],
		});
	}
	if (probe) {
		finished({ ready: true });
	} else if (question === "Expired sign-in") {
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
		const authored = input.body
			.split(/\n\n/)
			.map((part: string) => part.trim())
			.filter(Boolean);
		finished(
			prompt.includes('{"authored"')
				? { authored }
				: input.candidates
					? { introductions: [] }
					: input.destinations
						? {
								facts: [
									{ destination: input.destinations[0], text: quote, quote },
								],
							}
						: { summary: quote, action_title: null, quote },
		);
	} else {
		emit({
			type: "rate_limit_event",
			rate_limit_info: { status: "allowed_warning" },
		});
		emit({
			type: "assistant",
			message: { content: [{ type: "text", text: "intermediate" }] },
		});
		if (question === "Invalid format") {
			emit({
				type: "result",
				subtype: "success",
				is_error: false,
				result: "not JSON",
			});
			process.exit(0);
		}
		const answer = {
			kind: "answer",
			text:
				question === "Inspect"
					? JSON.stringify({
							args,
							input,
							credential: process.env.DOC_LINK_CREDENTIAL,
							inheritedKey: process.env.ANTHROPIC_API_KEY,
							user: process.env.USER,
							logname: process.env.LOGNAME,
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
