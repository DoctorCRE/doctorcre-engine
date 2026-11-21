import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { SESSION_COOKIE, withPartnerAuth } from "./partner-auth.ts";
import { hasWriteProof, sessionRefusals } from "./session.ts";

const FRESHNESS_MS = 10 * 60 * 1000;

export type PartnerSessionEnv = {
	Bindings: {
		PARTNER_APP_ORIGIN?: string;
		PARTNER_AUTH_DATABASE?: { connectionString: string };
		PARTNER_AUTH_SECRET?: string;
	};
	Variables: {
		partner: PartnerSession["actor"];
		partnerSession: PartnerSession;
	};
};

function sessionConfig(env: PartnerSessionEnv["Bindings"]) {
	const appOrigin = env.PARTNER_APP_ORIGIN;
	const connectionString = env.PARTNER_AUTH_DATABASE?.connectionString;
	const secret = env.PARTNER_AUTH_SECRET;
	if (!appOrigin || !connectionString || !secret)
		throw new Error("Partner session configuration unavailable");
	return { appOrigin, connectionString, secret };
}

async function resolveAppSession(
	request: { origin: string; headers: Headers },
	env: PartnerSessionEnv["Bindings"],
) {
	return withPartnerAuth(sessionConfig(env), ({ resolveSession }) =>
		resolveSession(request),
	);
}

type PartnerSession = NonNullable<
	Awaited<ReturnType<typeof resolveAppSession>>
>;

export const requirePartnerSession = createMiddleware<PartnerSessionEnv>(
	async (c, next) => {
		c.header("Cache-Control", "no-store");
		const origin = new URL(c.req.url).origin;
		let session: PartnerSession | null;
		try {
			session = await resolveAppSession(
				{ origin, headers: c.req.raw.headers },
				c.env,
			);
		} catch {
			console.warn("Partner session check unavailable");
			return c.json(sessionRefusals[503](), 503);
		}
		if (!session) return c.json(sessionRefusals[401](), 401);
		if (!(await hasWriteProof(c.req.raw, origin, session.csrfToken)))
			return c.json(sessionRefusals[403](), 403);
		c.set("partner", session.actor);
		c.set("partnerSession", session);
		await next();
		c.header("Cache-Control", "no-store");
	},
);

export function partnerSessionStatus(c: Context<PartnerSessionEnv>) {
	const { actor, csrfToken, googleAuthenticatedAt } = c.get("partnerSession");
	return c.json({
		actor,
		csrf_token: csrfToken,
		reauth_required:
			Date.now() - googleAuthenticatedAt.getTime() >= FRESHNESS_MS,
		reauth_url: "/auth/reauth?return_to=/",
	});
}

export async function partnerSignOut(c: Context<PartnerSessionEnv>) {
	try {
		await withPartnerAuth(sessionConfig(c.env), ({ revokeSession }) =>
			revokeSession(c.get("partnerSession").id),
		);
	} catch {
		return c.json(sessionRefusals[503](), 503);
	}
	c.header(
		"Set-Cookie",
		`${SESSION_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`,
	);
	return c.redirect("/", 303);
}
