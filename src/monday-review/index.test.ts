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
const clientless = randomUUID();
const localClient = randomUUID();
const parkedAble = "ecaee528-9e80-4e43-a988-d1977e921782";
const parkedZulu = "65ed2ced-a347-480b-831a-40dcff6a6312";
const week = "2026-11-16";
const door = "weekly-reviews";
const key = () => ({ idempotency_key: randomUUID() });

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
		insert into party (id, kind, name, how_found)
			values ('${localClient}', 'company', 'Example Practice', 'referral');
		insert into party_role (party_id, role) values ('${brand}', 'national_account');
		insert into national_account (party_id) values ('${brand}');
		insert into app_user (id, slug) values ('${joeId}', 'joe'), ('${dellId}', 'dell');
		insert into party_role (party_id, role, stage, created_at) values
			('${oldLead}', 'lead', 'opportunity', '2026-11-01'),
			('${dropped}', 'lead', 'opportunity', '2026-11-02'),
			('${newLead}', 'lead', 'opportunity', '2026-11-16 07:00Z'),
			('${onDeal}', 'lead', 'opportunity', '2026-11-01'),
			('${onDeal}', 'client', null, '2026-11-01'),
			('${localClient}', 'client', null, '2026-11-01');
		insert into client (party_id) values ('${onDeal}'), ('${localClient}');
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
			('${parkedAble}', 'Parked Able', '${dellId}', '2026-11-01'),
			('${parkedZulu}', 'Parked Zulu', '${dellId}', '2026-11-01'),
			('${newDeal}', 'New deal', '${dellId}', '2026-11-16 08:00Z'),
			('${undated}', 'Old terminal deal', '${dellId}', '2026-11-01'),
			('${unconfirmed}', 'Undated Monday phase', '${dellId}', '2026-11-01'),
			('${clientless}', 'Deal without a client', '${dellId}', '2026-11-01');
		update deal set parking_reason = 'client_paused' where id in ('${parked}', '${parkedAble}', '${parkedZulu}');
		insert into deal_party (deal_id, party_id, role)
			select id, case when id = '${first}' then '${onDeal}'::uuid else '${localClient}'::uuid end, 'client'
			from deal where id <> '${clientless}';
		alter table deal_phase_change disable trigger stamp_change;
		insert into deal_phase_change (deal_id, phase, happened_at, changed_at, changed_by_user_id, reason)
			select id, case when id in ('${closed}', '${parked}') then 'research' else 'pending' end,
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
			[parkedAble, "open"],
			[parkedZulu, "open"],
			[parked, "open"],
		],
	);
	const [firstItem] = review;
	assert.equal(firstItem?.workspace_kind, "national_account");
	assert.equal(review.find((i) => i.deal_id === moved)?.workspace_kind, "team");
	const parkedItem = review.find((i) => i.deal_id === parked);
	assert.ok(parkedItem && isArguments(parkedItem.reviewed));
	assert.equal(parkedItem.reviewed.by, "dell");
	assert.ok(Number.isFinite(Date.parse(String(parkedItem.reviewed.at))));
	assert.ok(
		typeof parkedItem.seen_change_id === "number" &&
			parkedItem.seen_change_id > 0,
	);
	assert.equal(firstItem?.reviewed, null);
	assert.equal(firstItem?.seen_change_id, 0);
});

test("the review refuses a non-Monday or a repeated week_of", async () => {
	for (const query of [
		"week_of=2026-11-17",
		`week_of=${week}&week_of=${week}`,
	]) {
		const [status, body] = await save(joe, `${door}?${query}`, {}, "GET");
		assert.equal(status, 400);
		assert.equal(body.error, "invalid_field_value");
		assert.deepEqual(body.fields, ["week_of"]);
	}
});

test("the database refuses infinity as a review week", async () => {
	await db.query(`begin; set local engine.user_id = '${joeId}';`);
	try {
		await assert.rejects(
			db.query(
				"insert into weekly_review (week_of, deal_id) values ('infinity', $1)",
				[first],
			),
			{ constraint: "weekly_review_week_of_check" },
		);
	} finally {
		await db.query("rollback");
	}
});

