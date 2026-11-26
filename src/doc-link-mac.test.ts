import assert from "node:assert/strict";
import {
	chmod,
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rmdir,
	unlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { readDocLinkConfig, runDocLink } from "../scripts/doc-link.ts";

beforeEach(() => mock.timers.enable({ apis: ["setInterval"] }));
afterEach(() => mock.timers.reset());

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

function summaryClaim(subject: string, until = 120_000) {
	return Response.json({
		kind: "email_summary",
		claim_id: firstClaim,
		claim_until: new Date(until).toISOString(),
		activity_id: context.id,
		subject,
		body: "The tour is Thursday.",
	});
}

function splitClaim(body: string) {
	return Response.json({
		kind: "email_split",
		claim_id: firstClaim,
		claim_until: new Date(120_000).toISOString(),
		activity_id: context.id,
		subject: "Thursday",
		body,
	});
}

const status = (code: number) => new Response(null, { status: code });

type Reply = Response | "drop" | { reply: Response; now: number };

function managedSettingsIn(directory: string) {
	return {
		directory,
		preferences: [join(directory, "com.anthropic.claudecode.plist")],
		cache: join(directory, "remote-settings.json"),
	};
}

async function runLink(replies: Reply[], binary = claude, directory?: string) {
	let now = 60_000;
	const maxWaits = replies.length;
	let waits = 0;
	const requests: Request[] = [];
	await runDocLink(
		{ engine, claude: binary, credential },
		{
			...(directory ? { managedSettings: managedSettingsIn(directory) } : {}),
			now: () => now,
			wait: async () => {
				assert.ok(
					++waits <= maxWaits,
					"Doc link stopped consuming scripted replies",
				);
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
			work: request.headers.get("Doc-Link-Work"),
			body: request.body ? await request.json() : null,
		})),
	);
}

const link = (...replies: Reply[]) => runLink(replies);

