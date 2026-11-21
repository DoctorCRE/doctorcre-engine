import { timingSafeEqual } from "node:crypto";
import { createMiddleware } from "hono/factory";
import { failureKind } from "./failure.ts";

const SESSION_COOKIE = "__Host-dealroom_session";
type Partner = { slug: string; display: string };
type Session = { actor: Partner; csrf_token: string };
export type SessionEnv = {
	Bindings: { CARR: { fetch(request: Request): Promise<Response> } };
	Variables: { partner: Partner };
};

// The old system's bodies: its browser sign-in refusal, and its Worker's
// answer when its session store threw.
export const sessionRefusals = {
	401: () => ({ error: "unauthorized", state: "sign_in_required" }),
	403: () => ({ error: "forbidden" }),
	503: () => ({ error: "internal_error", correlation_id: crypto.randomUUID() }),
};

const nonBlank = (value: unknown): value is string =>
	typeof value === "string" && value.trim() !== "";

function parseSession(value: unknown): Session {
	if (
		typeof value !== "object" ||
		value === null ||
		!("actor" in value) ||
		typeof value.actor !== "object" ||
		value.actor === null ||
		!("slug" in value.actor) ||
		!nonBlank(value.actor.slug) ||
		!("display" in value.actor) ||
		!nonBlank(value.actor.display) ||
		!("csrf_token" in value) ||
		!nonBlank(value.csrf_token)
	)
		throw new Error("Invalid session response");
	return {
		actor: { slug: value.actor.slug, display: value.actor.display },
		csrf_token: value.csrf_token,
	};
}

async function equalTokens(
	expected: string,
	received: string,
): Promise<boolean> {
	const encoder = new TextEncoder();
	const [left, right] = await Promise.all([
		crypto.subtle.digest("SHA-256", encoder.encode(expected)),
		crypto.subtle.digest("SHA-256", encoder.encode(received)),
	]);
	return timingSafeEqual(new Uint8Array(left), new Uint8Array(right));
}

export async function hasWriteProof(
	request: Request,
	origin: string,
	csrfToken: string,
): Promise<boolean> {
	if (request.method === "GET" || request.method === "HEAD") return true;
	const token = request.headers.get("x-carr-csrf");
	return (
		request.headers.get("Origin") === origin &&
		request.headers.get("Sec-Fetch-Site") === "same-origin" &&
		Boolean(token && (await equalTokens(csrfToken, token)))
	);
}

export const requireSession = createMiddleware<SessionEnv>(async (c, next) => {
	// Set before anything can throw, so an error answer is not cached either.
	c.header("Cache-Control", "no-store");
	let renewed: string[] = [];
	const protect = () => {
		c.header("Cache-Control", "no-store");
		for (const value of renewed)
			c.header("Set-Cookie", value, { append: true });
	};
	const refuse = (status: keyof typeof sessionRefusals) => {
		protect();
		return c.json(sessionRefusals[status](), status);
	};
	const unavailable = (kind: string) => {
		console.warn("sign-in check unavailable:", kind);
		return refuse(503);
	};
	const cookie = c.req
		.header("Cookie")
		?.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${SESSION_COOKIE}=`));
	if (!cookie || cookie === `${SESSION_COOKIE}=`) return refuse(401);

	const url = new URL(c.req.url);
	const browserOrigin = url.origin;
	url.pathname = "/auth/session";
	url.search = "";
	const headers = new Headers({ Cookie: cookie, Host: url.host });
	const origin = c.req.header("Origin");
	if (origin !== undefined) headers.set("Origin", origin);
	let response: Response;
	try {
		response = await c.env.CARR.fetch(
			new Request(url, {
				method: "GET",
				headers,
				redirect: "manual",
				signal: AbortSignal.timeout(3000),
			}),
		);
		renewed = response.headers.getSetCookie();
	} catch (error) {
		return unavailable(failureKind(error));
	}
	if (response.status === 401) return refuse(401);
	if (response.status !== 200) return unavailable(`status ${response.status}`);
	let session: Session;
	try {
		session = parseSession(await response.json());
	} catch (error) {
		return unavailable(
			error instanceof Error && error.name === "TimeoutError"
				? "TimeoutError"
				: "malformed",
		);
	}

	if (!(await hasWriteProof(c.req.raw, browserOrigin, session.csrf_token)))
		return refuse(403);
	c.set("partner", session.actor);
	await next();
	protect();
});