test("both partners see who reviewed an item, and Undo advances that week's version", async () => {
	const mark = {
		...key(),
		week_of: week,
		party_id: oldLead,
		seen_change_id: 0,
	};
	const [added, saved] = await save(joe, door, mark);
	assert.equal(added, 201, JSON.stringify(saved));
	assert.deepEqual(await save(joe, door, mark), [
		201,
		{ ...saved, replayed: true },
	]);
	const seen = (await items(dell)).find((i) => i.party_id === oldLead);
	assert.ok(seen && isArguments(seen.reviewed));
	assert.equal(seen.reviewed.by, "joe");
	assert.equal(seen.reviewed.review_id, saved.review_id);
	assert.ok(Number.isFinite(Date.parse(String(seen.reviewed.at))));
	const again = { ...mark, ...key(), seen_change_id: seen.seen_change_id };
	assert.deepEqual(await save(dell, door, again), [
		200,
		{ ...saved, existing: true },
	]);
	const nextWeek = "2026-11-23";
	assert.equal(
		(await items(dell, nextWeek)).find((i) => i.party_id === oldLead)?.reviewed,
		null,
	);
	assert.equal(
		(
			await save(dell, door, {
				...again,
				...key(),
				week_of: nextWeek,
				seen_change_id: 0,
			})
		)[0],
		201,
	);
	const remove = { ...key(), seen_change_id: seen.seen_change_id };
	const undoDoor = `${door}/${saved.review_id}/remove`;
	const [staleUndo] = await save(dell, undoDoor, {
		...key(),
		seen_change_id: 0,
	});
	assert.equal(staleUndo, 409);
	assert.deepEqual(await save(dell, undoDoor, remove), [200, saved]);
	assert.deepEqual(await save(joe, door, mark), [
		201,
		{ ...saved, replayed: true },
	]);
	assert.deepEqual(await save(dell, undoDoor, remove), [
		200,
		{ ...saved, replayed: true },
	]);
	const undone = (await items()).find((i) => i.party_id === oldLead);
	assert.equal(undone?.reviewed, null);
	assert.notEqual(undone?.seen_change_id, 0);
	const [conflict, stale] = await save(dell, door, { ...mark, ...key() });
	assert.equal(conflict, 409);
	assert.equal(stale.current_version, undone?.seen_change_id);
	assert.equal(
		(
			await save(dell, door, {
				...mark,
				...key(),
				seen_change_id: undone?.seen_change_id,
			})
		)[0],
		201,
	);
});

test("the job entrance and a week that starts on Tuesday are refused", async () => {
	const mark = { ...key(), week_of: week, deal_id: first, seen_change_id: 0 };
	assert.equal(
		(await save({ job: "agent", for_user: "joe" }, door, mark))[0],
		404,
	);
	assert.equal(
		(await save(joe, door, { ...mark, week_of: "2026-11-17" }))[0],
		400,
	);
	assert.equal((await save(joe, door, { ...mark, party_id: oldLead }))[0], 400);
});

test("concurrent marks for the same deal accept the first screen version only", async () => {
	assert.ok(newDeal);
	const args = { week_of: week, deal_id: newDeal, seen_change_id: 0 };
	const responses = await Promise.all([
		save(joe, door, { ...args, ...key() }),
		save(dell, door, { ...args, ...key(), deal_id: newDeal.toUpperCase() }),
	]);
	assert.deepEqual(responses.map(([status]) => status).sort(), [201, 409]);
	const [item] = (await items()).filter((row) => row.deal_id === newDeal);
	assert.ok(item && isArguments(item.reviewed));
	assert.equal(
		item.reviewed.review_id,
		responses.find(([status]) => status === 201)?.[1].review_id,
	);
});

test("the database rejects another mark for the same week and a job's Undo", async () => {
	try {
		await assert.rejects(
			db.query(`begin; set local engine.user_id = '${joeId}';
			insert into weekly_review (week_of, deal_id) values ('${week}', '${parked}');`),
			{ code: "23505" },
		);
		await db.query("rollback");
		await assert.rejects(
			db.query(`begin; set local engine.user_id = '${joeId}'; set local engine.job = 'agent';
			delete from weekly_review where deal_id = '${parked}' and week_of = '${week}';`),
			{ constraint: "weekly_review_undo_by_partner" },
		);
	} finally {
		await db.query("rollback");
	}
});
