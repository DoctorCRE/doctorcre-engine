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
import { readDocLinkConfig } from "../scripts/doc-link.ts";

const engine = "https://engine.example.test";
const firstCredential = "x".repeat(43);
const secondCredential = "y".repeat(43);
const label = "com.doctorcre.doc-link";
const installer = new URL("../scripts/install-doc-link.ts", import.meta.url);
const wrapper = fileURLToPath(
	new URL("../scripts/install-doc-link.sh", import.meta.url),
);

function fakeMac(t: TestContext, { installed = true, signedIn = true } = {}) {
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
printf '%s\n' '${JSON.stringify({ loggedIn: signedIn, authMethod: signedIn ? "claude.ai" : "none" })}'
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
	};
	function run(input = firstCredential) {
		const invocation = `
import { installDocLink } from ${JSON.stringify(installer.href)};
await installDocLink(process.argv[1], {
	directory: process.argv[2],
	preferences: [process.argv[2] + ".plist"],
	cache: process.env.HOME + "/.claude/remote-settings.json"
});
`;
		return spawnSync(
			process.execPath,
			["--input-type=module", "-e", invocation, engine, managed],
			{
				env,
				input: `${input}\n`,
				encoding: "utf8",
				timeout: 5_000,
			},
		);
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
	assert.match(commands, /launchctl bootstrap gui\/\d+/);
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
