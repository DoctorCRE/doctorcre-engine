import assert from "node:assert/strict";
import {
	chmod,
	copyFile,
	mkdir,
	mkdtemp,
	mkdtempDisposable,
	readFile,
	rename,
	rmdir,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
	hasManagedPolicy,
	readDocLinkConfig,
	runDocLink,
} from "../scripts/doc-link.ts";

beforeEach(() => mock.timers.enable({ apis: ["setInterval"] }));
afterEach(() => mock.timers.reset());

const credential = "x".repeat(43);
const engine = "https://engine.example.test";
const claude = fileURLToPath(
	new URL("./fixtures/fake-doc-claude.ts", import.meta.url).href,
);
const codex = fileURLToPath(
	new URL("./fixtures/fake-doc-codex.ts", import.meta.url).href,
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

async function runLink(
	replies: Reply[],
	binary = claude,
	directory?: string,
	backend: "claude" | "codex" = "claude",
) {
	let now = 60_000;
	const maxWaits = replies.length;
	let waits = 0;
	const requests: Request[] = [];
	await runDocLink(
		backend === "claude"
			? { engine, claude: binary, credential }
			: { engine, backend, binary, credential },
		{
			...(directory
				? {
						managedSettings: managedSettingsIn(directory),
						managedCodexPolicy: [join(directory, "requirements.toml")],
					}
				: {}),
			codexAccountAllowed: async () => true,
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
		if (new URL(request.url).pathname.endsWith("/claim"))
			assert.equal(request.headers.get("Doc-Link-Backend"), backend);
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
	work: readiness === "ready" ? "judgment, email_split, introduction" : null,
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
	const inherited = ["ANTHROPIC_API_KEY", "USER", "LOGNAME"].map(
		(name) => [name, process.env[name]] as const,
	);
	process.env.ANTHROPIC_API_KEY = "unused test key";
	process.env.USER = "partner";
	process.env.LOGNAME = "partner";
	t.after(() => {
		for (const [name, value] of inherited) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
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
	assert.equal(observed.user, "partner");
	assert.equal(observed.logname, "partner");
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

const denyOnly = JSON.stringify({
	permissions: { deny: ["Bash(curl:*)", "WebFetch"] },
});

test("Doc link polls with the deny-only managed settings file", async () => {
	await using scratch = await mkdtempDisposable(
		join(process.cwd(), ".scratch."),
	);
	await writeFile(join(scratch.path, "managed-settings.json"), denyOnly);
	assert.deepEqual(await runLink([status(401)], claude, scratch.path), [
		poll("ready"),
	]);
});

const denyOnlyCases: [string, boolean, (directory: string) => Promise<void>][] =
	[
		["deny-only settings", false, async () => {}],
		[
			"an empty deny list",
			false,
			(directory) =>
				writeFile(
					join(directory, "managed-settings.json"),
					'{"permissions":{"deny":[]}}',
				),
		],
		[
			"another top-level key",
			true,
			(directory) =>
				writeFile(
					join(directory, "managed-settings.json"),
					'{"permissions":{"deny":[]},"env":{}}',
				),
		],
		[
			"another permissions key",
			true,
			(directory) =>
				writeFile(
					join(directory, "managed-settings.json"),
					'{"permissions":{"deny":[],"allow":["Bash"]}}',
				),
		],
		[
			"a rule that is not a string",
			true,
			(directory) =>
				writeFile(
					join(directory, "managed-settings.json"),
					'{"permissions":{"deny":[{"tool":"Bash"}]}}',
				),
		],
		[
			"unparsable JSON",
			true,
			(directory) =>
				writeFile(
					join(directory, "managed-settings.json"),
					'{"permissions":{"deny":[]}',
				),
		],
		[
			"a second file",
			true,
			(directory) =>
				writeFile(join(directory, "managed-mcp.json"), '{"mcpServers":{}}'),
		],
		[
			"a subdirectory with a file",
			true,
			async (directory) => {
				await mkdir(join(directory, ".claude/agents"), { recursive: true });
				await writeFile(join(directory, ".claude/agents/agent.md"), "agent");
			},
		],
		[
			"an empty subdirectory",
			true,
			(directory) => mkdir(join(directory, "empty")),
		],
		[
			"a directory named like the settings file",
			true,
			async (directory) => {
				await unlink(join(directory, "managed-settings.json"));
				await mkdir(join(directory, "managed-settings.json"));
			},
		],
		[
			"a linked settings file",
			true,
			async (directory) => {
				await rename(
					join(directory, "managed-settings.json"),
					join(directory, "..", "linked.json"),
				);
				await symlink(
					join(directory, "..", "linked.json"),
					join(directory, "managed-settings.json"),
				);
			},
		],
		[
			"a configuration profile",
			true,
			(directory) =>
				writeFile(
					join(directory, "..", "com.anthropic.claudecode.plist"),
					'<plist version="1.0"><dict/></plist>',
				),
		],
		[
			"a server policy cache",
			true,
			(directory) =>
				writeFile(join(directory, "..", "remote-settings.json"), "{}"),
		],
	];

for (const [source, policy, arrange] of denyOnlyCases) {
	test(`managed settings beside the deny-only file: ${source} ${policy ? "pauses" : "passes"}`, async () => {
		await using scratch = await mkdtempDisposable(
			join(process.cwd(), ".scratch."),
		);
		const directory = join(scratch.path, "ClaudeCode");
		await mkdir(directory);
		await writeFile(join(directory, "managed-settings.json"), denyOnly);
		await arrange(directory);
		assert.equal(
			await hasManagedPolicy({
				directory,
				preferences: [join(scratch.path, "com.anthropic.claudecode.plist")],
				cache: join(scratch.path, "remote-settings.json"),
			}),
			policy,
		);
	});
}

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

test("a ready Doc link advertises all its mail jobs and finishes a split claim", async () => {
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

for (const backend of ["claude", "codex"] as const) {
	const binary = backend === "claude" ? claude : codex;
	test(`${backend} completes every job kind and keeps engine result validation`, async () => {
		const destination = { kind: "deal", id: context.id };
		const mail = {
			claim_id: firstClaim,
			claim_until: new Date(120_000).toISOString(),
			activity_id: context.id,
			subject: "Tour",
			body: "The tour is Thursday.",
		};
		const requests = await runLink(
			[
				claimed("Find tour"),
				status(204),
				summaryClaim("Tour"),
				status(204),
				Response.json({
					...mail,
					kind: "email_filing",
					destinations: [destination],
				}),
				status(204),
				splitClaim("See you Thursday.\n\nSam"),
				status(204),
				Response.json({
					...mail,
					kind: "introduction",
					context: { sent_on: "2026-10-01", sender_ids: [], candidates: [] },
				}),
				status(204),
				claimed("Invalid format"),
				status(204),
				summaryClaim("Tour"),
				status(422),
				status(204),
			],
			binary,
			undefined,
			backend,
		);
		const summary = judgment({
			kind: "answered",
			result: { summary: mail.body, action_title: null, quote: mail.body },
		});
		assert.deepEqual(requests, [
			poll("ready"),
			answered(firstClaim),
			poll("ready"),
			summary,
			poll("ready"),
			judgment({
				kind: "answered",
				result: { facts: [{ destination, text: mail.body, quote: mail.body }] },
			}),
			poll("ready"),
			judgment({
				kind: "answered",
				result: { authored: ["See you Thursday.", "Sam"] },
			}),
			poll("ready"),
			judgment({ kind: "answered", result: { introductions: [] } }),
			poll("ready"),
			result({ claim_id: firstClaim, kind: "failed" }),
			poll("ready"),
			summary,
			judgment({ kind: "failed" }),
			poll("ready"),
		]);
	});
}

test("Codex never submits a partial turn as an answer", async () => {
	assert.deepEqual(
		await runLink(
			[claimed("Interrupted"), status(204)],
			codex,
			undefined,
			"codex",
		),
		[
			poll("ready"),
			result({ claim_id: firstClaim, kind: "failed" }),
			poll("ready"),
		],
	);
});

for (const [question, kind] of [
	["Expired sign-in", "signed_out"],
	["Plan limit", "plan_limited"],
] as const) {
	test(`Codex releases work after ${kind}`, async () => {
		assert.deepEqual(
			await runLink(
				[claimed(question), status(204)],
				codex,
				undefined,
				"codex",
			),
			[poll("ready"), result({ claim_id: firstClaim, kind }), poll(kind)],
		);
	});
}

for (const variant of ["signed-out", "api-key", "business", "unsupported"]) {
	test(`Codex cannot claim work with ${variant}`, async () => {
		await using directory = await mkdtempDisposable(
			join(process.cwd(), ".scratch."),
		);
		const binary = join(directory.path, variant);
		await symlink(codex, binary);
		const requests: Request[] = [];
		const paused = Symbol("polling paused");
		const expectedReadiness = variant === "signed-out" ? "signed_out" : null;
		await assert.rejects(
			runDocLink(
				{ backend: "codex", binary, engine, credential },
				{
					codexAccountAllowed: async () => true,
					now: () => 60_000,
					wait: async () => {
						throw paused;
					},
					fetch: async (url, init) => {
						requests.push(new Request(url, init));
						return status(204);
					},
				},
			),
			(error) => error === paused,
		);
		assert.equal(
			requests.some((request) => request.headers.has("Doc-Link-Work")),
			false,
		);
		assert.deepEqual(
			requests.map((request) => request.headers.get("Doc-Link-Readiness")),
			variant === "signed-out" || variant === "unsupported"
				? [expectedReadiness]
				: [],
		);
	});
}

test("Codex config needs an absolute binary path", async () => {
	await using directory = await mkdtempDisposable(
		join(process.cwd(), ".scratch."),
	);
	const path = join(directory.path, "config.json");
	const config = { engine, credential, backend: "codex", binary: codex };
	await writeFile(path, JSON.stringify(config), { mode: 0o600 });
	assert.deepEqual(await readDocLinkConfig(path), config);
	await writeFile(path, JSON.stringify({ ...config, binary: "codex" }));
	await assert.rejects(
		readDocLinkConfig(path),
		/could not read its configuration/,
	);
});

test("The Codex runner pauses before polling if managed settings are present", async () => {
	await using directory = await mkdtempDisposable(
		join(process.cwd(), ".scratch."),
	);
	const policy = join(directory.path, "requirements.toml");
	await writeFile(policy, "");
	const paused = Symbol("polling paused");
	await assert.rejects(
		runDocLink(
			{ backend: "codex", binary: codex, engine, credential },
			{
				managedCodexPolicy: [policy],
				codexAccountAllowed: async () => true,
				fetch: async () => assert.fail("polled despite managed settings"),
				now: () => 60_000,
				wait: async () => {
					throw paused;
				},
			},
		),
		(error) => error === paused,
	);
});

test("Codex refuses to start outside its dedicated standard account", async () => {
	await assert.rejects(
		runDocLink(
			{ backend: "codex", binary: codex, engine, credential },
			{
				codexAccountAllowed: async () => false,
				fetch: async () => assert.fail("polled from another account"),
				now: () => 60_000,
				wait: async () => assert.fail("runner did not stop"),
			},
		),
		/dedicated standard macOS account/,
	);
});

test("Codex advertises no work with a missing or altered isolation catalog", async () => {
	await using directory = await mkdtempDisposable(
		join(process.cwd(), ".scratch."),
	);
	const catalog = join(directory.path, "catalog.json");
	for (const invalid of [undefined, "{", '{"models":[]}']) {
		if (invalid !== undefined) await writeFile(catalog, invalid);
		const paused = Symbol("polling paused");
		const work: (string | null)[] = [];
		await assert.rejects(
			runDocLink(
				{ backend: "codex", binary: codex, engine, credential },
				{
					codexAccountAllowed: async () => true,
					codexCatalog: catalog,
					fetch: async (_url, init) => {
						work.push(new Headers(init?.headers).get("Doc-Link-Work"));
						return status(204);
					},
					now: () => 60_000,
					wait: async () => {
						throw paused;
					},
				},
			),
			(error) => error === paused,
		);
		assert.deepEqual(work, []);
	}
});

for (const [question, reset] of [
	["Plan limit with reset", Date.UTC(1970, 0, 2, 16, 40)],
	["Plan limit", 360_000],
] as const) {
	test(`Codex waits to reclaim work after ${question}`, async () => {
		assert.deepEqual(
			await runLink(
				[
					claimed(question),
					status(204),
					{ reply: status(204), now: reset - 60_000 },
					{ reply: status(204), now: reset },
					status(204),
				],
				codex,
				undefined,
				"codex",
			),
			[
				poll("ready"),
				result({ claim_id: firstClaim, kind: "plan_limited" }),
				poll("plan_limited"),
				poll("plan_limited"),
				poll("ready"),
				poll("ready"),
			],
		);
	});
}
