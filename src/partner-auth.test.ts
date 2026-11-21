import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { withPartnerAuth } from "./partner-auth.ts";
import { copyTest, readSchema } from "./test-copy.ts";

const appOrigin = "https://app.example.test";
const secret = randomBytes(32).toString("hex");
const issuedAt = new Date("2030-01-01T00:00:00Z");
const expiresAt = new Date("2030-01-31T00:00:00Z");
function identity(id: string, slug: string, display: string) {
	return { id, slug, display, appUserId: randomUUID() };
}
const first = identity("one", "joe", "Example One");
const second = identity("two", "dell", "Example Two");
const other = identity("other", "other", "Example Other");

function sessionHeaders(token: string) {
	const signature = createHmac("sha256", secret).update(token).digest("base64");
	return new Headers({
		cookie: `__Host-doctorcre_session=${encodeURIComponent(`${token}.${signature}`)}`,
	});
}

test("partner sessions in PostgreSQL", async (t) => {
	const { db, setup, cleanup, connectionString } = copyTest();
	const role = `auth_${randomUUID().replaceAll("-", "")}`;
	const url = new URL(connectionString);
	url.username = role;
	const config = { connectionString: url.href, appOrigin, secret };
	const resolve = (headers: Headers, origin = appOrigin) =>
		withPartnerAuth(config, ({ resolveSession }) =>
			resolveSession({ origin, headers }),
		);
	const issue = (id: string, origin = appOrigin) =>
		withPartnerAuth({ ...config, appOrigin: origin }, async ({ auth }) =>
			(await auth.$context).internalAdapter.createSession(id),
		);
	const addIdentity = (id: string, appUserId: string) =>
		db.query(
			`insert into doctorcre_auth."user"
				(id, partner_user_id, name, email, "emailVerified", "createdAt", "updatedAt")
				values ($1, $2, 'Example Auth User', $1 || '@example.test', true, $3, $3)`,
			[id, appUserId, issuedAt],
		);

	await setup();
	try {
		await db.query(await readSchema("partner-auth.sql"));
		await db.query(`create role ${role} login in role engine_partner_auth`);
		for (const { id, appUserId, slug, display } of [first, second, other]) {
			await db.query("begin");
			await db.query("select set_config('engine.user_id', $1, true)", [
				appUserId,
			]);
			await db.query(
				"insert into next.party (id, kind, name) values ($1, 'person', $2)",
				[appUserId, display],
			);
			await db.query("insert into next.app_user (id, slug) values ($1, $2)", [
				appUserId,
				slug,
			]);
			await db.query("commit");
			await addIdentity(id, appUserId);
			await db.query(
				`insert into doctorcre_auth.account
					(id, "userId", "providerId", "accountId", "createdAt", "updatedAt")
					values ($1, $1, 'google', $2, $3, $3)`,
				[id, `subject-${id}`, issuedAt],
			);
		}

		await t.test("resolves both actors and checks origin", async (sub) => {
			sub.mock.timers.enable({ apis: ["Date"], now: issuedAt });
			for (const { id, appUserId, slug, display } of [first, second]) {
				const session = await issue(id);
				const resolved = await resolve(sessionHeaders(session.token));
				assert.ok(resolved?.csrfToken);
				const { csrfToken, ...partner } = resolved;
				assert.deepEqual(partner, {
					id: session.id,
					appUserId,
					actor: { slug, display },
					googleAuthenticatedAt: issuedAt,
					expiresAt,
				});
				assert.equal(
					(await resolve(sessionHeaders(session.token)))?.csrfToken,
					csrfToken,
				);
			}
			const elsewhere = "https://other.example.test";
			const session = await issue(first.id, elsewhere);
			const headers = sessionHeaders(session.token);
			assert.equal(await resolve(headers), null);
			assert.equal(await resolve(headers, elsewhere), null);
		});

		await t.test("refuses unknown and ineligible users", async (sub) => {
			sub.mock.timers.enable({ apis: ["Date"], now: issuedAt });
			await assert.rejects(addIdentity("unknown", randomUUID()), {
				code: "23503",
			});
			assert.equal(await resolve(sessionHeaders("unknown-token")), null);
			const session = await issue(other.id);
			assert.equal(await resolve(sessionHeaders(session.token)), null);
		});
		await t.test("requires unique subjects and partner links", async () => {
			await assert.rejects(
				db.query(
					`update doctorcre_auth.account set "accountId" = 'subject-one' where id = 'two'`,
				),
				{ code: "23505" },
			);
			await assert.rejects(addIdentity("duplicate", first.appUserId), {
				code: "23505",
			});
		});

		await t.test(
			"ordinary use never extends the 30-day lifetime",
			async (sub) => {
				sub.mock.timers.enable({ apis: ["Date"], now: issuedAt });
				const session = await issue(first.id);
				const headers = sessionHeaders(session.token);
				sub.mock.timers.setTime(expiresAt.getTime() - 1);
				assert.deepEqual((await resolve(headers))?.expiresAt, expiresAt);
				sub.mock.timers.setTime(expiresAt.getTime());
				assert.equal(await resolve(headers), null);
				sub.mock.timers.tick(1);
				assert.equal(await resolve(headers), null);
			},
		);

		await t.test(
			"revocation is immediate and limited to the revoked session",
			async (sub) => {
				sub.mock.timers.enable({ apis: ["Date"], now: issuedAt });
				const revoked = await issue(second.id);
				const surviving = await issue(second.id);
				const headers = sessionHeaders(revoked.token);
				assert.ok(await resolve(headers));
				await withPartnerAuth(config, async ({ auth }) => {
					await (await auth.$context).internalAdapter.deleteSession(
						revoked.token,
					);
				});
				assert.equal(await resolve(headers), null);
				assert.ok(await resolve(sessionHeaders(surviving.token)));
			},
		);

		await t.test("limits the runtime login", async () => {
			const runtime = new pg.Client({ connectionString: url.href });
			await runtime.connect();
			try {
				for (const sql of [
					"select * from public.actor",
					"delete from public.actor",
					"select * from next.app_user",
					"update next.app_user set slug = 'other'",
					"select * from next.party",
					"delete from doctorcre_auth.account",
					'update doctorcre_auth."user" set partner_user_id = gen_random_uuid()',
					"update doctorcre_auth.session set token = 'replacement'",
					"create table doctorcre_auth.unexpected (id text)",
				]) {
					await assert.rejects(runtime.query(sql), { code: "42501" });
				}
			} finally {
				await runtime.end();
			}
			await db.query("set role engine_reader");
			try {
				const select = db.query("select * from doctorcre_auth.session");
				await assert.rejects(select, { code: "42501" });
			} finally {
				await db.query("reset role");
			}
		});
	} finally {
		await db.query(`drop role if exists ${role}`);
		await cleanup();
	}
});
