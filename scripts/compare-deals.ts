import { execFileSync } from "node:child_process";
import { askers, pause } from "../src/compare/ask.ts";
import { report } from "../src/compare/report.ts";
import { compareDeals, exitCode } from "../src/compare/run.ts";
import {
	KEYCHAIN_SERVICE,
	readSettings,
	SettingsError,
} from "../src/compare/settings.ts";

// The secret comes back on a pipe, never on a command line or the screen.
function keychain(account: string) {
	try {
		return execFileSync(
			"security",
			["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		).trimEnd();
	} catch {
		return undefined;
	}
}

let settings: ReturnType<typeof readSettings>;
try {
	settings = readSettings(process.env, keychain);
} catch (error) {
	console.error(
		error instanceof SettingsError
			? error.message
			: "Settings could not be read.",
	);
	process.exit(2);
}
const { askEngine, askOld } = askers(settings.door, settings.token, fetch);

try {
	const run = await compareDeals(askEngine, askOld, pause);
	process.stdout.write(report(settings.target, run));
	process.exitCode = exitCode(run);
} catch {
	console.error(
		"The comparison failed. Details are not printed because they can hold record content.",
	);
	process.exitCode = 2;
}
