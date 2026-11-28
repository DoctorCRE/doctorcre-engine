import { execFile } from "node:child_process";
import { hash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, URL } from "node:url";
import { z } from "zod";

export type LinkOutcome =
	| { kind: "answered"; answer: Record<string, unknown> }
	| { kind: "failed" | "signed_out" }
	| { kind: "startup_failed"; reason?: string }
	| { kind: "plan_limited"; resetsAt: number | undefined };

type SignInStatus =
	| "ready"
	| "signed_out"
	| "personal_plan_required"
	| undefined;

export type ModelTask = {
	input: string;
	prompt: string;
	allowTools: boolean;
	chat?: { url: string; claimId: string; credential: string };
};

type Backend = {
	signIn: (binary: string, allowTools: boolean) => Promise<SignInStatus>;
	run: (
		binary: string,
		timeout: number,
		task: ModelTask,
	) => Promise<LinkOutcome>;
	personalPlanMessage: string;
	settingsMessage: string;
	policyMessage: string;
};

const docTools = [
	"find",
	"read",
	"mail_priorities",
	"read_mail",
	"propose_save",
	"validate_answer",
];

export function readJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

const fields = z.record(z.string(), z.unknown());
type CliResult = { ok: boolean; stdout: string; stderr: string };

function childEnvironment() {
	const env = { ...process.env };
	const allowed = new Set(["HOME", "LOGNAME", "PATH", "TMPDIR", "USER"]);
	for (const name of Object.keys(env)) if (!allowed.has(name)) delete env[name];
	return env;
}

function runCli(
	binary: string,
	args: string[],
	timeout: number,
	{
		input,
		env,
		cwd,
	}: { input?: string | undefined; env: NodeJS.ProcessEnv; cwd?: string },
) {
	return new Promise<CliResult>((resolve) => {
		const child = execFile(
			binary,
			args,
			{ cwd, env, timeout, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024 },
			(error, stdout, stderr) => resolve({ ok: !error, stdout, stderr }),
		);
		child.stdin?.on("error", () => {}).end(input);
	});
}

export const ownClaudePlanMessage = "Doc needs your own Claude plan.";

const sessionSettings = JSON.stringify({
	disableAllHooks: true,
	disableClaudeAiConnectors: true,
});
const authStatus = z.object({
	loggedIn: z.boolean(),
	authMethod: z.string(),
	subscriptionType: z.unknown().optional(),
});
const personalPlan = z.enum(["pro", "max", "ultra"]);
const rateLimit = z.object({
	status: z.literal("rejected"),
	resetsAt: z.number().optional(),
});

