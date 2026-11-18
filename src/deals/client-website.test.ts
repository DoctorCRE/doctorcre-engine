import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { sortedHash } from "../save.ts";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, request, save } = doorTest();
const [alex, blair, client] = [randomUUID(), randomUUID(), randomUUID()];
const [setupDeal, retryDeal, otherDeal, raceDeal, unlinkedDeal] = [
	randomUUID(),
	randomUUID(),
	randomUUID(),
	randomUUID(),
	randomUUID(),
];
const partner = { user: "blair" };
const path = (deal: string) => `deals/${deal}/client-website`;
const args = (slug: string, password = "made-up password") => ({
	idempotency_key: randomUUID(),
	slug,
	password,
});

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${alex}', 'person', 'Alex Example'), ('${blair}', 'person', 'Blair Example');
		insert into app_user (id, slug) values ('${alex}', 'alex'), ('${blair}', 'blair');
		insert into how_found values ('referral', 'Referral');
		insert into role values ('client', 'Client');
		insert into party (id, kind, name, how_found) values ('${client}', 'company', 'Example Clinic', 'referral');
		insert into party_role (party_id, role) values ('${client}', 'client');
		insert into deal (id, name, owner_user_id) select d, 'Example deal', '${alex}'
			from unnest(array['${setupDeal}', '${retryDeal}', '${otherDeal}', '${raceDeal}', '${unlinkedDeal}']::uuid[]) d;
		insert into deal_party (deal_id, party_id, role)
			select id, '${client}', 'client' from deal where id <> '${unlinkedDeal}';
		commit;`);
});
after(cleanup);

test("either partner can register a website with the old verifier format and repeat a save", async () => {
	const input = args("example-new-site");
	const answer = {
		ok: true,
		deal_id: setupDeal,
		client_portal_url: "https://share.doctorcre.com/example-new-site",
		created: true,
	};
	assert.deepEqual(await save(partner, path(setupDeal), input), [200, answer]);
	assert.deepEqual(await save(partner, path(setupDeal), input), [
		200,
		{ ...answer, replayed: true },
	]);
	assert.deepEqual(
		await save(
			{ user: "alex" },
			path(setupDeal),
			args(input.slug, input.password),
		),
		[200, { ...answer, created: false }],
	);

	const result = await db.query(
		`select changed_by_user_id, client_party_id,
		password_hash = public.crypt(encode(public.digest($1::text, 'sha256'), 'hex'), password_hash) as verified
		from deal_client_website where slug = $2`,
		[input.password, input.slug],
	);
	assert.deepEqual(result.rows, [
		{ changed_by_user_id: blair, client_party_id: client, verified: true },
	]);

	const history = await db.query(
		`select new_value ? 'password_hash' as exposed from change
		where table_name = 'deal_client_website' and record ->> 'slug' = $1`,
		[input.slug],
	);
	assert.deepEqual(history.rows, [{ exposed: false }]);

	const receipt = await db.query(
		"select request_hash, answer from save_receipt where idempotency_key = $1",
		[input.idempotency_key],
	);
	assert.deepEqual(receipt.rows, [
		{
			request_hash: sortedHash({
				verb: "register-client-portal",
				stamp: partner,
				args: { deal_id: setupDeal, slug: input.slug },
			}),
			answer,
		},
	]);
});

test("setup refuses a different password or website name and reserves the slug across deals", async () => {
	const prefix = "a".repeat(90);
	const original = args("example-fixed-site", `${prefix}1`);
	assert.equal((await save(partner, path(retryDeal), original))[0], 200);
	for (const [deal, input, error] of [
		[retryDeal, args(original.slug, `${prefix}2`), "portal_password_differs"],
		[
			retryDeal,
			args("different-example-name"),
			"portal_deal_already_registered",
		],
		[otherDeal, args(original.slug), "portal_slug_taken"],
	] as const) {
		const [status, answer] = await save(partner, path(deal), input);
		assert.equal(status, 409);
		assert.equal(answer.error, error);
	}
});

test("concurrent setup for one deal creates just one registration", async () => {
	const results = await Promise.all([
		save(partner, path(raceDeal), args("example-race-one")),
		save(partner, path(raceDeal), args("example-race-two")),
	]);
	assert.deepEqual(results.map(([status]) => status).toSorted(), [200, 409]);
	assert.equal(
		results.find(([status]) => status === 409)?.[1].error,
		"portal_deal_already_registered",
	);
});

test("setup requires a current client, valid input and the partner's CSRF token", async () => {
	const missing = await save(
		partner,
		path(unlinkedDeal),
		args("example-unlinked"),
	);
	assert.equal(missing[0], 404);
	assert.equal(missing[1].error, "portal_deal_not_found");
	const invalid = await save(partner, path(raceDeal), args("Bad Name", ""));
	assert.equal(invalid[0], 400);
	assert.deepEqual(invalid[1].fields, ["slug", "password"]);
	const nul = await save(
		partner,
		path(raceDeal),
		args("example-nul", "invalid\u0000password"),
	);
	assert.equal(nul[0], 400);
	assert.deepEqual(nul[1].fields, ["password"]);

	const unauthorised = await request(partner, path(raceDeal), {
		method: "POST",
		headers: { "x-carr-csrf": "wrong" },
		body: JSON.stringify(args("example-unauthorised")),
	});
	assert.equal(unauthorised.status, 403);
	assert.equal(
		(
			await save(
				{ job: "agent", for_user: "blair" },
				path(raceDeal),
				args("example-job"),
			)
		)[0],
		404,
	);
});

test("disabled and former-client websites keep their names reserved", async () => {
	const [disabled, changed, formerClient] = [
		randomUUID(),
		randomUUID(),
		randomUUID(),
	];
	const gone = args("example-disabled");
	const former = args("example-former-client");
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name, how_found)
		values ('${formerClient}', 'company', 'Former Example Clinic', 'referral');
		insert into party_role (party_id, role) values ('${formerClient}', 'client');
		insert into deal (id, name, owner_user_id)
		values ('${disabled}', 'Example disabled website deal', '${alex}'),
		       ('${changed}', 'Example client change deal', '${alex}');
		insert into deal_party (deal_id, party_id, role)
		values ('${disabled}', '${client}', 'client'), ('${changed}', '${client}', 'client');
		insert into deal_client_website (slug, deal_id, client_party_id, password_hash, disabled_at)
		select slug, deal_id::uuid, party_id::uuid,
			public.crypt(encode(public.digest('made-up password', 'sha256'), 'hex'), public.gen_salt('bf', 12)),
			case when disabled then clock_timestamp() end
		from (values ('${gone.slug}', '${disabled}', '${client}', true),
		             ('${former.slug}', '${changed}', '${formerClient}', false)) registrations(slug, deal_id, party_id, disabled);
		commit;`);
	for (const [deal, input] of [
		[disabled, gone],
		[changed, former],
	] as const) {
		const [status, answer] = await save(partner, path(deal), input);
		assert.equal(status, 409);
		assert.equal(answer.error, "portal_slug_taken");
	}
	assert.deepEqual(
		await save(partner, path(disabled), args("example-replacement")),
		[
			200,
			{
				ok: true,
				deal_id: disabled,
				client_portal_url: "https://share.doctorcre.com/example-replacement",
				created: true,
			},
		],
	);
});
