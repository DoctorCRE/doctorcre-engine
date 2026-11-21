import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import {
	access,
	lstat,
	mkdir,
	mkdtempDisposable,
	readFile,
	rename,
	stat,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, URL } from "node:url";
import {
	docLinkConfigSchema,
	hasManagedPolicy,
	ownClaudePlanMessage,
	postDocLink,
	signInStatus,
} from "./doc-link.ts";

const label = "com.doctorcre.doc-link";
const managedSettingsMessage =
	"Use a Mac without managed Claude Code settings.";

class SetupError extends Error {}

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
	const lookup = spawnSync("/bin/bash", ["-c", "type -P claude"], {
		encoding: "utf8",
	});
	const path = lookup.stdout?.trim();
	return lookup.status === 0 && path ? resolve(path) : undefined;
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

async function writeLaunchAgent(agent: string, config: string, log: string) {
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
	};
	await replaceFile(
		agent,
		template.replace(/__[A-Z_]+__/g, (token) =>
			(paths[token] ?? token)
				.replaceAll("&", "&amp;")
				.replaceAll("<", "&lt;")
				.replaceAll(">", "&gt;"),
		),
	);
}

function launchctl(...args: string[]) {
	return spawnSync("launchctl", args, { stdio: "ignore" }).status === 0;
}

export async function installDocLink(
	origin: string | undefined,
	managedSettings?: Parameters<typeof hasManagedPolicy>[0],
) {
	try {
		const engine = docLinkConfigSchema.shape.engine.safeParse(origin);
		if (!engine.success)
			throw new SetupError(
				"Use the HTTPS engine origin supplied with your Doc setup command.",
			);
		if (await hasManagedPolicy(managedSettings))
			throw new SetupError(managedSettingsMessage);

		const claude = (await findClaude()) ?? (await installClaude());
		if (await hasManagedPolicy(managedSettings))
			throw new SetupError(managedSettingsMessage);
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
		if (await hasManagedPolicy(managedSettings))
			throw new SetupError(managedSettingsMessage);

		const domain = `gui/${process.getuid?.()}`;
		const service = `${domain}/${label}`;
		if (!launchctl("print", domain))
			throw new SetupError(
				"Open Terminal under your macOS login and run setup again.",
			);

		const config = docLinkConfigSchema.safeParse({
			engine: engine.data,
			claude,
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

		const library = join(homedir(), "Library");
		const support = join(library, "Application Support", "DoctorCRE Doc");
		const agents = join(library, "LaunchAgents");
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
		const configPath = join(support, "link.json");
		const agent = join(agents, `${label}.plist`);
		await writeLaunchAgent(agent, configPath, join(support, "link.log"));
		await replaceFile(configPath, `${JSON.stringify(config.data)}\n`);

		if (launchctl("print", service) && !launchctl("bootout", service))
			throw new SetupError(
				"Could not stop the existing Doc link. Sign out of macOS and back in, then run setup again.",
			);
		if (!launchctl("enable", service) || !launchctl("bootstrap", domain, agent))
			throw new SetupError(
				"Could not start Doc link. Check that your macOS login allows background items and run setup again.",
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

if (import.meta.main) await installDocLink(process.argv[2]);
