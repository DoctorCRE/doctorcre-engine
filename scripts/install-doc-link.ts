import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	access,
	link,
	lstat,
	mkdir,
	mkdtempDisposable,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, URL } from "node:url";
import {
	configuredBackends,
	docLinkConfigSchema,
	docLinkEngineSchema,
	postDocLink,
	type RegisteredBackend,
	readDocLinkConfig,
} from "./doc-link.ts";
import {
	checkCodexSignIn,
	codexHome,
	codexVersion,
	ownClaudePlanMessage,
	signInStatus,
} from "./doc-link-backends.ts";

const label = "com.doctorcre.doc-link";

class SetupError extends Error {}

type Setup =
	| { kind: "claude"; origin: string }
	| { kind: "codex"; origin: string; binary: string };

function parseSetup(args: readonly string[]): Setup {
	const [first, binary, origin] = args;
	if (args.length === 3 && first === "--codex" && binary && origin) {
		if (!isAbsolute(binary))
			throw new SetupError("Pass the absolute path to Codex after --codex.");
		return { kind: "codex", origin, binary };
	}
	if (args.length === 1 && first && first !== "--codex")
		return { kind: "claude", origin: first };
	throw new SetupError(
		"Run bash scripts/install-doc-link.sh with the HTTPS engine origin. For Codex, put --codex and its absolute path before the origin.",
	);
}

function findOnPath(name: RegisteredBackend["backend"]) {
	const lookup = spawnSync(
		"/bin/bash",
		["-c", 'type -P -- "$1"', "bash", name],
		{
			encoding: "utf8",
		},
	);
	const path = lookup.stdout?.trim();
	return lookup.status === 0 && path ? resolve(path) : undefined;
}

async function findClaude() {
	// Keep Anthropic's launcher path so native updates can move its symlink.
	const nativeLauncher = join(homedir(), ".local/bin/claude");
	const nativeFile = await stat(nativeLauncher).catch(() => undefined);
	if (
		nativeFile?.isFile() &&
		(await access(nativeLauncher, constants.X_OK).then(
			() => true,
			() => false,
		))
	) {
		return nativeLauncher;
	}
	return findOnPath("claude");
}

async function installClaude() {
	const download = spawnSync("curl", [
		"--disable",
		"-fsSL",
		"--proto",
		"=https",
		"--proto-redir",
		"=https",
		"https://claude.ai/install.sh",
	]);
	if (download.status !== 0)
		throw new SetupError(
			"Could not download Claude Code. Check your connection and run setup again.",
		);
	if (spawnSync("/bin/bash", ["-s"], { input: download.stdout }).status !== 0)
		throw new SetupError(
			"Claude Code installation failed. Follow the setup instructions at code.claude.com and run setup again.",
		);
	const claude = await findClaude();
	if (!claude)
		throw new SetupError(
			"Could not find Claude Code. Add claude to your PATH and run setup again.",
		);
	return claude;
}

async function readCredential() {
	const terminal = Boolean(process.stdin.isTTY);
	// Terminal readline uses raw mode and has no output stream to echo input.
	const lines = createInterface({ input: process.stdin, terminal });
	try {
		if (terminal)
			process.stderr.write(
				"Paste your Doc link credential and press Return (hidden). ",
			);
		for await (const line of lines) return line;
	} finally {
		lines.close();
		if (terminal) process.stderr.write("\n");
	}
}

async function replaceFile(path: string, contents: string) {
	await using directory = await mkdtempDisposable(
		join(dirname(path), ".doc-link-"),
	);
	const pending = join(directory.path, "pending");
	await writeFile(pending, contents, { mode: 0o600, flag: "wx" });
	await rename(pending, path);
}

async function renderLaunchAgent(
	config: string,
	log: string,
	codexDirectory: string | undefined,
) {
	const template = await readFile(
		new URL(`./launchd/${label}.plist`, import.meta.url),
		"utf8",
	);
	const paths: Record<string, string> = {
		__NODE_PATH__: process.execPath,
		__DOC_LINK_SCRIPT_PATH__: fileURLToPath(
			new URL("./doc-link.ts", import.meta.url),
		),
		__DOC_LINK_CONFIG_PATH__: config,
		__DOC_LINK_ERROR_LOG_PATH__: log,
		__DOC_LINK_PATH__: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
		__CODEX_HOME__: codexDirectory ?? "",
	};
	return template.replace(/__[A-Z_]+__/g, (token) =>
		(paths[token] ?? token)
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;"),
	);
}

