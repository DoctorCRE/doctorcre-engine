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
export const docLinkConfigSchema = z.union([
	z.strictObject({ ...configFields, claude: absoluteBinary }),
	z.strictObject({
		...configFields,
		backend: backendName,
		binary: absoluteBinary,
	}),
]);
type Config = z.infer<typeof docLinkConfigSchema>;

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
	const name = "backend" in config ? config.backend : "claude";
	const backend = backends[name];
	const binary = "binary" in config ? config.binary : config.claude;
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
		const outcome = await backend.run(binary, 15_000, {
			allowTools: usesTools(kind),
			prompt: probePrompt,
			input: '{"readiness":true}',
		});
		if (outcome.kind === "answered" && outcome.answer.ready === true)
			remember(kind, { status: "ready", checkAt: now() + checkReadyEvery });
		else if (outcome.kind === "signed_out" || outcome.kind === "plan_limited")
			rememberBlocker(kind, outcome);
		else
			remember(kind, {
				status: null,
				reason: backend.settingsMessage,
				checkAt: now() + retryReadinessAfter,
			});
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
		const task = chat
			? {
					input: JSON.stringify({ turn: claim.turn, history: claim.history }),
					prompt: macDocPrompt,
					allowTools: true,
					chat: {
						url: new URL("/api/engine/doc/mcp", config.engine).href,
						claimId: claim.claim_id,
						credential: config.credential,
					},
				}
			: { ...judgmentTask(claim), allowTools: allowMailTools };
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

export async function readDocLinkConfig(path: string) {
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
	const config = docLinkConfigSchema.safeParse(
		readJson(await file.readFile("utf8")),
	);
	if (!config.success)
		throw new Error("Doc link could not read its configuration file.");
	return config.data;
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
