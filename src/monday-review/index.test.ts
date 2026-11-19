import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "../save-door.ts";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const joe = { user: "joe" };
const dell = { user: "dell" };
const [
	joeId,
	dellId,
	first,
	moved,
	closed,
	lost,
	parked,
	newDeal,
	oldLead,
	dropped,
	newLead,
	onDeal,
] = Array.from({ length: 12 }, randomUUID);
const brand = randomUUID();
const undated = randomUUID();
const unconfirmed = randomUUID();
const week = "2026-11-16";
const door = "weekly-reviews";

before(async () => {
	await setup();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into role values ('lead', 'Lead'), ('client', 'Client'), ('national_account', 'National account');
		insert into stage (role, slug, label) values
			('lead', 'opportunity', 'Opportunity'), ('lead', 'archived', 'Archived');
		insert into how_found (slug, label) values ('referral', 'Referral');
		insert into phase (slug, label) values ('pending', 'Prospective Client'),
			('research', 'Research'), ('closing', 'Closing'), ('closed', 'Closed'), ('dead', 'Lost');
		insert into party (id, kind, name, how_found) select id, 'person', 'Example', 'referral'
			from unnest(array['${joeId}', '${dellId}', '${oldLead}', '${dropped}', '${newLead}', '${onDeal}']::uuid[]) id;
		insert into party (id, kind, name) values ('${brand}', 'company', 'Example Franchisor');
		insert into party_role (party_id, role) values ('${brand}', 'national_account');
		insert into national_account (party_id) values ('${brand}');
		insert into app_user (id, slug) values ('${joeId}', 'joe'), ('${dellId}', 'dell');
		insert into party_role (party_id, role, stage, created_at) values
			('${oldLead}', 'lead', 'opportunity', '2026-11-01'),
			('${dropped}', 'lead', 'opportunity', '2026-11-02'),
			('${newLead}', 'lead', 'opportunity', '2026-11-16 07:00Z'),
			('${onDeal}', 'lead', 'opportunity', '2026-11-01'),
			('${onDeal}', 'client', null, '2026-11-01');
		insert into client (party_id) values ('${onDeal}');
		insert into client_brand (location_id, brand_id, started_on) values ('${onDeal}', '${brand}', '2026-11-01');
		update change set changed_at = (new_value->>'created_at')::timestamptz where table_name = 'party_role';
		set local engine.job = ''; set local engine.user_id = '${dellId}';
		insert into lead_stage_move (party_id, from_stage, to_stage, strength, reason)
			values ('${dropped}', 'opportunity', 'archived', 'strong', 'Example changed plans');
		update change set changed_at = '2026-11-17 14:00Z' where table_name = 'party_role' and action = 'update';
		insert into deal (id, name, owner_user_id, created_at) values
			('${first}', 'Alpha', '${joeId}', '2026-11-16 05:00Z'),
			('${moved}', 'Zulu', '${dellId}', '2026-11-01'),
			('${closed}', 'Beta', '${joeId}', '2026-11-01'),
			('${lost}', 'Gamma', '${joeId}', '2026-11-01'),
			('${parked}', 'AAA', '${dellId}', '2026-11-01'),
			('${newDeal}', 'New deal', '${dellId}', '2026-11-16 08:00Z'),
			('${undated}', 'Old terminal deal', '${dellId}', '2026-11-01'),
			('${unconfirmed}', 'Undated Monday phase', '${dellId}', '2026-11-01');
		update deal set parking_reason = 'client_paused' where id = '${parked}';
		insert into deal_party (deal_id, party_id, role) values ('${first}', '${onDeal}', 'client');
		alter table deal_phase_change disable trigger stamp_change;
		insert into deal_phase_change (deal_id, phase, happened_at, changed_at, changed_by_user_id, reason)
			select id, case when id = '${closed}' then 'research' else 'pending' end,
				created_at, created_at, '${joeId}'::uuid, null from deal
			where id not in ('${undated}', '${unconfirmed}')
			union all values
			('${moved}'::uuid, 'closing', '2026-11-10'::timestamptz, '2026-11-16 06:05Z'::timestamptz, '${dellId}'::uuid, null),
			('${closed}', 'closed', '2026-11-16 06:30Z', '2026-11-16 06:30Z', '${joeId}', null),
			('${lost}', 'dead', '2026-11-16 06:30Z', '2026-11-16 06:30Z', '${joeId}', 'Example stopped'),
			('${undated}', 'closed', '2026-11-17 10:00Z', '2026-11-17 10:00Z', '${joeId}', null),
			('${unconfirmed}', 'research', '2026-11-17 10:00Z', '2026-11-17 10:00Z', '${joeId}', null);
		insert into imported_deal_board (deal_id, phase, phase_at)
			values ('${undated}', 'closed', '2026-11-17 10:00Z');
		insert into weekly_review (week_of, deal_id) values ('${week}', '${parked}');
		alter table deal_phase_change enable trigger stamp_change;
		commit;`);
});
after(async () => {
	await db.query("rollback");
	await cleanup();
});

async function items(caller = joe, monday = week) {
	const [status, body] = await save(
		caller,
		`${door}?week_of=${monday}`,
		{},
		"GET",
	);
	assert.equal(status, 200, JSON.stringify(body));
	assert.ok(Array.isArray(body.items));
	return body.items.filter(isArguments);
}

test("the review keeps Monday order, retains departures and adds arrivals ahead of parked deals", async () => {
	const review = await items();
	assert.deepEqual(await items(dell), review);
	assert.deepEqual(
		review.map((i) => [i.deal_id ?? i.party_id, i.state]),
		[
			[first, "open"],
			[lost, "lost"],
			[moved, "open"],
			[closed, "closed"],
			[unconfirmed, "open"],
			[oldLead, "open"],
			[dropped, "dropped"],
			[newLead, "open"],
			[newDeal, "open"],
			[parked, "open"],
		],
	);
	const [firstItem] = review;
	assert.equal(firstItem?.workspace_kind, "national_account");
	const parkedItem = review.at(-1);
	assert.ok(parkedItem && isArguments(parkedItem.reviewed));
	assert.equal(parkedItem.reviewed.by, "dell");
	assert.ok(Number.isFinite(Date.parse(String(parkedItem.reviewed.at))));
	assert.equal(firstItem?.reviewed, null);
});