function launchctl(...args: string[]) {
	return spawnSync("launchctl", args, { stdio: "ignore" }).status === 0;
}

type LinkFile = {
	path: string;
	contents: string;
	backup?: string;
	changed?: true;
};

function ignoreMissing(error: unknown) {
	if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
		throw error;
}

async function activateLink(
	domain: string,
	service: string,
	agent: LinkFile,
	config: LinkFile,
) {
	const files = [agent, config];
	const wasRunning = launchctl("print", service);
	try {
		if (wasRunning && !launchctl("bootout", service))
			throw new SetupError(
				"Could not stop the existing Doc link. Sign out of macOS and back in, then run setup again.",
			);
		for (const file of files) {
			const backup = `${file.path}.backup-${randomUUID()}`;
			await link(file.path, backup)
				.then(() => {
					file.backup = backup;
				})
				.catch(ignoreMissing);
			file.changed = true;
			await replaceFile(file.path, file.contents);
		}
		if (
			!launchctl("enable", service) ||
			!launchctl("bootstrap", domain, agent.path)
		)
			throw new SetupError(
				"Could not start Doc link. Check that your macOS login allows background items and run setup again.",
			);
	} catch (error) {
		const stopped =
			!files.some(({ changed }) => changed) ||
			!launchctl("print", service) ||
			launchctl("bootout", service);
		const restored = await Promise.allSettled(
			files.map(async (file) => {
				if (file.backup) await rename(file.backup, file.path);
				else if (file.changed) await unlink(file.path).catch(ignoreMissing);
			}),
		);
		if (
			!stopped ||
			restored.some(({ status }) => status === "rejected") ||
			(wasRunning &&
				!launchctl("print", service) &&
				!launchctl("bootstrap", domain, agent.path))
		)
			throw new SetupError(
				"Restore the previous Doc link files from the .backup files if present, then reload Doc link in your macOS login.",
			);
		await Promise.allSettled(
			files.map(({ backup }) => backup && unlink(backup)),
		);
		throw error;
	}
	await Promise.allSettled(files.map(({ backup }) => backup && unlink(backup)));
}

async function prepareClaude(
	recorded: string | undefined,
): Promise<RegisteredBackend> {
	const previous =
		recorded &&
		(await access(recorded, constants.X_OK).then(
			() => recorded,
			() => undefined,
		));
	const claude = (await findClaude()) ?? previous ?? (await installClaude());
	const status = await signInStatus(claude);
	if (status === "signed_out")
		throw new SetupError(
			"Run claude and sign in with your Claude subscription, then run setup again. Try ~/.local/bin/claude if needed.",
		);
	if (status === "personal_plan_required")
		throw new SetupError(ownClaudePlanMessage);
	if (status !== "ready")
		throw new SetupError(
			"Could not check Claude Code sign-in. Run claude to check your sign-in, then run setup again.",
		);
	return { backend: "claude", binary: claude };
}

async function prepareCodex(
	binary: string,
	home: string,
): Promise<RegisteredBackend> {
	const status = await checkCodexSignIn(binary, home);
	if (status === "wrong_version")
		throw new SetupError(
			`Pass the absolute path to the Codex CLI ${codexVersion} binary after --codex.`,
		);
	if (status === "personal_plan_required")
		throw new SetupError("Switch Codex to your personal ChatGPT plan.");
	if (status !== "ready") {
		const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
		const command = `CODEX_HOME=${quote(home)} ${quote(binary)} login`;
		const store = `-c 'cli_auth_credentials_store="auto"'`;
		throw new SetupError(
			status === "signed_out"
				? `Sign in with your personal ChatGPT plan.\n${command} ${store}`
				: `Check your Codex sign-in with this command.\n${command} status ${store}`,
		);
	}
	return { backend: "codex", binary };
}

