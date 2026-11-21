import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { runDocLink } from "../scripts/doc-link.ts";

const credential = "x".repeat(43);
const engine = "https://engine.example.test";
const claude = fileURLToPath(
	new URL("./fixtures/fake-doc-claude.ts", import.meta.url).href,
);
const firstClaim = "8b97c249-aee2-46a1-9cfb-3c5b9f9d84b6";
const secondClaim = "876f42ed-1b39-4d13-a5c8-af599539907a";
const context = { kind: "deal", id: "c0a0d936-615b-45ec-924c-f61550a68354" };
const history = [
	{ question: "Prior question", answer: { text: "Prior answer" } },
];

function claimed(question: string, claimId = firstClaim, until = 120_000) {
	return Response.json({
		kind: "turn",
		claim_id: claimId,
		claim_until: new Date(until).toISOString(),
		conversation_id: "c687fcb1-1872-4e5c-a2d2-078d1d937188",
		turn: {
			id: "17e83432-f8ab-46d8-b904-339734768ddd",
			question,
			position: 2,
			context,
		},
		history,
	});
}

const status = (code: number) => new Response(null, { status: code });

async function link(
	...replies: (Response | "drop" | { reply: Response; now: number })[]
) {
	let now = 60_000;
	const requests: Request[] = [];
	await runDocLink(
		{ engine, claude, credential },
		{
			now: () => now,
			wait: async () => {
				now += 2_000;
			},
			async fetch(url, init) {
				requests.push(new Request(url, init));
				const reply = replies.shift();
				if (reply === "drop") throw new TypeError("connection dropped");
				if (reply instanceof Response) return reply;
				if (!reply) return status(401);
				now = reply.now;
				return reply.reply;
			},
		},
	);
	assert.equal(replies.length, 0);
	for (const request of requests) {
		assert.equal(request.method, "POST");
		assert.equal(request.headers.get("Authorization"), `Bearer ${credential}`);
		assert.equal(request.headers.get("Cookie"), null);
		assert.equal(request.redirect, "error");
	}
	return Promise.all(
		requests.map(async (request) => ({
			path: new URL(request.url).pathname,
			readiness: request.headers.get("Doc-Link-Readiness"),
			body: request.body ? await request.json() : null,
		})),
	);
}

const poll = (readiness: string) => ({
	path: "/api/engine/doc/link/claim",
	readiness,
	body: null,
});
const result = (body: unknown) => ({
	path: "/api/engine/doc/link/result",
	readiness: null,
	body,
});
const answered = (claimId: string) =>
	result({
		claim_id: claimId,
		kind: "answered",
		answer: {
			kind: "answer",
			text: "The requested record is open.",
			sources: ["deal:example"],
			proposal: null,
		},
	});

test("Doc link runs a private Claude print session and submits only the final answer", async (t) => {
	const inheritedKey = process.env.ANTHROPIC_API_KEY;
	process.env.ANTHROPIC_API_KEY = "unused test key";
	t.after(() => {
		if (inheritedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
		else process.env.ANTHROPIC_API_KEY = inheritedKey;
	});
	const [claim, completion, next] = await link(claimed("Inspect"), status(204));
	assert.deepEqual(claim, poll("ready"));
	assert.deepEqual(next, poll("ready"));
	assert.ok(completion);
	assert.equal(completion.path, "/api/engine/doc/link/result");
	const { claim_id, answer } = z
		.object({
			claim_id: z.string(),
			kind: z.literal("answered"),
			answer: z.object({ text: z.string(), sources: z.array(z.string()) }),
		})
		.parse(completion.body);
	assert.equal(claim_id, firstClaim);
	assert.deepEqual(answer.sources, ["deal:example"]);
	const observed = JSON.parse(answer.text);
	const mcpIndex = observed.args.indexOf("--mcp-config");
	assert.deepEqual(JSON.parse(observed.args[mcpIndex + 1]), {
		mcpServers: {
			doc: {
				type: "http",
				url: `${engine}/api/engine/doc/mcp`,
				headers: {
					Authorization: `Bearer \${DOC_LINK_CREDENTIAL}`,
					"Doc-Claim-Id": firstClaim,
				},
			},
		},
	});
	const promptIndex = observed.args.indexOf("--system-prompt");
	assert.match(observed.args[promptIndex + 1], /current turn.*sources/s);
	observed.args[mcpIndex + 1] = "<MCP config>";
	observed.args[promptIndex + 1] = "<fixed prompt>";
	assert.deepEqual(observed.args, [
		"--setting-sources",
		"",
		"-p",
		"--output-format",
		"stream-json",
		"--verbose",
		"--no-session-persistence",
		"--no-chrome",
		"--disable-slash-commands",
		"--tools",
		"",
		"--settings",
		'{"disableAllHooks":true,"disableClaudeAiConnectors":true}',
		"--strict-mcp-config",
		"--mcp-config",
		"<MCP config>",
		"--permission-mode",
		"dontAsk",
		"--allowedTools",
		"mcp__doc__find,mcp__doc__read,mcp__doc__propose_save,mcp__doc__validate_answer",
		"--system-prompt",
		"<fixed prompt>",
	]);
	assert.deepEqual(observed.input, {
		turn: { question: "Inspect", context },
		history,
	});
	assert.equal(observed.credential, credential);
	assert.equal(observed.inheritedKey, undefined);
});

test("Doc link reconnects after dropped polls and retries the same completion after a dropped response", async () => {
	assert.deepEqual(
		await link("drop", claimed("Question"), "drop", status(404)),
		[
			poll("ready"),
			poll("ready"),
			answered(firstClaim),
			answered(firstClaim),
			poll("ready"),
		],
	);
});

test("Doc link releases a claim when sign-in expires and resumes the queued turn after sign-in", async () => {
	assert.deepEqual(
		await link(
			claimed("Expired sign-in"),
			status(204),
			{ reply: status(204), now: 93_000 },
			claimed("Question", secondClaim, 150_000),
			status(204),
		),
		[
			poll("ready"),
			result({ claim_id: firstClaim, kind: "signed_out" }),
			poll("signed_out"),
			poll("ready"),
			answered(secondClaim),
			poll("ready"),
		],
	);
});

test("Doc link reports a plan limit and waits for its reported reset before claiming again", async () => {
	assert.deepEqual(
		await link(
			claimed("Plan limit"),
			status(204),
			status(204),
			{ reply: status(204), now: 201_000 },
			claimed("Question", secondClaim, 260_000),
			status(204),
		),
		[
			poll("ready"),
			result({ claim_id: firstClaim, kind: "plan_limited" }),
			poll("plan_limited"),
			poll("plan_limited"),
			poll("ready"),
			answered(secondClaim),
			poll("ready"),
		],
	);
});

test("Doc link drops a late result and accepts a fresh claim for the same turn", async () => {
	assert.deepEqual(
		await link(
			claimed("Question"),
			{ reply: status(404), now: 121_000 },
			claimed("Question", secondClaim, 180_000),
			status(204),
		),
		[
			poll("ready"),
			answered(firstClaim),
			poll("ready"),
			answered(secondClaim),
			poll("ready"),
		],
	);
});
