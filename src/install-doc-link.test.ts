import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
	mkdirSync,
	mkdtempDisposableSync,
	readFileSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { readDocLinkConfig, runDocLink } from "../scripts/doc-link.ts";

const engine = "https://engine.example.test";
const firstCredential = "x".repeat(43);
const secondCredential = "y".repeat(43);
const label = "com.doctorcre.doc-link";
const installer = new URL("../scripts/install-doc-link.ts", import.meta.url);
const wrapper = fileURLToPath(
	new URL("../scripts/install-doc-link.sh", import.meta.url),
);

function fakeMac(
	t: TestContext,
	{
		installed = true,
		signedIn = true,
		subscriptionType = "pro",
		engineStatus = 204,
	}: {
		installed?: boolean;
		signedIn?: boolean;
		subscriptionType?: string | null;
		engineStatus?: number;
	} = {},
) {
	const directory = mkdtempDisposableSync(join(process.cwd(), ".scratch."));
	t.after(() => directory.remove());
	const scratch = directory.path;
	const home = join(scratch, "Home & files");
	const bin = join(scratch, "bin");
	const claude = join(home, ".local/bin/claude");
	const commands = join(scratch, "commands");
	const agent = join(home, "Library", "LaunchAgents", `${label}.plist`);
	const config = join(
		home,
		"Library",
		"Application Support",
		"DoctorCRE Doc",
		"link.json",
	);
	const loaded = join(scratch, "loaded");
	const rejectBootstrap = join(scratch, "reject-bootstrap");
	const oldConfig = join(scratch, "old-config");
	const oldAgent = join(scratch, "old-agent");
	let invocationNumber = 0;
	const codex = join(bin, "codex cli");
	const codexHome = join(home, ".codex");

	mkdirSync(bin);
	mkdirSync(join(home, ".local/bin"), { recursive: true });
	writeFileSync(commands, "");
	const claudeFixture = join(scratch, "claude-fixture");
	writeFileSync(
		claudeFixture,
		`#!/bin/sh
printf 'claude %s\n' "$*" >> "${commands}"
test -z "\${DOC_LINK_CREDENTIAL+x}" || exit 3
case "$*" in *" auth status") ;; *) exit 3;; esac
printf '%s\n' '${JSON.stringify({ loggedIn: signedIn, authMethod: signedIn ? "claude.ai" : "none", ...(subscriptionType === null ? {} : { subscriptionType }) })}'
exit ${signedIn ? 0 : 1}
`,
		{ mode: 0o700 },
	);

	function command(name: string, body: string) {
		writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o700 });
	}
	const plistFixture = join(scratch, "plutil.mjs");
	writeFileSync(
		plistFixture,
		String.raw`
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
assert.deepEqual(process.argv.slice(2), [
	"-extract", "EnvironmentVariables.CODEX_HOME", "raw", "-o", "-", "--", "-",
]);
const plist = readFileSync(0, "utf8");
const value = /<key>EnvironmentVariables<\/key>\s*<dict>[^]*?<key>CODEX_HOME<\/key>\s*<string>(.*?)<\/string>/s.exec(plist)?.[1];
if (value === undefined) process.exit(1);
const entities = { amp: "&", lt: "<", gt: ">" };
console.log(value.replace(/&(amp|lt|gt);/g, (_, name) => entities[name]));
`,
	);
	command("plutil", `exec "${process.execPath}" "${plistFixture}" "$@"`);
	command("uname", "printf '%s\\n' Darwin");
	command(
		"curl",
		`printf 'curl %s\n' "$*" >> "${commands}"
printf '%s\n' '/bin/cp "${claudeFixture}" "${claude}"'`,
	);
	command(
		"launchctl",
		`printf 'launchctl %s\n' "$*" >> "${commands}"
case "$1" in
	print) case "$2" in */${label}) test -f "${loaded}";; *) exit 0;; esac ;;
	enable) exit 0 ;;
	bootout) unlink "${loaded}" ;;
	bootstrap)
		if [ -f "${rejectBootstrap}" ]; then
			cmp -s "${config}" "${oldConfig}" && cmp -s "${agent}" "${oldAgent}" || exit 7
		fi
		[ ! -f "${loaded}" ] && [ "$3" = "${agent}" ] && : > "${loaded}" ;;
	*) exit 3 ;;
esac`,
	);
	if (installed)
		writeFileSync(claude, readFileSync(claudeFixture), { mode: 0o700 });

	const env = {
		HOME: home,
		PATH: `${bin}:/usr/bin:/bin`,
		POST_MEDIA_BUCKET: process.env.POST_MEDIA_BUCKET,
		PARTNER_APP_ORIGIN: process.env.PARTNER_APP_ORIGIN,
		CLIENT_WEBSITE_ORIGIN: process.env.CLIENT_WEBSITE_ORIGIN,
		DOC_BACKUP: process.env.DOC_BACKUP,
		DOC_BACKUP_MODEL: process.env.DOC_BACKUP_MODEL,
		DEALS_READ_SCHEMA: "next",
		HOME_INBOX_READ_SCHEMA: "next",
		LEADS_READ_SCHEMA: "next",
		DIRECTORY_READ_SCHEMA: "next",
		INVOICES_READ_SCHEMA: "next",
		SEARCH_READ_SCHEMA: "next",
		ACTIVITY_READ_SCHEMA: "next",
		RELATIONSHIPS_READ_SCHEMA: "next",
	} as const;
	function prepareRun(
		input = firstCredential,
		{
			args = [engine],
			codexDirectory,
			polls,
			revokeOnNew = false,
			pauseAtPoll = false,
		}: {
			args?: string[];
			codexDirectory?: string | undefined;
			polls?: [string, number, string?][] | undefined;
			revokeOnNew?: boolean;
			pauseAtPoll?: boolean;
		} = {},
	) {
		const invocation = join(scratch, `run-installer-${++invocationNumber}.mjs`);
		writeFileSync(
			invocation,
			`
import assert from "node:assert/strict";
import { once } from "node:events";
import { appendFileSync } from "node:fs";
import { installDocLink } from ${JSON.stringify(installer.href)};
const polls = ${JSON.stringify(polls ?? null)};
let revoked = false;
let fetchError;
let paused = false;
globalThis.fetch = async (url, init) => {
	try {
	const request = new Request(url, init);
	assert.equal(request.method, "POST");
	const credential = request.headers.get("Authorization")?.slice(7);
	if (${pauseAtPoll} && !paused) {
		paused = true;
		const proceed = once(process, "message");
		process.send("poll");
		await proceed;
		process.disconnect();
	}
	const requestOrigin = new URL(request.url).origin;
	if (${pauseAtPoll} && requestOrigin !== ${JSON.stringify(args.at(-1))})
		return new Response(null, { status: 204 });
	const [expectedCredential, status, origin] = polls?.shift() ?? [];
	if (polls) assert.equal(credential, expectedCredential);
	else assert.ok([${JSON.stringify(firstCredential)}, ${JSON.stringify(secondCredential)}].includes(credential));
	assert.equal(request.url, new URL("/api/engine/doc/link/claim", origin ?? ${JSON.stringify(args.at(-1))}).href);
	if (${revokeOnNew} && credential === ${JSON.stringify(secondCredential)}) revoked = true;
	assert.equal(request.headers.get("Doc-Link-Readiness"), null);
	assert.equal(request.headers.get("Cookie"), null);
	assert.equal(request.redirect, "error");
	appendFileSync(${JSON.stringify(commands)}, "engine credential checked\\n");
	return new Response(null, {
		status: revoked && credential === ${JSON.stringify(firstCredential)} ? 401 : (status ?? ${engineStatus}),
	});
	} catch (error) {
		fetchError = error;
		throw error;
	}
};
await installDocLink(process.argv.slice(2), { plutil: ${JSON.stringify(join(bin, "plutil"))} });
if (fetchError) throw fetchError;
if (polls) assert.equal(polls.length, 0);
`,
		);
		return {
			argv: [invocation, ...args],
			env: { ...env, CODEX_HOME: codexDirectory },
			input: `${input}\n`,
		};
	}
	function run(...args: Parameters<typeof prepareRun>) {
		const prepared = prepareRun(...args);
		return spawnSync(process.execPath, prepared.argv, {
			env: prepared.env,
			input: prepared.input,
			encoding: "utf8",
			timeout: 5_000,
		});
	}
	function start(...args: Parameters<typeof prepareRun>) {
		const prepared = prepareRun(...args);
		const child = spawn(process.execPath, prepared.argv, {
			env: prepared.env,
			stdio: ["pipe", "pipe", "pipe", "ipc"],
		});
		assert.ok(child.stdin && child.stdout && child.stderr);
		let stderr = "";
		child.stdout.resume();
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
			stderr += chunk;
		});
		const done = new Promise<{ status: number | null; stderr: string }>(
			(done) => child.once("close", (status) => done({ status, stderr })),
		);
		child.stdin.end(prepared.input);
		t.after(async () => {
			if (child.exitCode === null) child.kill();
			await done;
		});
		return { child, done };
	}
	function runCodex({
		codexDirectory,
		defaultBackend = "codex",
		input = firstCredential,
		polls,
		version = "codex-cli 0.172.0",
		plan = "plus",
		signedIn = true,
	}: {
		codexDirectory?: string;
		defaultBackend?: "claude" | "codex";
		input?: string;
		polls?: [string, number, string?][];
		version?: string;
		plan?: string;
		signedIn?: boolean;
	} = {}) {
		writeFileSync(
			codex,
			`#!/bin/sh
printf 'codex %s\n' "$1" >> "${commands}"
[ "$CODEX_HOME" = "${codexDirectory ?? codexHome}" ] || exit 3
case "$1" in
	--version) printf '%s\n' '${version}' ;;
	login)
		[ "$2" = status ] || exit 3
		case "$*" in *'cli_auth_credentials_store="auto"'*) ;; *) exit 3;; esac
		printf '%s\n' '${signedIn ? "Logged in using ChatGPT" : "Not logged in"}' >&2
		exit ${signedIn ? 0 : 1} ;;
	app-server)
		while IFS= read -r request; do
			case "$request" in
				*'"method":"account/read"'*)
					printf '%s\n' '{"id":2,"result":{"requiresOpenaiAuth":true,"account":{"type":"chatgpt","planType":"${plan}"}}}'
					;;
			esac
		done ;;
	*) exit 3 ;;
esac
`,
			{ mode: 0o700 },
		);
		if (defaultBackend === "claude") {
			symlinkSync(codex, join(bin, "codex"));
			return run(input, { codexDirectory, polls });
		}
		return run(input, {
			args: ["--codex", codex, engine],
			codexDirectory,
			polls,
		});
	}
	return {
		run,
		start,
		runCodex,
		home,
		bin,
		env,
		claude,
		codex,
		agent,
		config,
		commands,
		loaded,
		rejectBootstrap(preserve = false) {
			writeFileSync(rejectBootstrap, "");
			if (preserve) {
				writeFileSync(oldConfig, readFileSync(config), { mode: 0o600 });
				writeFileSync(oldAgent, readFileSync(agent), { mode: 0o600 });
			}
		},
	};
}