async function discoverBackend(
	name: RegisteredBackend["backend"],
	paths: (string | undefined)[],
	home: string,
): Promise<RegisteredBackend | undefined> {
	for (const binary of new Set(paths)) {
		if (!binary) continue;
		const status =
			name === "codex"
				? await checkCodexSignIn(binary, home)
				: await signInStatus(binary);
		if (status === "ready") return { backend: name, binary };
	}
}

export async function installDocLink(args: readonly string[]) {
	try {
		const setup = parseSetup(args);
		const engine = docLinkEngineSchema.safeParse(setup.origin);
		if (!engine.success)
			throw new SetupError(
				"Use the HTTPS engine origin supplied with your Doc setup command.",
			);
		const library = join(homedir(), "Library");
		const support = join(library, "Application Support", "DoctorCRE Doc");
		const agents = join(library, "LaunchAgents");
		const configPath = join(support, "link.json");
		const existing = await readDocLinkConfig(configPath).catch(() => undefined);
		const savedCodexHome =
			existing && "backends" in existing ? existing.codex_home : undefined;
		const home =
			!process.env.CODEX_HOME && savedCodexHome ? savedCodexHome : codexHome();
		const registrations = existing ? configuredBackends(existing) : [];
		const recorded = (name: RegisteredBackend["backend"]) =>
			registrations.find(({ backend }) => backend === name)?.binary;

		const selected =
			setup.kind === "codex"
				? await prepareCodex(setup.binary, home)
				: await prepareClaude(recorded("claude"));
		const other =
			setup.kind === "codex"
				? await discoverBackend(
						"claude",
						[await findClaude(), recorded("claude")],
						home,
					)
				: await discoverBackend(
						"codex",
						[findOnPath("codex"), recorded("codex")],
						home,
					);
		const registered = other ? [selected, other] : [selected];
		const codexDirectory =
			savedCodexHome || registered.some(({ backend }) => backend === "codex")
				? home
				: undefined;

		const domain = `gui/${process.getuid?.()}`;
		const service = `${domain}/${label}`;
		if (!launchctl("print", domain))
			throw new SetupError(
				"Open Terminal under your macOS login and run setup again.",
			);

		const config = docLinkConfigSchema.safeParse({
			engine: engine.data,
			default_backend: selected.backend,
			backends: registered,
			...(codexDirectory && { codex_home: codexDirectory }),
			credential: await readCredential(),
		});
		if (!config.success)
			throw new SetupError(
				"Copy a Doc link credential from the app and run setup again.",
			);
		// A poll without a readiness header verifies the credential without claiming a turn.
		const poll = await postDocLink(config.data, "claim");
		if (poll?.status === 401 || poll?.status === 403)
			throw new SetupError(
				"The Doc link code was refused. Make a new one in the app and run this again.",
			);
		if (!poll)
			throw new SetupError(
				"Could not reach the engine. Check your internet connection and the HTTPS engine origin, then run setup again.",
			);
		if (poll.status !== 204)
			throw new SetupError(
				`The engine could not verify the Doc link code (HTTP ${poll.status}). Check the engine origin and try again.`,
			);

		await mkdir(support, { recursive: true, mode: 0o700 });
		const info = await lstat(support);
		if (
			!info.isDirectory() ||
			info.uid !== process.geteuid?.() ||
			(info.mode & 0o077) !== 0
		)
			throw new SetupError(
				"Check that you own the DoctorCRE Doc folder in Library/Application Support and set its permissions to 700.",
			);
		await mkdir(agents, { recursive: true });
		const agent = join(agents, `${label}.plist`);
		await activateLink(
			domain,
			service,
			{
				path: agent,
				contents: await renderLaunchAgent(
					configPath,
					join(support, "link.log"),
					codexDirectory,
				),
			},
			{ path: configPath, contents: `${JSON.stringify(config.data)}\n` },
		);
		process.stdout.write("Doc link is ready.\n");
	} catch (error) {
		const message =
			error instanceof SetupError
				? error.message
				: "Could not finish Doc link setup. Check that you can write to your Library folder and run setup again.";
		process.stderr.write(`${message}\n`);
		process.exitCode = 1;
	}
}

if (import.meta.main) await installDocLink(process.argv.slice(2));
