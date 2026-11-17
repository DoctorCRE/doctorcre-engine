import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { copyTest } from "./test-copy.ts";
import worker from "./worker.ts";

const TEAM = "https://example.cloudflareaccess.com";
const AUDIENCE = "made-up-jobs-audience";

export type Caller = { user: string } | { job: string; for_user?: string };
type Body = Record<string, unknown>;

// A copy of the new section behind both door entrances: a partner's session or a Studio job's token.
export function doorTest() {
	const copy = copyTest();
	const writer = `door_${randomUUID().replaceAll("-", "")}`;
	const reader = `${writer}_reader`;
	const access = generateKeyPair("RS256", { extractable: true });

	const setup = async () => {
		const { publicKey } = await access;
		const key = { ...(await exportJWK(publicKey)), kid: "made-up-kid" };
		mock.method(globalThis, "fetch", async () =>
			Response.json({ keys: [key] }),
		);
		await copy.setup();
		await copy.db.query(
			`create role ${writer} login; grant engine to ${writer}; create role ${reader} login; grant engine_reader to ${reader}`,
		);
	};
	const cleanup = async () => {
		mock.restoreAll();
		await copy.db.query(
			`drop owned by ${writer}, ${reader}; drop role ${writer}, ${reader}`,
		);
		await copy.cleanup();
	};

	const login = (role = writer) => {
		const url = new URL(copy.connectionString);
		url.username = role;
		return url.href;
	};

	const headers = async (caller: Caller): Promise<Record<string, string>> => {
		if ("user" in caller)
			return {
				Cookie: "__Host-dealroom_session=example",
				Origin: "https://engine.example.test",
				"Sec-Fetch-Site": "same-origin",
				"x-carr-csrf": "example",
			};
		const token = await new SignJWT({})
			.setProtectedHeader({ alg: "RS256", kid: "made-up-kid" })
			.setIssuer(TEAM)
			.setAudience(AUDIENCE)
			.setExpirationTime("5 minutes")
			.sign((await access).privateKey);
		return {
			"Cf-Access-Jwt-Assertion": token,
			"Engine-Job": caller.job,
			...(caller.for_user && { "Engine-For-User": caller.for_user }),
		};
	};

	// A save at `path` under the caller's entrance, answered with its status and body.
	const save = async (
		caller: Caller,
		path: string,
		args: object,
		method = "POST",
	): Promise<[number, Body]> => {
		const user = "user" in caller ? caller.user : undefined;
		const response = await worker.request(
			`https://engine.example.test/${user ? "api/engine" : "jobs"}/${path}`,
			{
				method,
				headers: await headers(caller),
				...(method === "POST" && { body: JSON.stringify(args) }),
			},
			{
				DATABASE_WRITER: { connectionString: login() },
				DATABASE: { connectionString: login(reader) },
				ACCESS_TEAM_DOMAIN: TEAM,
				JOBS_ACCESS_AUD: AUDIENCE,
				CARR: {
					fetch: async () =>
						Response.json({
							actor: { slug: user, display: user },
							csrf_token: "example",
						}),
				},
			},
		);
		return [response.status, await response.json()];
	};

	return { db: copy.db, setup, cleanup, save };
}
