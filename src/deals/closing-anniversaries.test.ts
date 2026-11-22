import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, request, save } = doorTest();
const reader = { user: "example-reader" };
const owner = { user: "example-owner" };
const clientId = randomUUID();
const leapDeal = randomUUID();
const marchDeal = randomUUID();
const path = "closing-anniversaries";

before(async () => {
	await setup();
	await db.query(`
		begin;
		select set_config('engine.job', 'old_system', true);
		insert into role values ('client', 'Client');
		insert into how_found values ('referral', 'Referral');
		insert into phase values ('closed', 'Closed'), ('invoiced', 'Invoiced'),
			('dead', 'Dead'), ('research', 'Research');
		insert into party (name, kind)
			values ('Example Reader', 'person'), ('Example Owner', 'person');
		insert into app_user (id, slug)
			select id, case name when 'Example Reader' then 'example-reader' else 'example-owner' end
			from party where name in ('Example Reader', 'Example Owner');
		insert into party (id, name, kind, how_found)
			values ('${clientId}', 'Example Clinic', 'company', 'referral');
		insert into party_role (party_id, role) values ('${clientId}', 'client');
		insert into deal (id, name, owner_user_id)
			select f.id, f.name, u.id from app_user u
			cross join (values
				('${marchDeal}'::uuid, 'Example March purchase'),
				('${leapDeal}'::uuid, 'Example Leap Day lease'),
				(gen_random_uuid(), 'Example Following day'),
				(gen_random_uuid(), 'Example Without a client'),
				(gen_random_uuid(), 'Example Without a date'),
				(gen_random_uuid(), 'Example Lost deal'),
				(gen_random_uuid(), 'Example Unknown outcome'),
				(gen_random_uuid(), 'Example Open deal'),
				(gen_random_uuid(), 'Example New closing')
			) f(id, name) where u.slug = 'example-owner';
		insert into deal_party (deal_id, party_id, role)
			select id, '${clientId}', 'client' from deal where name <> 'Example Without a client';
		insert into imported_deal_board (deal_id, phase, outcome, closed_on)
			select d.id, f.phase, f.outcome, f.closed_on::date from deal d
			join (values
				('Example Leap Day lease', 'invoiced', 'won', '2020-02-29'),
				('Example Following day', 'closed', 'won', '2021-03-31'),
				('Example Without a client', 'closed', 'won', '2021-02-28'),
				('Example Without a date', 'closed', 'won', null),
				('Example Lost deal', 'closed', 'lost', '2021-02-28'),
				('Example Unknown outcome', 'closed', null, '2021-02-28'),
				('Example Open deal', 'research', null, null),
				('Example New closing', 'closed', 'won', '2025-02-28')
			) f(name, phase, outcome, closed_on) using (name);
		insert into deal_phase_change (deal_id, happened_at, phase)
			values ('${marchDeal}', '2021-03-31T02:00:00Z', 'closed');
		commit;
	`);
});

after(async () => {
	await db.query("rollback");
	await cleanup();
});

test("uses Chicago midnight and includes both ends of the 30-day window", async (t) => {
	t.mock.timers.enable({
		apis: ["Date"],
		now: Date.parse("2025-03-01T05:59:59Z"),
	});
	assert.deepEqual(await save(reader, path, {}, "GET"), [
		200,
		[
			{
				client_id: clientId,
				client_name: "Example Clinic",
				deal_id: leapDeal,
				deal_name: "Example Leap Day lease",
				closed_on: "2020-02-29",
				anniversary_on: "2025-02-28",
				years: 5,
				days_until: 0,
			},
			{
				client_id: clientId,
				client_name: "Example Clinic",
				deal_id: marchDeal,
				deal_name: "Example March purchase",
				closed_on: "2021-03-30",
				anniversary_on: "2025-03-30",
				years: 4,
				days_until: 30,
			},
		],
	]);
	t.mock.timers.setTime(Date.parse("2025-03-01T06:00:00Z"));
	assert.partialDeepStrictEqual(await save(reader, path, {}, "GET"), [
		200,
		[
			{ deal_id: marchDeal, days_until: 29 },
			{ deal_name: "Example Following day", days_until: 30 },
		],
	]);
});

test("keeps February 29 in leap years", async (t) => {
	t.mock.timers.enable({
		apis: ["Date"],
		now: Date.parse("2024-02-28T12:00:00Z"),
	});
	assert.partialDeepStrictEqual(await save(owner, path, {}, "GET"), [
		200,
		[
			{
				deal_id: leapDeal,
				anniversary_on: "2024-02-29",
				years: 4,
				days_until: 1,
			},
		],
	]);
});

test("returns an empty list when the window has no anniversaries", async (t) => {
	t.mock.timers.enable({
		apis: ["Date"],
		now: Date.parse("2025-07-01T12:00:00Z"),
	});
	assert.deepEqual(await save(reader, path, {}, "GET"), [200, []]);
});

test("requires a provisioned partner and takes no caller-supplied date", async () => {
	const signedOut = await request(reader, path, {
		method: "GET",
		headers: { Cookie: "" },
	});
	assert.equal(signedOut.status, 401);
	assert.partialDeepStrictEqual(
		await save({ user: "unprovisioned-example" }, path, {}, "GET"),
		[422, { error: "unauthenticated" }],
	);
	assert.partialDeepStrictEqual(
		await save(reader, `${path}?as_of=2025-02-28`, {}, "GET"),
		[400, { error: "unregistered_operation_fields" }],
	);
});
