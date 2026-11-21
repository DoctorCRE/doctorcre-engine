import { betterAuth } from "better-auth";
import { PostgresDialect } from "kysely";
import pg from "pg";

const SESSION_SECONDS = 30 * 24 * 60 * 60;
const SESSION_COOKIE = "__Host-doctorcre_session";

type PartnerAuthConfig = {
	connectionString: string;
	appOrigin: string;
	secret: string;
};

function partnerAuth(pool: pg.Pool, { appOrigin, secret }: PartnerAuthConfig) {
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
		emailAndPassword: { enabled: false, disableSignUp: true },
		user: {
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
			cookies: { session_token: { name: SESSION_COOKIE } },
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
					before: async (session) => ({
						data: {
							origin: appOrigin,
							csrfToken: crypto.randomUUID(),
							googleAuthenticatedAt: session.createdAt,
						},
					}),
				},
			},
		},
	});
}

type Partner = { app_user_id: string; slug: string; display: string };
type PartnerAuth = ReturnType<typeof partnerAuth>;
type SessionRequest = { origin: string; headers: Headers };

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

	const { rows } = await pool.query<Partner>(
		"select app_user_id, slug, display from doctorcre_auth.partner where auth_user_id = $1",
		[session.userId],
	);
	const partner = rows[0];
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
	}) => Promise<T>,
): Promise<T> {
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
		const auth = partnerAuth(pool, config);
		return await run({
			auth,
			resolveSession: async (input) => {
				try {
					return await resolveSession(auth, pool, config.appOrigin, input);
				} catch {
					throw new Error("Partner session store unavailable");
				}
			},
		});
	} finally {
		await pool.end();
	}
}
