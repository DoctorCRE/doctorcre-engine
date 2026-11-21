import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import {
	addOAuthServerContext,
	createAuthMiddleware,
	getOAuthState,
} from "better-auth/api";
import { PostgresDialect } from "kysely";
import pg from "pg";

const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_COOKIE = "__Host-doctorcre_session";

type PartnerAuthConfig = {
	connectionString: string;
	appOrigin: string;
	secret: string;
	google?: { clientId: string; clientSecret: string };
};

type GoogleFlow = {
	startingSessionId: string | undefined;
	reauth?: { sessionId: string; returnURL: string; authUserId?: string };
};

function partnerAuth(
	pool: pg.Pool,
	{ appOrigin, secret, google }: PartnerAuthConfig,
	flow: GoogleFlow,
) {
	return betterAuth({
		baseURL: appOrigin,
		basePath: "/auth",
		secret,
		database: {
			dialect: new PostgresDialect({ pool }),
			type: "postgres",
			schemaName: "doctorcre_auth",
		},
		logger: { disabled: true },
		hooks: {
			before: createAuthMiddleware(async ({ path }) => {
				if (path === "/sign-in/social" && flow.startingSessionId)
					await addOAuthServerContext({
						sessionId: flow.startingSessionId,
						appOrigin,
					});
			}),
		},
		socialProviders: google
			? {
					google: {
						...google,
						prompt: "select_account",
						accessType: "online",
						includeGrantedScopes: false,
						disableSignUp: true,
					},
				}
			: {},
		emailAndPassword: { enabled: false, disableSignUp: true },
		user: {
			validateUserInfo: async ({ source }) => {
				const profile = source.oauth?.profile;
				// The ID token comes from Google's HTTPS code exchange using PKCE.
				if (
					!google ||
					source.action !== "sign-in" ||
					source.oauth?.providerId !== "google" ||
					profile?.email_verified !== true ||
					(profile.iss !== "https://accounts.google.com" &&
						profile.iss !== "accounts.google.com") ||
					profile.aud !== google.clientId ||
					(profile.azp !== undefined && profile.azp !== google.clientId) ||
					typeof profile.exp !== "number" ||
					profile.exp * 1000 <= Date.now()
				) {
					return { error: "google_identity_required" };
				}
				const state = await getOAuthState();
				if (!state || !(await claimGoogleReturn(pool, state)))
					return { error: "state_already_used" };
				const original = state.serverContext;
				if (original) {
					if (
						typeof original.sessionId !== "string" ||
						original.appOrigin !== appOrigin
					)
						return { error: "state_mismatch" };
					flow.reauth = {
						sessionId: original.sessionId,
						returnURL: state.callbackURL,
					};
				}
			},
			additionalFields: {
				partnerUserId: {
					type: "string",
					fieldName: "partner_user_id",
					input: false,
					returned: false,
				},
			},
		},
		account: {
			accountLinking: { enabled: false, disableImplicitLinking: true },
			storeAccountCookie: false,
			updateAccountOnSignIn: false,
		},
		advanced: {
			// Better Auth otherwise adds __Secure- in front of our __Host- name.
			useSecureCookies: false,
			defaultCookieAttributes: { secure: true },
			cookies: {
				session_token: { name: SESSION_COOKIE },
				state: { name: "__Host-doctorcre_oauth_state" },
			},
			database: { joins: true },
		},
		session: {
			expiresIn: SESSION_SECONDS,
			disableSessionRefresh: true,
			cookieCache: { enabled: false },
			additionalFields: {
				origin: { type: "string", input: false },
				csrfToken: { type: "string", input: false },
				googleAuthenticatedAt: { type: "date", input: false },
			},
		},
		databaseHooks: {
			session: {
				create: {
					before: async (session) => {
						if (!(await findPartner(pool, session.userId))) return false;
						if (flow.reauth) {
							// Reauthentication proves identity without issuing another session.
							flow.reauth.authUserId = session.userId;
							return false;
						}
						return {
							data: {
								origin: appOrigin,
								csrfToken: crypto.randomUUID(),
								googleAuthenticatedAt: session.createdAt,
							},
						};
					},
				},
			},
		},
	});
}

async function claimGoogleReturn(
	pool: pg.Pool,
	{ codeVerifier, expiresAt }: { codeVerifier: string; expiresAt: number },
) {
	// Better Auth checks and deletes state separately, so only one return may issue a session.
	const now = new Date();
	if (now.getTime() >= expiresAt) return false;
	const id = `google-used:${createHash("sha256").update(codeVerifier).digest("hex")}`;
	const { rowCount } = await pool.query(
		`insert into doctorcre_auth.verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
		 values ($1, $1, '', $2, $3, $3)
		 on conflict (id) do nothing`,
		[id, new Date(expiresAt), now],
	);
	return rowCount === 1;
}