test("Codex setup verifies the credential and loads the same job without using Claude", (t) => {
	const mac = fakeMac(t, { installed: false });
	mkdirSync(join(mac.home, ".claude"));
	writeFileSync(join(mac.home, ".claude", "remote-settings.json"), "{}");
	const result = mac.runCodex();
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout.trim(), "Doc link is ready.");
	assert.equal(statSync(mac.config).mode & 0o777, 0o600);
	assert.deepEqual(JSON.parse(readFileSync(mac.config, "utf8")), {
		engine,
		credential: firstCredential,
		default_backend: "codex",
		backends: [{ backend: "codex", binary: mac.codex }],
		codex_home: join(mac.home, ".codex"),
	});
	const commands = readFileSync(mac.commands, "utf8");
	assert.match(
		commands,
		/codex app-server\n[\s\S]*engine credential checked\n[\s\S]*launchctl bootstrap/,
	);
	assert.doesNotMatch(commands, /claude|curl/);
});

for (const defaultBackend of ["claude", "codex"] as const) {
	test(`setup registers both signed-in CLIs with ${defaultBackend} as default`, async (t) => {
		const mac = fakeMac(t);
		const codexDirectory = join(mac.home, "Codex & tools");
		const result = mac.runCodex({
			defaultBackend,
			codexDirectory,
		});
		assert.equal(result.status, 0, result.stderr);
		const codex =
			defaultBackend === "claude" ? join(mac.bin, "codex") : mac.codex;
		const entries = {
			claude: { backend: "claude", binary: mac.claude },
			codex: { backend: "codex", binary: codex },
		};
		assert.deepEqual(await readDocLinkConfig(mac.config), {
			engine,
			credential: firstCredential,
			default_backend: defaultBackend,
			backends: [
				entries[defaultBackend],
				entries[defaultBackend === "claude" ? "codex" : "claude"],
			],
			codex_home: codexDirectory,
		});
		const plist = readFileSync(mac.agent, "utf8");
		assert.match(
			plist,
			/<key>CODEX_HOME<\/key>\s*<string>[^<]+\/Codex &amp; tools<\/string>/,
		);
		assert.ok(plist.includes(`<string>${mac.env.PATH}</string>`));
	});
}

