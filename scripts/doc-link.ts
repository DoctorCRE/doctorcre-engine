import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
	judgmentClaimSchema,
	judgmentTask,
} from "../src/doc-judgment-prompt.ts";
import type {
	DocLinkReadiness,
	DocWorkKind,
	DocWorkReadiness,
} from "../src/doc-link.ts";
import { macDocPrompt } from "../src/doc-prompt.ts";
import {
	backends,
	codexHome,
	isCodexCatalogValid,
	type LinkOutcome,
	type ModelTask,
	readJson,
} from "./doc-link-backends.ts";

export const docLinkEngineSchema = z.url().refine((value) => {
	const url = new URL(value);
	return (
		url.protocol === "https:" &&
		(value === url.origin || value === `${url.origin}/`)
	);
});
const configFields = {
	engine: docLinkEngineSchema,
	credential: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
};
const absoluteBinary = z.string().refine(isAbsolute);
const backendName = z.custom<keyof typeof backends>(
	(value) => typeof value === "string" && Object.hasOwn(backends, value),
);
const backendRegistration = z.strictObject({
	backend: backendName,
	binary: absoluteBinary,
});
const registeredConfig = z
	.strictObject({
		...configFields,
		default_backend: backendName,
		backends: z.array(backendRegistration),
		codex_home: absoluteBinary.optional(),
	})
	.refine(
		({ default_backend, backends }) =>
			backends.some(({ backend }) => backend === default_backend) &&
			new Set(backends.map(({ backend }) => backend)).size === backends.length,
	);
export const docLinkConfigSchema = z.union([
	z.strictObject({ ...configFields, claude: absoluteBinary }),
	z.strictObject({ ...configFields, ...backendRegistration.shape }),
	registeredConfig,
]);
type Config = z.infer<typeof docLinkConfigSchema>;
export type RegisteredBackend = z.infer<typeof backendRegistration>;

export function configuredBackends(config: Config): RegisteredBackend[] {
	if ("backends" in config) return config.backends;
	return "claude" in config
		? [{ backend: "claude", binary: config.claude }]
		: [{ backend: config.backend, binary: config.binary }];
}

const claimSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("turn"),
		claim_id: z.uuid(),
		claim_until: z.iso.datetime({ offset: true }),
		turn: z.object({ question: z.string(), context: z.json().nullable() }),
		history: z
			.array(z.object({ question: z.string(), answer: z.json() }))
			.max(12),
	}),
	judgmentClaimSchema,
]);

type ReadinessCheck = {
	status: DocLinkReadiness | null;
	reason?: string;
	checkAt: number;
};
const retryReadinessAfter = 30_000;
const checkReadyEvery = 300_000;
const pollEvery = 2_000;
const allowMailTools = false;
const probePrompt =
	'This is a Doc readiness check. Return exactly {"ready":true} as JSON. Do not use any tools.';

function chatTask(
	config: Config,
	claimId: string,
	input: string,
	prompt = macDocPrompt,
): ModelTask {
	return {
		input,
		prompt,
		allowTools: true,
		chat: {
			url: new URL("/api/engine/doc/mcp", config.engine).href,
			claimId,
			credential: config.credential,
		},
	};
}
// https://code.claude.com/docs/en/managed-settings#where-each-mechanism-stores-the-policy
// https://code.claude.com/docs/en/server-managed-settings
function macManagedSettingsPaths() {
	const preferences = "/Library/Managed Preferences";
	const domain = "com.anthropic.claudecode.plist";
	return {
		directory: "/Library/Application Support/ClaudeCode",
		preferences: [
			join(preferences, userInfo().username, domain),
			join(preferences, domain),
		],
		cache: join(homedir(), ".claude", "remote-settings.json"),
	};
}

function isMissingFile(error: unknown) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// Decision 217: deny rules only take tools away, so this one file is allowed.
const denyOnlySettings = "managed-settings.json";
const denyOnlySettingsSchema = z.strictObject({
	permissions: z.strictObject({ deny: z.array(z.string()) }),
});

