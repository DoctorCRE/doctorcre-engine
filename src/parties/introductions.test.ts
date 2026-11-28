import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const joe = { user: "joe" };
const key = () => ({ idempotency_key: randomUUID() });
const joeId = randomUUID();
const dellId = randomUUID();
const vendor = randomUUID();
const avery = randomUUID();
const notVendor = randomUUID();
const deal = randomUUID();
const freshDeal = randomUUID();

before(async () => {
	await setup();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into party (id, kind, name) values
			('${joeId}', 'person', 'Example Partner One'), ('${dellId}', 'person', 'Example Partner Two'),
			('${vendor}', 'company', 'Example Lending'),
			('${avery}', 'person', 'Avery Example'), ('${notVendor}', 'person', 'Blake Example');
		insert into app_user (id, slug) values ('${joeId}', 'joe'), ('${dellId}', 'dell');
		insert into role (slug, label) values ('vendor', 'Vendor'), ('client', 'Client') on conflict do nothing;
		insert into how_found values ('referral', 'Referral') on conflict do nothing;
		update party set how_found = 'referral' where id = '${avery}';
		insert into party_role (party_id, role) values ('${vendor}', 'vendor'), ('${avery}', 'client');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Deal', '${joeId}'), ('${freshDeal}', 'Example Fresh Deal', '${dellId}');
		insert into deal_party (deal_id, party_id, role) values ('${deal}', '${avery}', 'client'), ('${deal}', '${vendor}', 'vendor');
		commit;`);
});
after(cleanup);

const introduce = (fields: object) =>
	save(joe, "introductions", {
		...key(),
		vendor_id: vendor,
		made_by: "vendor",
		introduced_party_id: avery,
		introduced_on: "2026-01-05",
		note: "Example referral",
		...fields,
	});

test("an introduction the team made names the signed-in partner, and one the vendor made names none", async () => {
	const args = {
		...key(),
		vendor_id: vendor,
		made_by: "team",
		introduced_party_id: avery,
		introduced_on: "2026-01-05",
		note: " Met over an example lunch ",
		deal_id: deal,
	};
	const [status, added] = await save(joe, "introductions", args);
	assert.equal(status, 201, JSON.stringify(added));
	assert.match(String(added.version), /^\d+$/);
	assert.deepEqual(added, {
		version: added.version,
		introduction_id: added.introduction_id,
		vendor_id: vendor,
		made_by: "team",
		introduced_by: "joe",
		introduced_party_id: avery,
		introduced_on: "2026-01-05",
		deal_id: deal,
		note: "Met over an example lunch",
	});
	assert.deepEqual(await save(joe, "introductions", args), [
		201,
		{ ...added, replayed: true },
	]);
	const [, referral] = await introduce({});
	assert.partialDeepStrictEqual(referral, {
		made_by: "vendor",
		introduced_by: null,
		deal_id: null,
	});
	const { rows } = await db.query(
		`select c.action, u.slug from change c join app_user u on u.id = c.changed_by_user_id
		where c.table_name = 'introduction' and c.record ->> 'id' = $1`,
		[added.introduction_id],
	);
	assert.deepEqual(rows, [{ action: "insert", slug: "joe" }]);
});

test("an introduction is with a vendor, of someone else, about a deal that exists, with a note", async () => {
	for (const [fields, status, rule] of [
		[{ vendor_id: notVendor }, 422, "introduction_vendor_id_vendor_role_fkey"],
		[{ introduced_party_id: vendor.toUpperCase() }, 400],
		[{ vendor_id: randomUUID() }, 404],
		[{ introduced_party_id: randomUUID() }, 404],
		[{ deal_id: randomUUID() }, 404],
		[{ note: "   " }, 400],
		[{ introduced_by: "dell" }, 400],
		[{ made_by: "team", introduced_by: "avery" }, 400],
		[{ introduced_on: undefined }, 400],
		[{ made_by: "requested" }, 400],
	] as const) {
		const [actual, refusal] = await introduce(fields);
		assert.equal(actual, status, JSON.stringify(fields));
		if (rule) assert.equal(refusal.rule, rule);
	}
});

test("a partner records the other partner's introduction, with no note", async () => {
	const [status, added] = await introduce({
		made_by: "team",
		introduced_by: "dell",
		note: undefined,
		deal_id: deal,
	});
	assert.equal(status, 201, JSON.stringify(added));
	assert.partialDeepStrictEqual(added, {
		made_by: "team",
		introduced_by: "dell",
		note: null,
	});
	const { rows } = await db.query(
		`select u.slug from change c join app_user u on u.id = c.changed_by_user_id
		where c.table_name = 'introduction' and c.record ->> 'id' = $1`,
		[added.introduction_id],
	);
	assert.deepEqual(rows, [{ slug: "joe" }]);
});

test("an introduction's date, deal and note change from what the partner saw", async () => {
	const [, added] = await introduce({});
	const edit = (fields: object) =>
		save(joe, `introductions/${added.introduction_id}`, {
			...key(),
			...fields,
		});
	const [status, edited] = await edit({
		deal_id: { from: null, to: deal },
		introduced_on: { from: "2026-01-05", to: "2026-01-07" },
		note: { from: "Example referral", to: " Became a client " },
	});
	assert.equal(status, 200, JSON.stringify(edited));
	assert.partialDeepStrictEqual(edited, {
		deal_id: deal,
		introduced_on: "2026-01-07",
		note: "Became a client",
	});
	const [stale, conflict] = await edit({
		note: { from: "Example referral", to: "Other" },
	});
	assert.equal(stale, 409);
	assert.partialDeepStrictEqual(conflict, {
		error: "version_conflict",
		fields: ["note"],
	});
	assert.equal(
		(await edit({ deal_id: { from: deal, to: randomUUID() } }))[0],
		404,
	);
	const [cleared, unlinked] = await edit({ deal_id: { from: deal, to: null } });
	assert.equal(cleared, 200);
	assert.equal(unlinked.deal_id, null);
	for (const fields of [
		{ vendor_id: { from: vendor, to: avery } },
		{ note: { from: "Became a client", to: " " } },
		{ note: { from: "Became a client", to: null } },
		{ introduced_on: { from: "2026-01-07", to: null } },
		{},
	])
		assert.equal((await edit(fields))[0], 400, JSON.stringify(fields));
	const missing = await save(joe, `introductions/${randomUUID()}`, {
		...key(),
		note: { from: null, to: "Example" },
	});
	assert.equal(missing[0], 404);
	const { rows } = await db.query(
		`select count(*)::int as edits from change where table_name = 'introduction' and action = 'update' and record ->> 'id' = $1`,
		[added.introduction_id],
	);
	assert.deepEqual(rows, [{ edits: 2 }]);
});

test("a client-made introduction names the actual client on its deal", async () => {
	const clientFields = { made_by: "client", introduced_party_id: avery };
	assert.equal((await introduce(clientFields))[0], 400);
	const [wrongStatus, wrong] = await introduce({
		...clientFields,
		introduced_party_id: notVendor,
		deal_id: deal,
	});
	assert.equal(wrongStatus, 422);
	assert.equal(wrong.rule, "introduction_maker_is_deal_client");
	const [status, added] = await introduce({ ...clientFields, deal_id: deal });
	assert.equal(status, 201, JSON.stringify(added));
	assert.partialDeepStrictEqual(added, {
		made_by: "client",
		introduced_by: null,
		deal_id: deal,
	});
	const unlinked = await save(joe, `introductions/${added.introduction_id}`, {
		...key(),
		deal_id: { from: deal, to: null },
	});
	assert.equal(unlinked[0], 422);
});

test("setting the source twice keeps the recorded introduction", async () => {
	const fields = { made_by: "team", deal_id: freshDeal, unrecorded_only: true };
	const [first, second] = await Promise.all([
		introduce({ ...fields, introduced_by: "dell" }),
		introduce({ ...fields, introduced_by: "joe" }),
	]);
	assert.deepEqual([first[0], second[0]].sort(), [201, 409]);
	const { rows } = await db.query(
		"select id from introduction where deal_id = $1",
		[freshDeal],
	);
	assert.equal(rows.length, 1);
});

test("removing an introduction is replayable and keeps deal participation", async () => {
	const [, added] = await introduce({ deal_id: deal });
	const args = { ...key(), version: added.version };
	const path = `introductions/${added.introduction_id}/remove`;
	assert.deepEqual(await save(joe, path, args), [
		200,
		{ introduction_id: added.introduction_id },
	]);
	assert.deepEqual(await save(joe, path, args), [
		200,
		{ introduction_id: added.introduction_id, replayed: true },
	]);
	assert.equal(
		(await save(joe, path, { ...key(), version: added.version }))[0],
		404,
	);
	const { rows } = await db.query(
		`select exists (select from deal_party where deal_id = $1 and party_id = $2) as on_deal,
			exists (select from change where table_name = 'introduction' and action = 'delete' and record ->> 'id' = $3) as in_history`,
		[deal, vendor, added.introduction_id],
	);
	assert.deepEqual(rows, [{ on_deal: true, in_history: true }]);
});

test("a changed choice replaces only the named introduction, in the same save", async () => {
	const replacementDeal = randomUUID();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into deal (id, name, owner_user_id) values ('${replacementDeal}', 'Example Replacement Deal', '${joeId}');
		commit;`);
	const fields = {
		made_by: "team",
		deal_id: replacementDeal,
		unrecorded_only: true,
	};
	const [, original] = await introduce({ ...fields, introduced_by: "joe" });
	const conflict = await introduce({
		...fields,
		replaces: randomUUID(),
		replace_version: original.version,
		introduced_by: "dell",
	});
	assert.equal(conflict[0], 409);
	const refused = await introduce({
		...fields,
		replaces: original.introduction_id,
		replace_version: original.version,
		made_by: "client",
	});
	assert.equal(refused[0], 422);
	const [status, replaced] = await introduce({
		...fields,
		replaces: original.introduction_id,
		replace_version: original.version,
		introduced_by: "dell",
	});
	assert.equal(status, 201);
	const { rows } = await db.query(
		"select id from introduction where deal_id = $1",
		[replacementDeal],
	);
	assert.deepEqual(rows, [{ id: replaced.introduction_id }]);
});