test("switching to Claude from a fresh shell keeps the saved custom Codex home", async (t) => {
	const mac = fakeMac(t);
	const codexDirectory = join(mac.home, "Codex & tools");
	assert.equal(mac.runCodex({ codexDirectory }).status, 0);
	const result = mac.run();
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(await readDocLinkConfig(mac.config), {
		engine,
		credential: firstCredential,
		default_backend: "claude",
		backends: [
			{ backend: "claude", binary: mac.claude },
			{ backend: "codex", binary: mac.codex },
		],
		codex_home: codexDirectory,
	});
});

test("a rejected new launch restores both files and reloads the working job", (t) => {
	const mac = fakeMac(t);
	assert.equal(mac.run().status, 0);
	const config = readFileSync(mac.config, "utf8");
	const agent = readFileSync(mac.agent, "utf8");
	mac.rejectBootstrap(true);
	const result = mac.runCodex();
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Could not start Doc link/);
	assert.equal(readFileSync(mac.config, "utf8"), config);
	assert.equal(readFileSync(mac.agent, "utf8"), agent);
	assert.ok(statSync(mac.loaded).isFile());
});

test("a failed switch leaves Doc signed out when the old credential is revoked", async (t) => {
	const mac = fakeMac(t);
	assert.equal(mac.runCodex().status, 0);
	const agent = readFileSync(mac.agent, "utf8");
	mac.rejectBootstrap(true);

	const result = mac.run(secondCredential, { revokeOnNew: true });

	assert.equal(result.status, 1);
	assert.match(result.stderr, /Setup didn't finish; run it again/);
	for (const path of [mac.config, mac.loaded])
		assert.throws(() => statSync(path), { code: "ENOENT" });
	assert.equal(readFileSync(mac.agent, "utf8"), agent);
});

test("switching a legacy Codex link preserves the home saved only in launchd", async (t) => {
	const mac = fakeMac(t);
	const codexDirectory = join(mac.home, "Codex & tools");
	assert.equal(mac.runCodex({ codexDirectory }).status, 0);
	writeFileSync(
		mac.config,
		JSON.stringify({
			engine,
			backend: "codex",
			binary: mac.codex,
			credential: firstCredential,
		}),
	);

	const result = mac.run();

	assert.equal(result.status, 0, result.stderr);
	const config = await readDocLinkConfig(mac.config);
	assert.ok("backends" in config);
	assert.deepEqual(config.backends, [
		{ backend: "claude", binary: mac.claude },
		{ backend: "codex", binary: mac.codex },
	]);
	assert.equal(config.codex_home, codexDirectory);
	assert.match(
		readFileSync(mac.agent, "utf8"),
		/<key>CODEX_HOME<\/key>\s*<string>[^<]+Codex &amp; tools<\/string>/,
	);
});

test("a rejected first launch removes both new files", (t) => {
	const mac = fakeMac(t);
	mac.rejectBootstrap();
	const result = mac.runCodex();
	assert.equal(result.status, 1);
	for (const path of [mac.config, mac.agent, mac.loaded])
		assert.throws(() => statSync(path), { code: "ENOENT" });
});

test("an overlapping setup exits before touching the holder's snapshot or job", async (t) => {
	const mac = fakeMac(t);
	assert.equal(mac.run().status, 0);
	const config = readFileSync(mac.config, "utf8");
	const agent = readFileSync(mac.agent, "utf8");
	const first = mac.start(secondCredential, {
		args: ["https://other-engine.example.test"],
		pauseAtPoll: true,
	});
	await Promise.race([
		once(first.child, "message"),
		first.done.then(({ stderr }) =>
			assert.fail(`Setup exited before its validation poll. ${stderr}`),
		),
	]);
	const before = readFileSync(mac.commands, "utf8");
	try {
		const second = mac.run(secondCredential);
		assert.equal(second.status, 1, second.stderr);
		assert.equal(
			second.stderr.trim(),
			"Doc setup is already running on this Mac",
		);
		assert.equal(readFileSync(mac.commands, "utf8"), before);
		assert.equal(readFileSync(mac.config, "utf8"), config);
		assert.equal(readFileSync(mac.agent, "utf8"), agent);
		assert.ok(statSync(mac.loaded).isFile());
		mac.rejectBootstrap(true);
	} finally {
		first.child.send("continue");
	}
	const result = await first.done;
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /Could not start Doc link/);
	assert.equal(readFileSync(mac.config, "utf8"), config);
	assert.equal(readFileSync(mac.agent, "utf8"), agent);
	assert.ok(statSync(mac.loaded).isFile());
	assert.throws(() => statSync(join(mac.home, ".doctorcre-doc-setup.lock")), {
		code: "ENOENT",
	});
});

