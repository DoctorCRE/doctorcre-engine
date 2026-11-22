import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempDisposableSync,
	readFileSync,
	statSync,
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
	const managed = join(scratch, "managed");
	const agent = join(home, "Library", "LaunchAgents", `${label}.plist`);
	const config = join(
		home,
		"Library",
		"Application Support",
		"DoctorCRE Doc",
		"link.json",
	);
	const loaded = join(scratch, "loaded");

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
	bootstrap) [ ! -f "${loaded}" ] && [ "$3" = "${agent}" ] && : > "${loaded}" ;;
	*) exit 3 ;;
esac`,
	);
	if (installed)
		writeFileSync(claude, readFileSync(claudeFixture), { mode: 0o700 });

	const env = {
		HOME: home,
		PATH: `${bin}:/usr/bin:/bin`,
		POST_MEDIA_BUCKET: process.env.POST_MEDIA_BUCKET,
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
	function run(input = firstCredential) {
		const invocation = join(scratch, "run-installer.mjs");
		writeFileSync(
			invocation,
			`
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { installDocLink } from ${JSON.stringify(installer.href)};
globalThis.fetch = async (url, init) => {
	const request = new Request(url, init);
	assert.equal(request.url, ${JSON.stringify(`${engine}/api/engine/doc/link/claim`)});
	assert.equal(request.method, "POST");
	assert.equal(request.headers.get("Authorization"), ${JSON.stringify(`Bearer ${input}`)});
	assert.equal(request.headers.get("Doc-Link-Readiness"), null);
	assert.equal(request.headers.get("Cookie"), null);
	assert.equal(request.redirect, "error");
	appendFileSync(${JSON.stringify(commands)}, "engine credential checked\\n");
	return new Response(null, { status: ${engineStatus} });
};
await installDocLink(process.argv[2], {
	directory: process.argv[3],
	preferences: [process.argv[3] + ".plist"],
	cache: process.env.HOME + "/.claude/remote-settings.json"
});
`,
		);
		return spawnSync(process.execPath, [invocation, engine, managed], {
			env,
			input: `${input}\n`,
			encoding: "utf8",
			timeout: 5_000,
		});
	}
	return { run, home, bin, env, claude, agent, config, commands };
}

test("first setup installs official Claude Code and loads Doc link from private config", async (t) => {
	const mac = fakeMac(t, { installed: false });
	const result = mac.run();
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout.trim(), "Doc link is ready.");
	assert.equal(statSync(mac.config).mode & 0o777, 0o600);
	assert.deepEqual(await readDocLinkConfig(mac.config), {
		engine,
		claude: mac.claude,
		credential: firstCredential,
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

test("managed Claude settings block setup before installing or running Claude", (t) => {
	const mac = fakeMac(t, { installed: false });
	mkdirSync(join(mac.home, ".claude"));
	writeFileSync(join(mac.home, ".claude", "remote-settings.json"), "{}");
	const result = mac.run();
	assert.equal(result.status, 1);
	assert.match(result.stderr, /without managed Claude Code settings/);
	assert.equal(readFileSync(mac.commands, "utf8"), "");
});

for (const subscriptionType of ["team", "enterprise"]) {
	test(`setup refuses a ${subscriptionType} login even without a managed settings cache`, (t) => {
		const mac = fakeMac(t, { subscriptionType });
		const result = mac.run();
		assert.equal(result.status, 1, result.stderr);
		assert.match(result.stderr, /Doc needs your own Claude plan/);
		assert.doesNotMatch(readFileSync(mac.commands, "utf8"), /launchctl|engine/);
	});
}

test("Doc link pauses when Claude does not report its subscription type", async (t) => {
	const mac = fakeMac(t, { subscriptionType: null });
	const errors = t.mock.method(console, "error", () => {});
	const stopped = new Error("End the test while polling is paused");
	await assert.rejects(
		runDocLink(
			{ engine, claude: mac.claude, credential: firstCredential },
			{
				fetch: async () => new Response(null, { status: 401 }),
				now: () => 0,
				wait: async () => {
					throw stopped;
				},
			},
		),
		stopped,
	);
	assert.equal(errors.mock.calls.length, 1);
	assert.match(
		String(errors.mock.calls[0]?.arguments[0]),
		/Doc needs your own Claude plan/,
	);
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
