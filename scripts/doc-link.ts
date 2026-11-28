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
import { macDocPrompt } from "../src/doc-prompt.ts";
import {
	backends,
	codexHome,
	isCodexCatalogValid,
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

type Readiness = "ready" | "signed_out" | "plan_limited";
const checkSignInEvery = 30_000;
const pollEvery = 2_000;
const allowMailTools = false;
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

	let readiness: Readiness | "personal_plan_required" | undefined;
	let checkAt = 0;
	async function checkSignIn() {
		const status = await backend.signIn(binary);
		if (status === "personal_plan_required" && readiness !== status)
			console.error(backend.personalPlanMessage);
		readiness = status;
		checkAt = now() + checkSignInEvery;
		return status;
	}

	for (; ; await wait()) {
		if (now() >= checkAt) await checkSignIn();
		if (readiness === "personal_plan_required") continue;
		const headers = new Headers({ "Doc-Link-Backend": name });
		if (readiness) headers.set("Doc-Link-Readiness", readiness);
		if (readiness === "ready" && (await mailAllowed()))
			headers.set("Doc-Link-Work", "judgment, email_split, introduction");
		const poll = await postDocLink(config, "claim", { headers }, fetch);
		if (poll?.status === 401) return;
		if (poll?.status !== 200 || readiness !== "ready") continue;

		const claim = claimSchema.safeParse(
			await poll.json().catch(() => undefined),
		).data;
		if (!claim) continue;
		const chat = claim.kind === "turn";
		if (!chat && !(await mailAllowed())) continue;
		if ((await checkSignIn()) !== "ready" || (!chat && !(await mailAllowed())))
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
		if (outcome.kind === "signed_out" || outcome.kind === "plan_limited") {
			readiness = outcome.kind;
			const reset = outcome.kind === "plan_limited" && outcome.resetsAt;
			checkAt =
				reset && reset * 1_000 > now()
					? reset * 1_000
					: now() +
						(outcome.kind === "plan_limited" ? 300_000 : checkSignInEvery);
		}
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