type Partner = { app_user_id: string; slug: string; display: string };
type PartnerAuth = ReturnType<typeof partnerAuth>;
type SessionRequest = { origin: string; headers: Headers };

async function refreshSession(
	pool: pg.Pool,
	appOrigin: string,
	{ sessionId, authUserId }: { sessionId: string; authUserId: string },
) {
	const { rowCount } = await pool.query(
		`update doctorcre_auth.session
		 set "googleAuthenticatedAt" = greatest("googleAuthenticatedAt", $4),
		     "updatedAt" = greatest("updatedAt", $4)
		 where id = $1 and "userId" = $2 and origin = $3 and "expiresAt" > $4
		   and exists (select from doctorcre_auth.partner where auth_user_id = $2)`,
		[sessionId, authUserId, appOrigin, new Date()],
	);
	return rowCount === 1;
}

async function findPartner(pool: pg.Pool, authUserId: string) {
	const { rows } = await pool.query<Partner>(
		"select app_user_id, slug, display from doctorcre_auth.partner where auth_user_id = $1",
		[authUserId],
	);
	return rows[0];
}

async function resolveSession(
	auth: PartnerAuth,
	pool: pg.Pool,
	appOrigin: string,
	{ origin, headers }: SessionRequest,
) {
	if (origin !== appOrigin) return null;
	const result = await auth.api.getSession({ headers });
	const session = result?.session;
	if (!session || session.origin !== origin || session.expiresAt <= new Date())
		return null;

	const partner = await findPartner(pool, session.userId);
	if (!partner) return null;

	return {
		id: session.id,
		appUserId: partner.app_user_id,
		actor: { slug: partner.slug, display: partner.display },
		csrfToken: session.csrfToken,
		googleAuthenticatedAt: session.googleAuthenticatedAt,
		expiresAt: session.expiresAt,
	};
}

export async function withPartnerAuth<T>(
	config: PartnerAuthConfig,
	run: (request: {
		auth: PartnerAuth;
		resolveSession: (
			input: SessionRequest,
		) => ReturnType<typeof resolveSession>;
		startGoogle: (
			callbackURL: string,
			sessionId?: string,
		) => Promise<{ headers: Headers; response: { url: string | undefined } }>;
		completeGoogle: (
			request: Request,
		) => Promise<{ response: Response; reauthReturn?: string }>;
		revokeSession: (id: string) => Promise<void>;
	}) => Promise<T>,
): Promise<T> {
	const { secret } = config;
	if (
		typeof secret !== "string" ||
		secret.trim().length < 32 ||
		secret === "better-auth-secret-12345678901234567890"
	)
		throw new Error(
			"Partner auth requires a signing secret of at least 32 characters",
		);

	const configured = new URL(config.appOrigin);
	if (
		configured.protocol !== "https:" ||
		configured.origin !== config.appOrigin
	)
		throw new Error("Partner auth requires an HTTPS app origin");

	const pool = new pg.Pool({
		connectionString: config.connectionString,
		max: 1,
	});
	try {
		const flow: GoogleFlow = { startingSessionId: undefined };
		const auth = partnerAuth(pool, config, flow);
		return await run({
			auth,
			resolveSession: async (input) => {
				try {
					return await resolveSession(auth, pool, config.appOrigin, input);
				} catch {
					throw new Error("Partner session store unavailable");
				}
			},
			startGoogle: (callbackURL, sessionId) => {
				flow.startingSessionId = sessionId;
				return auth.api.signInSocial({
					body: { provider: "google", callbackURL },
					headers: new Headers({ origin: config.appOrigin }),
					returnHeaders: true,
				});
			},
			completeGoogle: async (request) => {
				const response = await auth.handler(request);
				const reauth = flow.reauth;
				if (!reauth?.authUserId || response.status >= 500) return { response };
				const { sessionId, authUserId, returnURL } = reauth;
				const current = await resolveSession(auth, pool, config.appOrigin, {
					origin: new URL(request.url).origin,
					headers: request.headers,
				});
				if (
					current?.id === sessionId &&
					(await refreshSession(pool, config.appOrigin, {
						sessionId,
						authUserId,
					}))
				)
					return { response, reauthReturn: returnURL };
				return { response };
			},
			revokeSession: async (id) => {
				await pool.query(
					"delete from doctorcre_auth.session where id = $1 and origin = $2",
					[id, config.appOrigin],
				);
			},
		});
	} finally {
		await pool.end();
	}
}
