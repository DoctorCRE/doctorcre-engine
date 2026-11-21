import { Hono } from "hono";
import { SESSION_COOKIE, withPartnerAuth } from "./partner-auth.ts";

type Bindings = {
	PARTNER_APP_ORIGIN?: string;
	PARTNER_AUTH_DATABASE?: { connectionString: string };
	PARTNER_AUTH_SECRET?: string;
	PARTNER_GOOGLE_CLIENT_ID?: string;
	PARTNER_GOOGLE_CLIENT_SECRET?: string;
};

function returnURL(url: URL, appOrigin: string) {
	const path = url.searchParams.get("return_to");
	if (
		!path?.startsWith("/") ||
		path.startsWith("//") ||
		/[\\\p{Cc}]/u.test(path)
	) {
		return `${appOrigin}/`;
	}
	const target = new URL(path, appOrigin);
	return target.origin === appOrigin ? target.href : `${appOrigin}/`;
}

function refusal(status: 401 | 404 | 503, headers: Headers) {
	const errors = {
		401: "sign_in_required",
		404: "not_found",
		503: "sign_in_unavailable",
	};
	return Response.json({ error: errors[status] }, { status, headers });
}

async function googleSignIn(
	request: Request,
	env: Bindings,
	step: "start" | "callback",
) {
	const {
		PARTNER_APP_ORIGIN: appOrigin,
		PARTNER_AUTH_DATABASE: database,
		PARTNER_AUTH_SECRET: secret,
		PARTNER_GOOGLE_CLIENT_ID: clientId,
		PARTNER_GOOGLE_CLIENT_SECRET: clientSecret,
	} = env;
	const headers = new Headers({ "Cache-Control": "no-store" });
	if (request.method !== "GET") {
		headers.set("Allow", "GET");
		return new Response(null, { status: 405, headers });
	}
	const url = new URL(request.url);
	if (
		!appOrigin ||
		!database ||
		!secret ||
		!clientId?.trim() ||
		!clientSecret?.trim()
	) {
		return refusal(503, headers);
	}
	if (url.origin !== appOrigin) return refusal(404, headers);

	try {
		return await withPartnerAuth(
			{
				connectionString: database.connectionString,
				appOrigin,
				secret,
				google: { clientId, clientSecret },
			},
			async ({ auth }) => {
				if (step === "start") {
					const result = await auth.api.signInSocial({
						body: {
							provider: "google",
							callbackURL: returnURL(url, appOrigin),
						},
						headers: new Headers({ origin: appOrigin }),
						returnHeaders: true,
					});
					for (const cookie of result.headers.getSetCookie())
						headers.append("Set-Cookie", cookie);
					if (!result.response.url) return refusal(503, headers);
					headers.set("Location", result.response.url);
					return new Response(null, { status: 302, headers });
				}

				const response = await auth.handler(request);
				const cookies = response.headers.getSetCookie();
				for (const cookie of cookies) headers.append("Set-Cookie", cookie);
				const location = response.headers.get("Location");
				if (response.status >= 500) return refusal(503, headers);
				if (
					!location ||
					!cookies.some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))
				) {
					const error = location
						? new URL(location, appOrigin).searchParams.get("error")
						: null;
					return refusal(
						error === "internal_server_error" ? 503 : 401,
						headers,
					);
				}
				headers.set("Location", location);
				return new Response(null, { status: 302, headers });
			},
		);
	} catch {
		return refusal(503, headers);
	}
}

export const partnerGoogle = new Hono<{ Bindings: Bindings }>()
	.get("/auth/login", (c) => googleSignIn(c.req.raw, c.env, "start"))
	.get("/auth/callback/google", (c) =>
		googleSignIn(c.req.raw, c.env, "callback"),
	);
