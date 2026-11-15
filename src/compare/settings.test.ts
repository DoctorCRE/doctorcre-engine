import assert from "node:assert/strict";
import { test } from "node:test";
import { type Keychain, readSettings } from "./settings.ts";

const base = {
	COMPARE_PARTNER: "joe",
	COMPARE_ENGINE_URL: "https://engine.example.test",
};
const staging = { ...base, COMPARE_TARGET: "staging" };
const stored: Keychain = (account) => `made-up-${account}`;

test("runs only against a named target, and production needs a read-only acknowledgement", () => {
	assert.throws(
		() => readSettings(base, stored),
		/COMPARE_TARGET to staging or production/,
	);
	assert.throws(
		() => readSettings({ ...base, COMPARE_TARGET: "local" }, stored),
		/COMPARE_TARGET/,
	);
	assert.equal(readSettings(staging, stored).target, "staging");
	const production = { ...base, COMPARE_TARGET: "production" };
	assert.throws(
		() => readSettings(production, stored),
		/COMPARE_CONFIRM_PRODUCTION=read-only/,
	);
	assert.throws(
		() =>
			readSettings(
				{ ...production, COMPARE_CONFIRM_PRODUCTION: "yes" },
				stored,
			),
		/COMPARE_CONFIRM_PRODUCTION/,
	);
	assert.equal(
		readSettings(
			{ ...production, COMPARE_CONFIRM_PRODUCTION: "read-only" },
			stored,
		).target,
		"production",
	);
});

test("reads through the engine's comparison door as the named partner", () => {
	assert.equal(
		readSettings(staging, stored).door.href,
		"https://engine.example.test/compare/joe",
	);
	assert.equal(
		readSettings({ ...staging, COMPARE_PARTNER: "dell" }, stored).door.href,
		"https://engine.example.test/compare/dell",
	);
	for (const partner of [undefined, "", "Joe", "someone"])
		assert.throws(
			() => readSettings({ ...staging, COMPARE_PARTNER: partner }, stored),
			/COMPARE_PARTNER to joe or dell/,
		);
});

test("the engine URL is an https origin, and a refused value is never echoed", () => {
	for (const value of [
		undefined,
		"http://engine.example.test",
		"not a url secretmarker",
		"https://engine.example.test/secretmarker",
		"https://engine.example.test/?secretmarker=1",
		"https://engine.example.test/#secretmarker",
		"https://secretmarker@engine.example.test/",
	])
		assert.throws(
			() => readSettings({ ...staging, COMPARE_ENGINE_URL: value }, stored),
			(error: Error) =>
				/COMPARE_ENGINE_URL/.test(error.message) &&
				!error.message.includes("secretmarker"),
		);
});

test("takes the target's Access token from the keychain", () => {
	const asked: string[] = [];
	const production = {
		...base,
		COMPARE_TARGET: "production",
		COMPARE_CONFIRM_PRODUCTION: "read-only",
	};
	const settings = readSettings(production, (account) => {
		asked.push(account);
		return stored(account);
	});
	assert.deepEqual(asked, ["production-client-id", "production-client-secret"]);
	assert.deepEqual(settings.token, {
		id: "made-up-production-client-id",
		secret: "made-up-production-client-secret",
	});
});

test("a missing or unusable keychain value names the item, never the value", () => {
	for (const value of [
		undefined,
		"",
		"secret marker",
		"secretmarker\n",
		"secretmarker\r\nx-other: 1",
		"secretmarker\x00",
		"secretmarker\x7f",
		"sécretmarker",
	])
		for (const item of ["client-id", "client-secret"])
			assert.throws(
				() =>
					readSettings(staging, (account) =>
						account === `staging-${item}` ? value : "made-up",
					),
				(error: Error) =>
					error.message.includes(
						`service doctorcre-compare-access, account staging-${item}`,
					) && !error.message.includes("secretmarker"),
			);
});
