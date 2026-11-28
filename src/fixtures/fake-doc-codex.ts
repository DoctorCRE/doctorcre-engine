#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";

const [command, ...args] = process.argv.slice(2);
const emit = (event: unknown) =>
	process.stdout.write(`${JSON.stringify(event)}\n`);
const variant = basename(process.argv[1] ?? "");

if (command === "--version") {
	console.log(
		variant === "unsupported" ? "codex-cli 9.0.0" : "codex-cli 0.172.0",
	);
} else if (command === "login") {
	assert.equal(args[0], "status");
	assert.equal(process.env.DOC_LINK_CREDENTIAL, undefined);
	assert.equal(process.env.OPENAI_API_KEY, undefined);
	console.error(
		variant === "signed-out"
			? "Not logged in"
			: variant === "api-key"
				? "API key configured"
				: "Logged in using ChatGPT",
	);
	process.exitCode = variant === "signed-out" ? 1 : 0;
} else if (command === "app-server") {
	assert.equal(process.env.DOC_LINK_CREDENTIAL, undefined);
	for await (const line of createInterface({ input: process.stdin })) {
		const request = JSON.parse(line);
		if (request.method === "initialize") emit({ id: 1, result: {} });
		if (request.method === "account/read") {
			emit({
				id: 2,
				result: {
					requiresOpenaiAuth: true,
					account: {
						type: "chatgpt",
						planType: variant === "business" ? "business" : "plus",
					},
				},
			});
			break;
		}
	}
} else {
	assert.equal(command, "exec");
	const input = JSON.parse(readFileSync(0, "utf8"));
	const prompt =
		args.find((arg) => arg.startsWith("developer_instructions=")) ?? "";
	assert.ok(args.includes("--ephemeral"));
	assert.ok(args.includes("--json"));
	assert.equal(process.env.OPENAI_API_KEY, undefined);
	assert.equal(args.at(-1), "-");

	const isolationFlags = [
		"--ignore-user-config",
		"--ignore-rules",
		"read-only",
		"project_doc_max_bytes=0",
	];
	for (const flag of isolationFlags)
		assert.equal(args.includes(flag), !input.turn, flag);
	assert.equal(args.includes("--sandbox"), !input.turn);
	const disabled = args.flatMap((arg, index) =>
		arg === "--disable" ? [args[index + 1]] : [],
	);
	for (const feature of ["shell_tool", "apps", "plugins", "hooks"])
		assert.equal(disabled.includes(feature), !input.turn, feature);
	assert.ok(!args.includes("--enable"));

	if (variant === "partner-config") {
		assert.ok(process.env.CODEX_HOME);
		assert.match(
			readFileSync(join(process.env.CODEX_HOME, "config.toml"), "utf8"),
			/shell_tool = true/,
		);
	}

	const mcp = args.find((arg) => arg.startsWith("mcp_servers"));
	if (input.turn) {
		assert.match(prompt, /Use validate_answer/);
		assert.match(
			mcp ?? "",
			/^mcp_servers\.doc=\{url="https:\/\/engine\.example\.test\/api\/engine\/doc\/mcp"/,
		);
		assert.match(mcp ?? "", /bearer_token_env_var="DOC_LINK_CREDENTIAL"/);
		assert.match(
			mcp ?? "",
			/"Doc-Claim-Id"="8b97c249-aee2-46a1-9cfb-3c5b9f9d84b6"/,
		);
		assert.match(
			mcp ?? "",
			/enabled_tools=\["find","read","mail_priorities","read_mail","propose_save","validate_answer"\]/,
		);
		assert.equal(process.env.DOC_LINK_CREDENTIAL, "x".repeat(43));
		assert.ok(args.every((arg) => !arg.includes("x".repeat(43))));
	} else {
		assert.equal(mcp, "mcp_servers={}");
		assert.equal(process.env.DOC_LINK_CREDENTIAL, undefined);
		assert.match(prompt, /untrusted data/);
		assert.ok(!prompt.includes(input.body));
	}

	const message = (text: string) =>
		emit({ type: "item.completed", item: { type: "agent_message", text } });
	if (
		input.turn?.question === "Expired sign-in" ||
		input.turn?.question.startsWith("Plan limit")
	) {
		emit({
			type: "turn.failed",
			error: {
				message:
					input.turn.question === "Plan limit with reset"
						? "You’ve hit your usage limit. Purchase more credits or try again at Jan 2nd, 1970 4:40 PM."
						: input.turn.question === "Plan limit"
							? "You’ve hit your usage limit. Try again later."
							: "Your access token could not be refreshed. Please log out and sign in again.",
			},
		});
		process.exitCode = 1;
	} else {
		message(JSON.stringify({ ignored: "intermediate" }));
		const answer = input.turn
			? {
					kind: "answer",
					text: "The requested record is open.",
					sources: ["deal:example"],
					proposal: null,
				}
			: input.destinations
				? {
						facts: [
							{
								destination: input.destinations[0],
								text: input.body,
								quote: input.body,
							},
						],
					}
				: input.candidates
					? { introductions: [] }
					: prompt.includes("List the paragraphs")
						? { authored: input.body.split("\n\n") }
						: { summary: input.body, action_title: null, quote: input.body };
		message(
			input.turn?.question === "Invalid format"
				? "not JSON"
				: JSON.stringify(answer),
		);
		if (input.turn?.question !== "Interrupted")
			emit({ type: "turn.completed" });
	}
}