test("setup takes over a lock whose installer process has exited", (t) => {
	const mac = fakeMac(t);
	const exited = spawnSync(process.execPath, ["--version"]);
	assert.equal(exited.status, 0);
	assert.ok(exited.pid > 0);
	const lock = join(mac.home, ".doctorcre-doc-setup.lock");
	mkdirSync(lock);
	writeFileSync(join(lock, `${exited.pid}-0000`), "");
	const result = mac.run();
	assert.equal(result.status, 0, result.stderr);
	assert.ok(statSync(mac.loaded).isFile());
	assert.throws(() => statSync(lock), { code: "ENOENT" });
});

test("Claude setup skips an optional signed-out Codex", async (t) => {
	const mac = fakeMac(t);
	const result = mac.runCodex({ defaultBackend: "claude", signedIn: false });
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(await readDocLinkConfig(mac.config), {
		engine,
		credential: firstCredential,
		default_backend: "claude",
		backends: [{ backend: "claude", binary: mac.claude }],
	});
});

for (const { name, options, message, expectedCommands } of [
	{
		name: "with a different CLI version",
		options: { version: "codex-cli 0.173.0" },
		message: /Codex CLI 0\.172\.0/,
		expectedCommands: "codex --version\n",
	},
	{
		name: "when signed out",
		options: { signedIn: false },
		message:
			/CODEX_HOME=.*codex.* login -c 'cli_auth_credentials_store="auto"'/,
		expectedCommands: "codex --version\ncodex login\n",
	},
	{
		name: "with a team plan",
		options: { plan: "team" },
		message: /personal ChatGPT plan/,
		expectedCommands: "codex --version\ncodex login\ncodex app-server\n",
	},
]) {
	test(`Codex setup refuses ${name}`, (t) => {
		const mac = fakeMac(t);
		const result = mac.runCodex(options);
		assert.equal(result.status, 1, result.stderr);
		assert.match(result.stderr, message);
		assert.equal(
			readFileSync(mac.commands, "utf8").replace(
				/^launchctl print [^\n]*\n/,
				"",
			),
			expectedCommands,
		);
		assert.throws(() => statSync(mac.config), { code: "ENOENT" });
	});
}

