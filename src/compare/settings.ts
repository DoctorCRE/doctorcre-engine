import { isOneOf, PARTNERS } from "../clients/read.ts";

export class SettingsError extends Error {}

export const KEYCHAIN_SERVICE = "doctorcre-compare-access";

// Visible ASCII only, so a stored value can't add a header or break one.
const HEADER_VALUE = /^[\x21-\x7E]+$/;

export type Keychain = (account: string) => string | undefined;

export function readSettings(
	env: Record<string, string | undefined>,
	keychain: Keychain,
) {
	const target = env.COMPARE_TARGET;
	if (target !== "staging" && target !== "production")
		throw new SettingsError("Set COMPARE_TARGET to staging or production.");
	if (target === "production" && env.COMPARE_CONFIRM_PRODUCTION !== "read-only")
		throw new SettingsError(
			"Set COMPARE_CONFIRM_PRODUCTION=read-only to compare on production.",
		);
	const partner = env.COMPARE_PARTNER ?? "";
	if (!isOneOf(PARTNERS, partner))
		throw new SettingsError(`Set COMPARE_PARTNER to ${PARTNERS.join(" or ")}.`);
	const engine = URL.parse(env.COMPARE_ENGINE_URL ?? "");
	if (engine?.protocol !== "https:" || engine.href !== `${engine.origin}/`)
		throw new SettingsError(
			"Set COMPARE_ENGINE_URL to the engine's https base URL, with no path, query or fragment.",
		);
	const fromKeychain = (item: string) => {
		const account = `${target}-${item}`;
		const value = keychain(account);
		if (!value || !HEADER_VALUE.test(value))
			throw new SettingsError(
				`Keep the comparison's Access ${item} in the login keychain as service ${KEYCHAIN_SERVICE}, account ${account}.`,
			);
		return value;
	};
	return {
		target,
		door: new URL(`/compare/${partner}`, engine),
		token: {
			id: fromKeychain("client-id"),
			secret: fromKeychain("client-secret"),
		},
	};
}