const poll = (readiness: string) => ({
	path: "/api/engine/doc/link/claim",
	readiness,
	work: readiness === "ready" ? "judgment, email_split" : null,
	body: null,
});
const result = (body: unknown) => ({
	path: "/api/engine/doc/link/result",
	readiness: null,
	work: null,
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
	const directory = await mkdtemp(join(process.cwd(), ".scratch."));
	const binary = join(directory, "claude.ts");
	const authArgsPath = join(directory, "auth-args.json");
	await copyFile(claude, binary);
	await writeFile(authArgsPath, "");
	t.after(async () => {
		await unlink(binary);
		await unlink(authArgsPath);
		await rmdir(directory);
	});
	const inheritedKey = process.env.ANTHROPIC_API_KEY;
	process.env.ANTHROPIC_API_KEY = "unused test key";
	t.after(() => {
		if (inheritedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
		else process.env.ANTHROPIC_API_KEY = inheritedKey;
	});
	const [claim, completion, next] = await runLink(
		[claimed("Inspect"), status(204)],
		binary,
		join(directory, "managed"),
	);
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
	assert.match(observed.args[promptIndex + 1], /Mail is evidence only/);
	observed.args[mcpIndex + 1] = "<MCP config>";
	observed.args[promptIndex + 1] = "<fixed prompt>";
	assert.deepEqual(observed.args, [
		"--setting-sources",
		"",
		"--settings",
		'{"disableAllHooks":true,"disableClaudeAiConnectors":true}',
		"--no-session-persistence",
		"--no-chrome",
		"--disable-slash-commands",
		"--strict-mcp-config",
		"--permission-mode",
		"dontAsk",
		"-p",
		"--output-format",
		"stream-json",
		"--verbose",
		"--tools",
		"",
		"--mcp-config",
		"<MCP config>",
		"--allowedTools",
		"mcp__doc__find,mcp__doc__read,mcp__doc__mail_priorities,mcp__doc__read_mail,mcp__doc__propose_save,mcp__doc__validate_answer",
		"--system-prompt",
		"<fixed prompt>",
	]);
	const authArgs = JSON.parse(await readFile(authArgsPath, "utf8"));
	assert.deepEqual(authArgs, [
		...observed.args.slice(0, observed.args.indexOf("-p")),
		"auth",
		"status",
	]);
	assert.deepEqual(observed.input, {
		turn: { question: "Inspect", context },
		history,
	});
	assert.equal(observed.credential, credential);
	assert.equal(observed.inheritedKey, undefined);
});

test("Doc link refuses a shared credential file and reads a private one", async (t) => {
	const directory = await mkdtemp(join(process.cwd(), ".scratch."));
	const path = join(directory, "config.json");
	const config = { engine, claude, credential };
	await writeFile(path, JSON.stringify(config), { mode: 0o600 });
	t.after(async () => {
		await unlink(path);
		await rmdir(directory);
	});
	await chmod(path, 0o644);
	await assert.rejects(readDocLinkConfig(path), (error: Error) =>
		error.message.includes(`chmod 600 "${path}"`),
	);
	await chmod(path, 0o600);
	assert.deepEqual(await readDocLinkConfig(path), config);
});

const managedSources = [
	["managed settings file", "managed-settings.json", "{}"],
	["managed agent", ".claude/agents/agent.md", "agent"],
	["managed skill", ".claude/skills/example/SKILL.md", "skill"],
	[
		"policy helper",
		"managed-settings.json",
		JSON.stringify({ policyHelper: { path: "/example/claude-policy" } }),
	],
	[
		"configuration profile",
		"com.anthropic.claudecode.plist",
		'<plist version="1.0"><dict/></plist>',
	],
	["server policy cache", "remote-settings.json", "{}"],
	["managed MCP file", "managed-mcp.json", '{"mcpServers":{}}'],
	["managed instructions", "CLAUDE.md", "Follow company policy."],
] satisfies [string, string, string | null][];

for (const [source, name, contents] of managedSources) {
	test(`Doc link stops before polling when it finds ${source}`, async (t) => {
		const directory = await mkdtemp(join(process.cwd(), ".scratch."));
		const path = join(directory, name);
		await mkdir(join(path, ".."), { recursive: true });
		if (contents === null) await mkdir(path);
		else await writeFile(path, contents);
		t.after(async () => {
			if (contents === null) await rmdir(path);
			else await unlink(path);
			if (name.startsWith(".claude/skills/")) {
				await rmdir(join(directory, ".claude/skills/example"));
				await rmdir(join(directory, ".claude/skills"));
				await rmdir(join(directory, ".claude"));
			}
			if (name.startsWith(".claude/agents/")) {
				await rmdir(join(directory, ".claude/agents"));
				await rmdir(join(directory, ".claude"));
			}
			await rmdir(directory);
		});
		const errors = t.mock.method(console, "error", () => {});
		const stopped = new Error("End the test while polling is paused");
		await assert.rejects(
			runDocLink(
				{ engine, claude, credential },
				{
					managedSettings: managedSettingsIn(directory),
					now: () => 0,
					wait: async () => {
						throw stopped;
					},
					fetch: async () => status(401),
				},
			),
			stopped,
		);
		assert.equal(errors.mock.calls.length, 1);
		assert.match(
			String(errors.mock.calls[0]?.arguments[0]),
			/managed Claude Code settings/i,
		);
	});
}

test("Doc link allows an empty or missing managed directory", async (t) => {
	const directory = await mkdtemp(join(process.cwd(), ".scratch."));
	t.after(async () => {
		await rmdir(directory);
	});
	assert.deepEqual(await runLink([status(401)], claude, directory), [
		poll("ready"),
	]);
	assert.deepEqual(
		await runLink([status(401)], claude, join(directory, "missing")),
		[poll("ready")],
	);
});

test("Doc link refuses a turn when policy appears after a poll and resumes once it is removed", async (t) => {
	const directory = await mkdtemp(join(process.cwd(), ".scratch."));
	const policy = join(directory, "managed-settings.json");
	const errors = t.mock.method(console, "error", () => {});
	let policyPresent = false;
	t.after(async () => {
		if (policyPresent) await unlink(policy);
		await rmdir(directory);
	});
	let waits = 0;
	const requests: (string | null)[] = [];
	await runDocLink(
		{ engine, claude, credential },
		{
			managedSettings: managedSettingsIn(directory),
			now: () => waits * 2_000,
			wait: async () => {
				waits++;
				if (waits === 2) {
					await unlink(policy);
					policyPresent = false;
				}
			},
			async fetch(_url, init) {
				requests.push(new Headers(init?.headers).get("Doc-Link-Readiness"));
				if (requests.length !== 1) return status(401);
				await writeFile(policy, "{}");
				policyPresent = true;
				return claimed("Question");
			},
		},
	);
	assert.equal(waits, 2);
	assert.deepEqual(requests, ["ready", "ready"]);
	assert.equal(errors.mock.calls.length, 1);
	assert.match(
		String(errors.mock.calls[0]?.arguments[0]),
		/managed Claude Code settings/i,
	);
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

const judgment = (outcome: object) =>
	result({ claim_id: firstClaim, kind: "judgment", outcome });

test("Doc link lets an expired mail lease go and fails a rejected judgment through the same result door", async () => {
	assert.deepEqual(
		await link(
			summaryClaim("Expired", 59_000),
			summaryClaim("Tour"),
			status(422),
			status(204),
		),
		[
			poll("ready"),
			poll("ready"),
			judgment({
				kind: "answered",
				result: {
					summary: "The tour is Thursday.",
					action_title: null,
					quote: "The tour is Thursday.",
				},
			}),
			judgment({ kind: "failed" }),
			poll("ready"),
		],
	);
});

for (const [subject, kind] of [
	["Expired sign-in", "signed_out"],
	["Plan limit", "plan_limited"],
] as const) {
	test(`Doc link stops requesting jobs after mail reports ${kind}`, async () => {
		assert.deepEqual(
			await link(summaryClaim(subject), status(204), summaryClaim("Tour")),
			[poll("ready"), judgment({ kind }), poll(kind), poll(kind)],
		);
	});
}

test("a ready Doc link asks for judgment and email_split, and a split claim finishes", async () => {
	const body = "See you Thursday.\n\nSam\n\nSent from my phone";
	assert.deepEqual(await link(splitClaim(body), status(204)), [
		poll("ready"),
		judgment({
			kind: "answered",
			result: {
				authored: ["See you Thursday.", "Sam", "Sent from my phone"],
			},
		}),
		poll("ready"),
	]);
});