function runClaude(
	binary: string,
	timeout: number,
	allowTools: boolean,
	task?: ModelTask,
) {
	const args = ["--no-session-persistence"];
	if (!allowTools)
		args.push(
			"--setting-sources",
			"",
			"--settings",
			sessionSettings,
			"--no-chrome",
			"--disable-slash-commands",
			"--strict-mcp-config",
			"--permission-mode",
			"dontAsk",
		);
	if (task) {
		args.push(
			"-p",
			"--output-format",
			"stream-json",
			"--verbose",
			...(allowTools ? [] : ["--tools", ""]),
			"--mcp-config",
			JSON.stringify({
				mcpServers: task.chat
					? {
							doc: {
								type: "http",
								url: task.chat.url,
								headers: {
									Authorization: `Bearer \${DOC_LINK_CREDENTIAL}`,
									"Doc-Claim-Id": task.chat.claimId,
								},
							},
						}
					: {},
			}),
			...(task.chat
				? [
						"--allowedTools",
						docTools.map((name) => `mcp__doc__${name}`).join(","),
					]
				: []),
			"--system-prompt",
			task.prompt,
		);
	} else {
		args.push("auth", "status");
	}
	return runCli(binary, args, timeout, {
		...(allowTools ? { cwd: homedir() } : {}),
		input: task?.input,
		env: {
			...childEnvironment(),
			...(allowTools ? {} : { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" }),
			...(task?.chat ? { DOC_LINK_CREDENTIAL: task.chat.credential } : {}),
		},
	});
}

export async function signInStatus(
	claude: string,
	allowTools = true,
): Promise<SignInStatus> {
	const { ok, stdout } = await runClaude(claude, 5_000, allowTools);
	const auth = authStatus.safeParse(readJson(stdout));
	if (!auth.success) return undefined;
	if (!auth.data.loggedIn || auth.data.authMethod !== "claude.ai")
		return "signed_out";
	if (!ok) return undefined;
	return personalPlan.safeParse(auth.data.subscriptionType).success
		? "ready"
		: "personal_plan_required";
}

const docMcpIssue =
	"Doc could not connect to its tools. Check the engine connection, then rerun setup.";
const mcpConnection = z.object({ name: z.string(), status: z.string() });

function claudeOutcome(
	{ ok, stdout }: CliResult,
	needsDoc: boolean,
): LinkOutcome {
	let blocker: LinkOutcome | undefined;
	let completed: Record<string, unknown> | undefined;
	let initialized = false;
	let docConnected = false;
	for (const line of stdout.split("\n")) {
		const event = fields.safeParse(readJson(line)).data;
		if (!event) continue;
		if (event.type === "system" && event.subtype === "init") {
			initialized = true;
			docConnected =
				z
					.array(mcpConnection)
					.safeParse(event.mcp_servers)
					.data?.some(
						({ name, status }) => name === "doc" && status === "connected",
					) ?? false;
		}
		if (event.type === "rate_limit_event") {
			const limit = rateLimit.safeParse(event.rate_limit_info).data;
			if (limit) blocker = { kind: "plan_limited", resetsAt: limit.resetsAt };
		}
		if (event.type === "assistant" && event.error === "authentication_failed")
			blocker = { kind: "signed_out" };
		if (event.type === "result") completed = event;
	}
	if (
		ok &&
		(!needsDoc || docConnected) &&
		completed?.subtype === "success" &&
		completed.is_error === false &&
		typeof completed.result === "string"
	) {
		const answer = fields.safeParse(readJson(completed.result)).data;
		if (answer) return { kind: "answered", answer };
	}
	if (blocker) return blocker;
	if (completed?.api_error_status === 401) return { kind: "signed_out" };
	if (
		completed?.is_error === true &&
		typeof completed.result === "string" &&
		/^(?:Not logged in\b|Invalid API key\b).*\/login/i.test(completed.result)
	)
		return { kind: "signed_out" };
	if (needsDoc && initialized && !docConnected)
		return { kind: "startup_failed", reason: docMcpIssue };
	if (!initialized && !ok) return { kind: "startup_failed" };
	if (needsDoc && !docConnected) return { kind: "startup_failed" };
	return { kind: "failed" };
}

export function codexHome() {
	return process.env.CODEX_HOME
		? resolve(process.env.CODEX_HOME)
		: join(homedir(), ".codex");
}

// Review the tool surface against the new release before adding a version.
export const codexVersion = "0.172.0";
const codexAuthConfig = [
	"-c",
	'model_provider="openai"',
	"-c",
	'cli_auth_credentials_store="auto"',
];
const codexIsolationConfig = [
	"-c",
	"project_doc_max_bytes=0",
	"-c",
	"skills.include_instructions=false",
	"-c",
	"skills.bundled.enabled=false",
	"-c",
	"analytics.enabled=false",
	"-c",
	'web_search="disabled"',
	"-c",
	"tools.experimental_request_user_input.enabled=false",
	"--disable",
	"goals",
	"--disable",
	"image_generation",
	"--disable",
	"shell_tool",
	"--disable",
	"apps",
	"--disable",
	"plugins",
	"--disable",
	"hooks",
	"--disable",
	"plugin_hooks",
	"--disable",
	"multi_agent",
	"--disable",
	"multi_agent_v2",
	"--disable",
	"code_mode",
	"--disable",
	"code_mode_only",
	"--disable",
	"view_image",
	"--disable",
	"tool_suggest",
	"--disable",
	"tool_search",
	"--disable",
	"sqlite",
];
const codexCatalog = fileURLToPath(
	new URL("./doc-link-codex-model.json", import.meta.url),
);

export async function isCodexCatalogValid(path = codexCatalog) {
	try {
		// Only the catalog used in the tool refusal replay may enable the runner.
		return (
			(await lstat(path)).isFile() &&
			hash("sha256", await readFile(path)) ===
				"67d5927361faca4dc6600d690f4669d8f442188967f52d3d4a6d8781c0c28bc9"
		);
	} catch {
		return false;
	}
}

function codexEnvironment(home = codexHome()) {
	return { ...childEnvironment(), CODEX_HOME: home, TZ: "UTC" };
}

const codexAccount = z.object({
	id: z.literal(2),
	result: z.object({
		requiresOpenaiAuth: z.literal(true),
		account: z
			.object({
				type: z.literal("chatgpt"),
				planType: z.string(),
			})
			.nullable(),
	}),
});
const personalChatGptPlan = z.enum([
	"free",
	"go",
	"plus",
	"pro",
	"prolite",
	"promax",
]);

function codexPlan(
	binary: string,
	env: NodeJS.ProcessEnv,
): Promise<SignInStatus> {
	return new Promise((resolve) => {
		const child = execFile(
			binary,
			[
				"app-server",
				...codexAuthConfig,
				...codexIsolationConfig,
				"--listen",
				"stdio://",
			],
			{
				cwd: "/",
				env,
				timeout: 5_000,
				killSignal: "SIGKILL",
				maxBuffer: 2 * 1024 * 1024,
			},
			() => resolve(undefined),
		);
		if (!child.stdout) return;
		const lines = createInterface({ input: child.stdout });
		lines.on("line", (line) => {
			const response = codexAccount.safeParse(readJson(line)).data;
			if (!response) return;
			const { account } = response.result;
			resolve(
				!account
					? "signed_out"
					: personalChatGptPlan.safeParse(account.planType).success
						? "ready"
						: "personal_plan_required",
			);
			lines.close();
			child.kill("SIGKILL");
		});
		child.stdin
			?.on("error", () => {})
			.write(
				[
					JSON.stringify({
						id: 1,
						method: "initialize",
						params: {
							clientInfo: { name: "doctorcre_doc", version: "1" },
						},
					}),
					JSON.stringify({ method: "initialized" }),
					JSON.stringify({
						id: 2,
						method: "account/read",
						params: { refreshToken: false },
					}),
					"",
				].join("\n"),
			);
	});
}

export async function checkCodexSignIn(
	binary: string,
	home?: string,
): Promise<SignInStatus | "wrong_version"> {
	const env = codexEnvironment(home);
	const version = await runCli(binary, ["--version"], 5_000, { env, cwd: "/" });
	if (!version.ok || version.stdout.trim() !== `codex-cli ${codexVersion}`)
		return "wrong_version";
	const status = await runCli(
		binary,
		["login", "status", ...codexAuthConfig, ...codexIsolationConfig],
		5_000,
		{ env, cwd: "/" },
	);
	const lines = status.stderr.split("\n").map((line) => line.trim());
	if (lines.includes("Not logged in")) return "signed_out";
	if (!status.ok) return undefined;
	if (!lines.includes("Logged in using ChatGPT"))
		return "personal_plan_required";
	return codexPlan(binary, env);
}

const codexMessage = z.object({
	type: z.literal("agent_message"),
	text: z.string(),
});
function codexReset(message: string) {
	const time =
		/try again at (?:(\w{3} \d{1,2})(?:st|nd|rd|th), (\d{4}) )?(\d{1,2}:\d{2} [AP]M)\.$/i.exec(
			message,
		);
	if (!time) return undefined;
	const day = time[1]
		? `${time[1]}, ${time[2]}`
		: new Date().toISOString().slice(0, 10);
	const milliseconds = Date.parse(`${day} ${time[3]} UTC`);
	return Number.isFinite(milliseconds) ? milliseconds / 1_000 : undefined;
}

function codexOutcome({ ok, stdout, stderr }: CliResult): LinkOutcome {
	let started = false;
	let completed = false;
	let finalMessage: string | undefined;
	for (const line of stdout.split("\n")) {
		const event = fields.safeParse(readJson(line)).data;
		if (!event) continue;
		if (event.type === "thread.started") started = true;
		if (event.type === "item.completed") {
			const message = codexMessage.safeParse(event.item).data;
			if (message) finalMessage = message.text;
		}
		if (event.type === "turn.completed") completed = true;
		if (event.type === "turn.failed") {
			const message = fields.safeParse(event.error).data?.message;
			if (typeof message === "string") {
				if (/^You[’']ve hit your usage limit\b/.test(message))
					return { kind: "plan_limited", resetsAt: codexReset(message) };
				if (
					/^Your access token could not be refreshed\b|^unexpected status 401\b/i.test(
						message,
					)
				)
					return { kind: "signed_out" };
			}
			break;
		}
	}
	const answer =
		completed && ok && finalMessage !== undefined
			? fields.safeParse(readJson(finalMessage)).data
			: undefined;
	if (answer) return { kind: "answered", answer };
	if (/required MCP servers failed to initialize/i.test(stderr))
		return { kind: "startup_failed", reason: docMcpIssue };
	return { kind: !ok && !started ? "startup_failed" : "failed" };
}

async function runCodex(binary: string, timeout: number, task: ModelTask) {
	const env = codexEnvironment();
	const args = [
		"exec",
		"--json",
		"--ephemeral",
		"--skip-git-repo-check",
		...codexAuthConfig,
		"-c",
		'forced_login_method="chatgpt"',
		"-c",
		`developer_instructions=${JSON.stringify(task.prompt)}`,
	];
	if (!task.allowTools)
		args.push(
			"--ignore-user-config",
			"--ignore-rules",
			"--strict-config",
			"--sandbox",
			"read-only",
			...codexIsolationConfig,
			"-c",
			`model_catalog_json=${JSON.stringify(codexCatalog)}`,
		);
	if (task.chat) {
		const { url, claimId, credential } = task.chat;
		args.push(
			"-c",
			`mcp_servers.doc={url=${JSON.stringify(url)}, required=true, bearer_token_env_var="DOC_LINK_CREDENTIAL", http_headers={"Doc-Claim-Id"=${JSON.stringify(claimId)}}, enabled_tools=${JSON.stringify(docTools)}}`,
		);
		Object.assign(env, { DOC_LINK_CREDENTIAL: credential });
	} else if (!task.allowTools) {
		args.push("-c", "mcp_servers={}");
	}
	return codexOutcome(
		await runCli(binary, [...args, "-"], timeout, {
			cwd: task.allowTools ? homedir() : "/",
			env,
			input: task.input,
		}),
	);
}

export const backends = {
	claude: {
		signIn: signInStatus,
		run: async (binary, timeout, task) =>
			claudeOutcome(
				await runClaude(binary, timeout, task.allowTools, task),
				Boolean(task.chat),
			),
		personalPlanMessage: ownClaudePlanMessage,
		settingsMessage: "Check your Claude Code settings, then rerun setup.",
		policyMessage: "Doc link needs a Mac without managed Claude Code settings.",
	},
	codex: {
		signIn: async (binary) => {
			const status = await checkCodexSignIn(binary);
			return status === "wrong_version" ? undefined : status;
		},
		run: runCodex,
		personalPlanMessage: "Doc needs your own ChatGPT plan.",
		settingsMessage:
			"Codex could not check your settings. Fix or reset them, then rerun setup.",
		policyMessage:
			"Mail judgment needs a Mac without managed Codex settings or Codex home instructions.",
	},
} satisfies Record<string, Backend>;