test("a stale removal leaves an introduction that moved to another deal", async () => {
	const [, added] = await introduce({ deal_id: deal });
	const path = `introductions/${added.introduction_id}`;
	const [moved] = await save(joe, path, {
		...key(),
		deal_id: { from: deal, to: freshDeal },
	});
	assert.equal(moved, 200);
	const [status, refused] = await save(joe, `${path}/remove`, {
		...key(),
		version: added.version,
	});
	assert.equal(status, 409);
	assert.equal(refused.error, "version_conflict");
	const { rows } = await db.query(
		"select deal_id from introduction where id = $1",
		[added.introduction_id],
	);
	assert.deepEqual(rows, [{ deal_id: freshDeal }]);
});

test("a replacement using an earlier receipt preserves the newer note", async () => {
	const replacementDeal = randomUUID();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into deal (id, name, owner_user_id) values ('${replacementDeal}', 'Example Revised Introduction', '${joeId}');
		commit;`);
	const fields = {
		made_by: "team",
		deal_id: replacementDeal,
		unrecorded_only: true,
	};
	const [, original] = await introduce({ ...fields, introduced_by: "joe" });
	const [edited] = await save(
		joe,
		`introductions/${original.introduction_id}`,
		{
			...key(),
			note: { from: "Example referral", to: "Example revised note" },
		},
	);
	assert.equal(edited, 200);
	const [status, refused] = await introduce({
		...fields,
		replaces: original.introduction_id,
		replace_version: original.version,
		introduced_by: "dell",
	});
	assert.equal(status, 409);
	assert.equal(refused.error, "version_conflict");
	const { rows } = await db.query(
		"select note from introduction where deal_id = $1",
		[replacementDeal],
	);
	assert.deepEqual(rows, [{ note: "Example revised note" }]);
});