test("the setup command forwards the Codex flag and absolute path intact", (t) => {
	const mac = fakeMac(t);
	writeFileSync(
		join(mac.bin, "node"),
		`#!/bin/sh
if [ "$1" = --version ]; then
	printf '%s\n' v26.0.0
	exit 0
fi
printf '%s\n' "$@"
`,
		{ mode: 0o700 },
	);
	const args = ["--codex", mac.codex, engine];
	const result = spawnSync("/bin/bash", [wrapper, ...args], {
		env: mac.env,
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stderr);
	assert.equal(
		result.stdout,
		[fileURLToPath(installer), ...args, ""].join("\n"),
	);
});

test("first setup installs official Claude Code and loads Doc link from private config", async (t) => {
	const mac = fakeMac(t, { installed: false });
	const result = mac.run();
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout.trim(), "Doc link is ready.");
	assert.equal(statSync(mac.config).mode & 0o777, 0o600);
	assert.deepEqual(await readDocLinkConfig(mac.config), {
		engine,
		credential: firstCredential,
		default_backend: "claude",
		backends: [{ backend: "claude", binary: mac.claude }],
	});
	const plist = readFileSync(mac.agent, "utf8");
	assert.ok(plist.includes(process.execPath));
	assert.ok(plist.includes("Home &amp; files"));
	assert.ok(plist.includes("doc-link.ts"));
	assert.ok(plist.includes("link.json"));
	assert.ok(plist.includes("link.log"));
	const commands = readFileSync(mac.commands, "utf8");
	assert.match(commands, /curl .* https:\/\/claude\.ai\/install\.sh/);
	assert.match(
		commands,
		/engine credential checked\n[\s\S]*launchctl bootstrap gui\/\d+/,
	);
	assert.doesNotMatch(commands, /launchctl bootout/);
});

