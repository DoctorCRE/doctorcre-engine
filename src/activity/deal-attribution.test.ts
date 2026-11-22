import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { withPartnerAuth } from "../partner-auth.ts";
import { copyTest, readSchema } from "../test-copy.ts";
import { partnerApp } from "../worker.ts";

const { db, setup, cleanup, connectionString } = copyTest();
const appOrigin = "https://app.example.test";
const secret = randomBytes(32).toString("hex");
const reader = new URL(connectionString);
reader.username = `attribution_${randomUUID().replaceAll("-", "")}`;
const viewer = randomUUID();
const otherPartner = randomUUID();
const firstDeal = { id: randomUUID(), name: "Example first deal" };
const secondDeal = { id: randomUUID(), name: "Example second deal" };
const credited = randomUUID();
const ambiguous = randomUUID();
const otherActivity = randomUUID();
let cookie: string;

before(async () => {
	await setup();
	await db.query(await readSchema("partner-auth.sql"));
	await db.query(`
		create role ${reader.username} login in role engine_reader;
		begin;
		select set_config('engine.user_id', '${viewer}', true);
		insert into party (id, kind, name) values
			('${viewer}', 'person', 'Example Viewer'),
			('${otherPartner}', 'person', 'Example Owner');
		insert into app_user (id, slug) values
			('${viewer}', 'joe'), ('${otherPartner}', 'dell');
		insert into deal (id, name, owner_user_id) values
			('${firstDeal.id}', '${firstDeal.name}', '${otherPartner}'),
			('${secondDeal.id}', '${secondDeal.name}', '${viewer}');
		insert into activity (id, kind, happened_at) values
			('${credited}', 'call', '2026-01-01'),
			('${ambiguous}', 'meeting', '2026-01-02'),
			('${otherActivity}', 'note', '2026-01-03');
		insert into activity_about (activity_id, deal_id) values
			('${credited}', '${firstDeal.id}'),
			('${ambiguous}', '${firstDeal.id}'),
			('${ambiguous}', '${secondDeal.id}');
		insert into activity_about (activity_id, party_id) values
			('${credited}', '${otherPartner}'),
			('${otherActivity}', '${otherPartner}');
		commit;
		insert into doctorcre_auth."user"
			(id, partner_user_id, name, email, "emailVerified", "createdAt", "updatedAt")
			values ('fixture', '${viewer}', 'Example Viewer', 'viewer@example.test', true, now(), now());
		insert into doctorcre_auth.account (id, "userId", "providerId", "accountId", "createdAt", "updatedAt")
			values ('fixture', 'fixture', 'google', 'fixture', now(), now());
	`);
	const { token } = await withPartnerAuth(
		{ appOrigin, connectionString, secret },
		async ({ auth }) =>
			(await auth.$context).internalAdapter.createSession("fixture"),
	);
	const signature = createHmac("sha256", secret).update(token).digest("base64");
	cookie = `__Host-doctorcre_session=${encodeURIComponent(`${token}.${signature}`)}`;
});
after(cleanup);

function get(id: string, signedIn = true) {
	return partnerApp.request(
		`${appOrigin}/api/engine/activities/${id}/deal-attribution`,
		{ headers: signedIn ? { Cookie: cookie } : {} },
		{
			DATABASE: { connectionString: reader.href },
			PARTNER_AUTH_DATABASE: { connectionString },
			PARTNER_APP_ORIGIN: appOrigin,
			PARTNER_AUTH_SECRET: secret,
		},
	);
}

test("one deal is credited even when another partner owns it", async () => {
	const response = await get(credited);
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), {
		kind: "credited",
		deal: firstDeal,
	});
});

test("several deals are candidates and none is credited", async () => {
	const response = await get(ambiguous);
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), {
		kind: "ambiguous",
		candidates: [firstDeal, secondDeal],
	});
});

test("an activity outside deal history is refused like an unknown activity", async () => {
	const [hidden, missing] = await Promise.all([
		get(otherActivity),
		get(randomUUID()),
	]);
	for (const response of [hidden, missing]) {
		assert.equal(response.status, 404);
		assert.partialDeepStrictEqual(await response.json(), {
			error: "not_found",
		});
	}
});

test("an attribution read requires an engine session", async () => {
	assert.equal((await get(credited, false)).status, 401);
});