async function isDenyOnlySettings(path: string) {
	await using file = await open(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	if (!(await file.stat()).isFile()) return false;
	return denyOnlySettingsSchema.safeParse(readJson(await file.readFile("utf8")))
		.success;
}

export async function hasManagedPolicy(
	{
		directory,
		preferences = [],
		cache,
	}: {
		directory: string;
		preferences?: string[];
		cache?: string;
	} = macManagedSettingsPaths(),
) {
	try {
		const names = await readdir(directory);
		if (names.some((name) => name !== denyOnlySettings)) return true;
		if (
			names.length > 0 &&
			!(await isDenyOnlySettings(join(directory, denyOnlySettings)))
		)
			return true;
	} catch (error) {
		if (!isMissingFile(error)) return true;
	}
	return hasPolicyFiles([...preferences, ...(cache ? [cache] : [])]);
}

async function hasPolicyFiles(paths: string[]) {
	for (const path of paths) {
		try {
			await lstat(path);
			return true;
		} catch (error) {
			if (!isMissingFile(error)) return true;
		}
	}
	return false;
}

function macCodexPolicyPaths() {
	const preferences = "/Library/Managed Preferences";
	const domain = "com.openai.codex.plist";
	return [
		"/etc/codex/config.toml",
		"/etc/codex/managed_config.toml",
		"/etc/codex/requirements.toml",
		join(preferences, userInfo().username, domain),
		join(preferences, domain),
		...["AGENTS.md", "AGENTS.override.md"].map((file) =>
			join(codexHome(), file),
		),
	];
}

type LinkRuntime = {
	fetch: typeof globalThis.fetch;
	now: () => number;
	wait: () => Promise<void>;
	managedSettings?: Parameters<typeof hasManagedPolicy>[0];
	managedCodexPolicy?: string[];
	codexCatalog?: string;
};

export function postDocLink(
	config: Config,
	path: "claim" | "result",
	init: RequestInit = {},
	fetch = globalThis.fetch,
) {
	const headers = new Headers(init.headers);
	headers.set("Authorization", `Bearer ${config.credential}`);
	return fetch(new URL(`/api/engine/doc/link/${path}`, config.engine), {
		...init,
		method: "POST",
		headers,
		redirect: "error",
		signal: AbortSignal.timeout(10_000),
	}).catch(() => undefined);
}

async function connectsToDocMcp(
	{ url, claimId, credential }: NonNullable<ModelTask["chat"]>,
	fetch: typeof globalThis.fetch,
) {
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${credential}`,
				"Doc-Claim-Id": claimId,
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-11-25",
					capabilities: {},
					clientInfo: { name: "doctorcre-doc", version: "1.0.0" },
				},
			}),
			redirect: "error",
			signal: AbortSignal.timeout(5_000),
		});
		return (
			response.ok &&
			z
				.object({
					id: z.literal(1),
					result: z.object({
						serverInfo: z.object({ name: z.literal("doctorcre-doc") }),
					}),
				})
				.safeParse(await response.json()).success
		);
	} catch {
		return false;
	}
}

export async function runDocLink(
	config: Config,
	{
		fetch,
		now,
		wait,
		managedSettings,
		managedCodexPolicy,
		codexCatalog,
	}: LinkRuntime = {
		fetch: globalThis.fetch,
		now: Date.now,
		wait: () => delay(pollEvery),
		managedSettings: macManagedSettingsPaths(),
		managedCodexPolicy: macCodexPolicyPaths(),
	},
) {
	const registrations = configuredBackends(config);
	const selected =
		"default_backend" in config
			? registrations.find(({ backend }) => backend === config.default_backend)
			: registrations[0];
	if (!selected) throw new Error("Choose a registered Doc link backend.");
	const { backend: name, binary } = selected;
	const backend = backends[name];
	let policyError: string | undefined;
	async function mailAllowed() {
		if (allowMailTools) return true;
		let error: string | undefined;
		if (name === "codex") {
			if (await hasPolicyFiles(managedCodexPolicy ?? []))
				error = backend.policyMessage;
			else if (!(await isCodexCatalogValid(codexCatalog)))
				error =
					"Restore Doc link's verified Codex model catalog before using Codex.";
		} else if (managedSettings && (await hasManagedPolicy(managedSettings))) {
			error = backend.policyMessage;
		}
		if (error && error !== policyError)
			console.error(`Mail judgment is paused. ${error}`);
		policyError = error;
		return !error;
	}

	const kinds = ["chat", "mail"] as const;
	const checks: Record<DocWorkKind, ReadinessCheck> = {
		chat: { status: null, checkAt: 0 },
		mail: { status: null, checkAt: 0 },
	};
	const usesTools = (kind: DocWorkKind) => kind === "chat" || allowMailTools;
	function remember(kind: DocWorkKind, next: ReadinessCheck) {
		if (next.reason && next.reason !== checks[kind].reason)
			console.error(`Doc ${kind}: ${next.reason}`);
		checks[kind] = next;
	}
	async function verifyPlan(kind: DocWorkKind) {
		const status = await backend.signIn(binary, usesTools(kind));
		if (status === "ready") return true;
		remember(kind, {
			status: status ? "signed_out" : null,
			reason: status ? backend.personalPlanMessage : backend.settingsMessage,
			checkAt: now() + retryReadinessAfter,
		});
		return false;
	}
	function rememberBlocker(kind: DocWorkKind, outcome: LinkOutcome) {
		if (outcome.kind === "startup_failed" || outcome.readinessIssue)
			remember(kind, {
				status: null,
				reason:
					(outcome.kind === "startup_failed"
						? outcome.reason
						: outcome.readinessIssue) ?? backend.settingsMessage,
				checkAt: now() + retryReadinessAfter,
			});
		if (outcome.kind === "signed_out")
			remember(kind, {
				status: "signed_out",
				reason: backend.personalPlanMessage,
				checkAt: now() + retryReadinessAfter,
			});
		if (outcome.kind === "plan_limited")
			remember(kind, {
				status: "plan_limited",
				reason: "The plan is at its usage limit.",
				checkAt:
					outcome.resetsAt && outcome.resetsAt * 1_000 > now()
						? outcome.resetsAt * 1_000
						: now() + checkReadyEvery,
			});
	}
	async function probe(kind: DocWorkKind) {
		if (!(await verifyPlan(kind))) return;
		const input = '{"readiness":true}';
		const task =
			kind === "chat"
				? chatTask(config, "readiness", input, probePrompt)
				: {
						allowTools: allowMailTools,
						prompt: probePrompt,
						input,
					};
		const outcome = await backend.run(binary, 15_000, task);
		if (
			outcome.kind === "answered" &&
			outcome.answer.ready === true &&
			!outcome.readinessIssue
		)
			remember(kind, { status: "ready", checkAt: now() + checkReadyEvery });
		else
			rememberBlocker(
				kind,
				!outcome.readinessIssue &&
					(outcome.kind === "answered" || outcome.kind === "failed")
					? { kind: "startup_failed" }
					: outcome,
			);
	}
	for (; ; await wait()) {
		const mailPolicy = await mailAllowed();
		if (!mailPolicy) checks.mail = { status: null, checkAt: 0 };
		await Promise.all(
			kinds
				.filter(
					(kind) =>
						(kind === "chat" || mailPolicy) && now() >= checks[kind].checkAt,
				)
				.map(probe),
		);
		const readiness: DocWorkReadiness = {
			chat: checks.chat.status,
			mail: checks.mail.status,
		};
		const headers = new Headers({
			"Doc-Link-Backend": name,
			"Doc-Link-Work-Readiness": JSON.stringify(readiness),
		});
		if (readiness.chat) headers.set("Doc-Link-Readiness", readiness.chat);
		if (readiness.mail === "ready")
			headers.set("Doc-Link-Work", "judgment, email_split, introduction");
		const poll = await postDocLink(config, "claim", { headers }, fetch);
		if (poll?.status === 401) return;
		if (poll?.status !== 200) continue;

		const claim = claimSchema.safeParse(
			await poll.json().catch(() => undefined),
		).data;
		if (!claim) continue;
		const chat = claim.kind === "turn";
		const kind = chat ? "chat" : "mail";
		if (readiness[kind] !== "ready" || (!chat && !(await mailAllowed())))
			continue;
		if (!(await verifyPlan(kind)) || (!chat && !(await mailAllowed())))
			continue;
		const expires = Date.parse(claim.claim_until);
		const timeout = Math.min(45_000, expires - 15_000 - now());
		if (!(timeout > 0)) continue;

		const heartbeat = setInterval(async () => {
			if (chat || (await mailAllowed()))
				void postDocLink(config, "claim", {}, fetch);
		}, 10_000);
		const task: ModelTask = chat
			? chatTask(
					config,
					claim.claim_id,
					JSON.stringify({ turn: claim.turn, history: claim.history }),
				)
			: { ...judgmentTask(claim), allowTools: allowMailTools };
		if (task.chat)
			task.beforePrompt = async () => {
				if (
					name === "codex" &&
					task.chat &&
					!(await connectsToDocMcp(task.chat, fetch))
				)
					return false;
				const begun = await postDocLink(
					config,
					"result",
					{
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ claim_id: claim.claim_id, kind: "started" }),
					},
					fetch,
				);
				return begun?.status === 204;
			};
		let outcome = await backend
			.run(binary, timeout, task)
			.finally(() => clearInterval(heartbeat));
		rememberBlocker(kind, outcome);
		const { claim_id } = claim;
		while (now() < expires) {
			const { kind } = outcome;
			const completion =
				claim.kind !== "turn"
					? {
							claim_id,
							kind: "judgment",
							outcome:
								kind === "answered"
									? { kind, result: outcome.answer }
									: { kind },
						}
					: kind === "answered"
						? { claim_id, kind, answer: outcome.answer }
						: { claim_id, kind };
			const result = await postDocLink(
				config,
				"result",
				{
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(completion),
				},
				fetch,
			);
			if (result?.status === 401) return;
			if (result?.status === 422 && kind === "answered") {
				outcome = { kind: "failed" };
				continue;
			}
			if (result && result.status < 500) break;
			await wait();
		}
	}
}

export async function readDocLinkConfigFile(path: string) {
	await using file = await open(
		path,
		constants.O_RDONLY | constants.O_NONBLOCK,
	);
	const info = await file.stat();
	if (!info.isFile())
		throw new Error("Doc link needs a regular configuration file.");
	if (info.uid !== process.geteuid?.())
		throw new Error(`Create ${path} as the macOS user running Doc link.`);
	if ((info.mode & 0o077) !== 0) {
		throw new Error(
			`Doc link needs a private configuration file. Run chmod 600 "${path}".`,
		);
	}
	const contents = await file.readFile();
	const config = docLinkConfigSchema.safeParse(
		readJson(contents.toString("utf8")),
	);
	return { contents, mode: info.mode & 0o777, config: config.data };
}

export async function readDocLinkConfig(path: string) {
	const { config } = await readDocLinkConfigFile(path);
	if (!config)
		throw new Error("Doc link could not read its configuration file.");
	return config;
}

if (import.meta.main) {
	const path = process.argv[2];
	try {
		if (!path) throw new Error("Doc link needs a configuration file path.");
		await runDocLink(await readDocLinkConfig(path));
	} catch (error) {
		console.error(error instanceof Error ? error.message : "Doc link failed.");
		process.exitCode = 1;
	}
}