test("rerun replaces the config and reloads the existing job without reinstalling Claude", async (t) => {
	const mac = fakeMac(t);
	assert.equal(mac.run().status, 0);
	assert.equal(mac.run(secondCredential).status, 0);
	assert.equal(
		(await readDocLinkConfig(mac.config)).credential,
		secondCredential,
	);
	const commands = readFileSync(mac.commands, "utf8");
	assert.doesNotMatch(commands, /curl/);
	assert.match(
		commands,
		/launchctl bootout gui\/\d+\/com\.doctorcre\.doc-link\n[\s\S]*launchctl bootstrap/,
	);
	assert.equal(commands.match(/launchctl bootstrap/g)?.length, 2);
});

test("the setup command tells the partner to install Node 26 when it is missing or older", (t) => {
	const mac = fakeMac(t);
	const args = [wrapper, engine];
	const options = {
		env: { ...mac.env, PATH: mac.bin },
		encoding: "utf8",
	} as const;
	for (const version of [undefined, "v25.0.0"]) {
		if (version)
			writeFileSync(
				join(mac.bin, "node"),
				`#!/bin/sh\nprintf '%s\\n' '${version}'\n`,
				{ mode: 0o700 },
			);
		const result = spawnSync("/bin/bash", args, options);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Install Node\.js 26/);
	}
	assert.equal(readFileSync(mac.commands, "utf8"), "");
});

test("the setup command requires macOS", (t) => {
	const mac = fakeMac(t);
	writeFileSync(join(mac.bin, "uname"), "#!/bin/sh\nprintf '%s\\n' Linux\n");
	const result = spawnSync("/bin/bash", [wrapper, engine], {
		env: mac.env,
		encoding: "utf8",
	});
	assert.equal(result.status, 1);
	assert.match(result.stderr, /requires macOS/);
});

test("the setup command finds the installer with CDPATH set", (t) => {
	const mac = fakeMac(t);
	writeFileSync(
		join(mac.bin, "node"),
		`#!/bin/sh
if [ "$1" = "--version" ]; then
	printf '%s\\n' v26.0.0
	exit 0
fi
[ "$#" -eq 2 ] && [ "$1" = ${JSON.stringify(fileURLToPath(installer))} ] &&
	[ "$2" = ${JSON.stringify(engine)} ] && printf '%s\\n' 'Installer reached.'
`,
		{ mode: 0o700 },
	);
	const result = spawnSync(
		"/bin/bash",
		["scripts/install-doc-link.sh", engine],
		{
			env: { ...mac.env, CDPATH: "." },
			encoding: "utf8",
		},
	);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout.trim(), "Installer reached.");
});

test("setup tells a signed-out partner how to sign in and does not load the job", (t) => {
	const mac = fakeMac(t, { signedIn: false });
	const result = mac.run();
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Run claude and sign in/);
	assert.doesNotMatch(
		readFileSync(mac.commands, "utf8"),
		/launchctl bootstrap/,
	);
});

test("managed Claude settings allow Claude chat setup", (t) => {
	const mac = fakeMac(t, { installed: false });
	mkdirSync(join(mac.home, ".claude"));
	writeFileSync(join(mac.home, ".claude", "remote-settings.json"), "{}");
	const result = mac.run();
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout.trim(), "Doc link is ready.");
});

for (const subscriptionType of ["team", "enterprise"]) {
	test(`setup refuses a ${subscriptionType} login even without a managed settings cache`, (t) => {
		const mac = fakeMac(t, { subscriptionType });
		const result = mac.run();
		assert.equal(result.status, 1, result.stderr);
		assert.match(result.stderr, /Doc needs your own Claude plan/);
		assert.doesNotMatch(
			readFileSync(mac.commands, "utf8"),
			/launchctl (?:bootout|bootstrap)|engine/,
		);
	});
}

test("Doc link offers neither kind without a verified Claude subscription", async (t) => {
	const mac = fakeMac(t, { subscriptionType: null });
	const errors = t.mock.method(console, "error", () => {});
	const polls: Headers[] = [];
	await runDocLink(
		{ engine, claude: mac.claude, credential: firstCredential },
		{
			fetch: async (_url, init) => {
				polls.push(new Headers(init?.headers));
				return new Response(null, { status: 401 });
			},
			now: () => 0,
			wait: async () => {
				assert.fail("Doc should stop after a refused poll");
			},
		},
	);
	assert.equal(polls.length, 1);
	assert.equal(polls[0]?.get("Doc-Link-Work"), null);
	assert.deepEqual(JSON.parse(polls[0]?.get("Doc-Link-Work-Readiness") ?? ""), {
		chat: "signed_out",
		mail: "signed_out",
	});
	assert.deepEqual(errors.mock.calls.map((call) => call.arguments[0]).sort(), [
		"Doc chat: Doc needs your own Claude plan.",
		"Doc mail: Doc needs your own Claude plan.",
	]);
});

for (const engineStatus of [401, 403]) {
	test(`setup reports a refused Doc link code on ${engineStatus} before loading the job`, (t) => {
		const mac = fakeMac(t, { engineStatus });
		const result = mac.run();
		assert.equal(result.status, 1, result.stderr);
		assert.equal(result.stdout, "");
		assert.equal(
			result.stderr.trim(),
			"The Doc link code was refused. Make a new one in the app and run this again.",
		);
		const commands = readFileSync(mac.commands, "utf8");
		assert.match(commands, /engine credential checked/);
		assert.doesNotMatch(commands, /launchctl bootstrap/);
		assert.throws(() => statSync(mac.config), { code: "ENOENT" });
		assert.ok(!result.stderr.includes(firstCredential));
	});
}

test("setup keeps credentials out of child arguments, output and the LaunchAgent", (t) => {
	const mac = fakeMac(t);
	const result = mac.run();
	assert.equal(result.status, 0, result.stderr);
	for (const output of [
		result.stdout,
		result.stderr,
		readFileSync(mac.commands, "utf8"),
		readFileSync(mac.agent, "utf8"),
	]) {
		assert.ok(!output.includes(firstCredential));
	}
	const invalid = mac.run(`invalid-${firstCredential}`);
	assert.equal(invalid.status, 1);
	assert.match(invalid.stderr, /Copy a Doc link credential/);
	assert.ok(!invalid.stderr.includes(firstCredential));
});
