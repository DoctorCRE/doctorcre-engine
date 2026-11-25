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
const mondayProspect = randomUUID();
const mondayConversion = randomUUID();
const laterContact = randomUUID();
const lateLinkDeal = randomUUID();
const secondClientDeal = randomUUID();
const archivedLeadDeal = randomUUID();
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
		insert into role values ('lead', 'Lead'), ('client', 'Client'), ('client_contact', 'Client contact'),
			('national_account', 'National account');
		insert into stage (role, slug, label) values
			('lead', 'opportunity', 'Opportunity'), ('lead', 'archived', 'Archived');
		insert into how_found (slug, label) values ('referral', 'Referral');
		insert into phase (slug, label) values ('pending', 'Prospective Client'),
			('research', 'Research'), ('closing', 'Closing'), ('closed', 'Closed'), ('dead', 'Lost');
		insert into party (id, kind, name, how_found) select id, 'person', 'Example', 'referral'
			from unnest(array['${joeId}', '${dellId}', '${oldLead}', '${dropped}', '${newLead}',
				'${onDeal}', '${mondayProspect}', '${laterContact}']::uuid[]) id;
		insert into party (id, kind, name) values ('${brand}', 'company', 'Example Franchisor');
		insert into party (id, kind, name, how_found)
			values ('${localClient}', 'company', 'Example Practice', 'referral');
		insert into party_role (party_id, role) values ('${brand}', 'national_account');
		insert into national_account (party_id) values ('${brand}');
		insert into app_user (id, slug) values ('${joeId}', 'joe'), ('${dellId}', 'dell');
		insert into party_role (party_id, role, stage, created_at) values
			('${oldLead}', 'lead', 'opportunity', '2026-11-01'),
			('${mondayProspect}', 'lead', 'opportunity', '2026-11-01 12:00Z'),
			('${dropped}', 'lead', 'opportunity', '2026-11-02'),
			('${laterContact}', 'lead', 'opportunity', '2026-11-03'),
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
		set constraints all immediate;
		alter table lead_stage_move disable trigger stamp_change;
		update lead_stage_move set changed_at = '2026-11-17 14:00Z' where party_id = '${dropped}';
		alter table lead_stage_move enable trigger stamp_change;
		update change set changed_at = '2026-11-17 14:00Z'
			where table_name = 'party_role' and action = 'update' and record->>'party_id' = '${dropped}';
		set constraints all deferred;
		insert into party_role (party_id, role, created_at)
			values ('${mondayProspect}', 'client', '2026-11-17 09:00Z'),
				('${dropped}', 'client', '2026-11-19 09:00Z');
		insert into client (party_id) values ('${mondayProspect}'), ('${dropped}');
		insert into deal (id, name, owner_user_id, created_at) values
			('${first}', 'Alpha', '${joeId}', '2026-11-16 05:00Z'),
			('${moved}', 'Zulu', '${dellId}', '2026-11-01'),
			('${closed}', 'Beta', '${joeId}', '2026-11-01'),
			('${lost}', 'Gamma', '${joeId}', '2026-11-01'),
			('${parked}', 'AAA', '${dellId}', '2026-11-01'),
			('${parkedAble}', 'Parked Able', '${dellId}', '2026-11-01'),
			('${parkedZulu}', 'Parked Zulu', '${dellId}', '2026-11-01'),
			('${newDeal}', 'New deal', '${dellId}', '2026-11-16 08:00Z'),
			('${mondayConversion}', 'Converted Monday prospect', '${dellId}', '2026-11-17 09:00Z'),
			('${lateLinkDeal}', 'Deal with a contact added later', '${dellId}', '2026-11-18 08:00Z'),
			('${secondClientDeal}', 'Second deal for converted client', '${dellId}', '2026-11-18 09:00Z'),
			('${archivedLeadDeal}', 'Deal for an archived lead', '${dellId}', '2026-11-19 09:00Z'),
			('${undated}', 'Old terminal deal', '${dellId}', '2026-11-01'),
			('${unconfirmed}', 'Undated Monday phase', '${dellId}', '2026-11-01'),
			('${clientless}', 'Deal without a client', '${dellId}', '2026-11-01');
		update deal set parking_reason = 'client_paused' where id in ('${parked}', '${parkedAble}', '${parkedZulu}');
		insert into deal_party (deal_id, party_id, role)
			select id, case when id = '${first}' then '${onDeal}'::uuid else '${localClient}'::uuid end, 'client'
			from deal where id not in ('${clientless}', '${mondayConversion}', '${secondClientDeal}', '${archivedLeadDeal}');
		insert into deal_party (deal_id, party_id, role, created_at)
			values ('${mondayConversion}', '${mondayProspect}', 'client', '2026-11-17 09:00Z'),
				('${secondClientDeal}', '${mondayProspect}', 'client', '2026-11-18 09:00Z'),
				('${archivedLeadDeal}', '${dropped}', 'client', '2026-11-19 09:00Z'),
				('${lateLinkDeal}', '${laterContact}', 'client_contact', '2026-11-20 09:00Z');
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
		insert into outside_id (source, value, party_id) values ('old_system_ref', 'C-0932', '${localClient}');
		insert into next_step (deal_id, party_id, owner_party_id, what) values
			('${moved}', null, '${dellId}', 'Relationship touch — C-0932. 60-day client cadence.'),
			(null, '${oldLead}', '${joeId}', 'Relationship touch — C-0932. 30-day client cadence.');
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
			[mondayConversion, "open"],
			[dropped, "dropped"],
			[newLead, "open"],
			[newDeal, "open"],
			[lateLinkDeal, "open"],
			[secondClientDeal, "open"],
			[archivedLeadDeal, "open"],
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
	assert.equal(
		review.find((item) => item.deal_id === mondayConversion)?.reviewed,
		null,
	);
	assert.deepEqual(review.find((item) => item.party_id === dropped)?.dropped, {
		at: "2026-11-17T14:00:00+00:00",
		by: "dell",
		reason: "Example changed plans",
	});
	assert.ok(
		!(await items(joe, "2026-11-23")).some((item) => item.party_id === dropped),
	);
});

test("the review names an old record code in deal and prospect check-ins", async () => {
	const review = await items();
	const checkIn = "Check in with Example Practice (client)";
	assert.equal(review.find((i) => i.deal_id === moved)?.next_step, checkIn);
	assert.partialDeepStrictEqual(
		review.find((i) => i.party_id === oldLead)?.follow_ups,
		[
			{
				what: "Relationship touch — C-0932. 30-day client cadence.",
				display_title: checkIn,
			},
		],
	);
});

test("either partner can mark or undo a Dropped review row", async () => {
	const before = (await items()).find((item) => item.party_id === dropped);
	assert.equal(before?.state, "dropped");
	assert.equal(before.reviewed, null);
	const [added, mark] = await save(joe, door, {
		...key(),
		week_of: week,
		party_id: dropped,
		seen_change_id: before.seen_change_id,
	});
	assert.equal(added, 201, JSON.stringify(mark));
	const marked = (await items(dell)).find((item) => item.party_id === dropped);
	assert.equal(marked?.state, "dropped");
	assert.ok(isArguments(marked.reviewed));
	assert.partialDeepStrictEqual(marked.reviewed, {
		review_id: mark.review_id,
		by: "joe",
	});
	assert.deepEqual(
		await save(dell, `${door}/${mark.review_id}/remove`, {
			...key(),
			seen_change_id: marked.seen_change_id,
		}),
		[200, mark],
	);
	assert.equal(
		(await items()).find((item) => item.party_id === dropped)?.reviewed,
		null,
	);
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

test("marking refuses jobs, non-Mondays and requests with both item IDs", async () => {
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

test("conversion moves this week's mark with its author and time, and replay cannot restore an undone mark", async () => {
	const [added, prospect] = await save(joe, "prospects", {
		...key(),
		name: "Example Reviewed Prospect",
		kind: "person",
		how_found: "referral",
	});
	assert.equal(added, 201, JSON.stringify(prospect));
	const {
		rows: [weeks],
	} = await db.query<{ current: string; previous: string }>(
		`select monday::text as current, (monday - 7)::text as previous
		from (select date_trunc('week', now() at time zone 'America/Chicago')::date as monday) week`,
	);
	assert.ok(weeks);
	const [arrivalStatus] = await save(joe, "prospects", {
		...key(),
		name: "Example Later Prospect",
		kind: "person",
		how_found: "referral",
	});
	assert.equal(arrivalStatus, 201);
	for (const monday of [weeks.previous, weeks.current]) {
		const [status, marked] = await save(joe, door, {
			...key(),
			week_of: monday,
			party_id: prospect.party_id,
			seen_change_id: 0,
		});
		assert.equal(status, 201, JSON.stringify(marked));
	}
	const beforeConversion = await items(dell, weeks.current);
	const prospectItem = beforeConversion.find(
		(item) => item.party_id === prospect.party_id,
	);
	assert.ok(prospectItem && isArguments(prospectItem.reviewed));
	assert.equal(prospectItem.reviewed.by, "joe");
	const args = {
		...key(),
		prospect_id: prospect.party_id,
		client_id: localClient,
		name: "Example Converted Deal",
		phase: "pending",
		owner: "dell",
	};
	const [converted, deal] = await save(dell, "deals", args);
	assert.equal(converted, 201, JSON.stringify(deal));
	const review = await items(dell, weeks.current);
	assert.deepEqual(
		review.map((item) => item.deal_id ?? item.party_id),
		beforeConversion.map((item) =>
			item.party_id === prospect.party_id
				? deal.deal_id
				: (item.deal_id ?? item.party_id),
		),
	);
	const dealItem = review.find((item) => item.deal_id === deal.deal_id);
	assert.ok(dealItem);
	assert.deepEqual(dealItem.reviewed, prospectItem.reviewed);
	assert.ok(
		Number(dealItem.seen_change_id) > Number(prospectItem.seen_change_id),
	);
	assert.deepEqual(
		(
			await db.query(
				"select week_of::text, deal_id from weekly_review where party_id = $1",
				[prospect.party_id],
			)
		).rows,
		[{ week_of: weeks.previous, deal_id: null }],
	);

	const [staleMark, conflict] = await save(dell, door, {
		...key(),
		week_of: weeks.current,
		party_id: prospect.party_id,
		seen_change_id: prospectItem.seen_change_id,
	});
	assert.deepEqual(
		[staleMark, conflict.error, conflict.current_version],
		[409, "version_conflict", dealItem.seen_change_id],
	);

	const undoDoor = `${door}/${prospectItem.reviewed.review_id}/remove`;
	assert.equal(
		(
			await save(dell, undoDoor, {
				...key(),
				seen_change_id: prospectItem.seen_change_id,
			})
		)[0],
		409,
	);
	assert.equal(
		(
			await save(dell, undoDoor, {
				...key(),
				seen_change_id: dealItem.seen_change_id,
			})
		)[0],
		200,
	);
	assert.deepEqual(await save(dell, "deals", args), [
		200,
		{ ...deal, replayed: true },
	]);
	const afterUndo = await items(dell, weeks.current);
	assert.deepEqual(
		afterUndo.map((item) => item.deal_id ?? item.party_id),
		review.map((item) => item.deal_id ?? item.party_id),
	);
	assert.equal(
		afterUndo.find((item) => item.deal_id === deal.deal_id)?.reviewed,
		null,
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

test("plain Add deal takes an active prospect's place and carries its review mark", async () => {
	const [added, prospect] = await save(joe, "prospects", {
		...key(),
		name: "Example Prospect with Client Role",
		kind: "company",
		how_found: "referral",
	});
	assert.equal(added, 201, JSON.stringify(prospect));
	assert.ok(typeof prospect.party_id === "string");
	await db.query("begin");
	try {
		await db.query("select set_config('engine.user_id', $1, true)", [joeId]);
		await db.query(
			"insert into party_role (party_id, role) values ($1, 'client')",
			[prospect.party_id],
		);
		await db.query("insert into client (party_id) values ($1)", [
			prospect.party_id,
		]);
		await db.query("commit");
	} finally {
		await db.query("rollback");
	}
	const {
		rows: [calendar],
	} = await db.query<{ monday: string }>(
		"select date_trunc('week', now() at time zone 'America/Chicago')::date::text as monday",
	);
	assert.ok(calendar);
	const { monday } = calendar;
	const [marked, mark] = await save(joe, door, {
		...key(),
		week_of: monday,
		party_id: prospect.party_id,
		seen_change_id: 0,
	});
	assert.equal(marked, 201, JSON.stringify(mark));
	const before = await items(dell, monday);
	const prospectRow = before.find(
		(item) => item.party_id === prospect.party_id,
	);
	assert.ok(prospectRow && isArguments(prospectRow.reviewed));
	const [status, deal] = await save(dell, "deals", {
		...key(),
		client_id: prospect.party_id,
		name: "Example Plain Deal",
		phase: "pending",
		owner: "dell",
	});
	assert.equal(status, 201, JSON.stringify(deal));
	const after = await items(dell, monday);
	assert.deepEqual(
		after.map((item) => item.deal_id ?? item.party_id),
		before.map((item) =>
			item.party_id === prospect.party_id
				? deal.deal_id
				: (item.deal_id ?? item.party_id),
		),
	);
	assert.deepEqual(
		after.find((item) => item.deal_id === deal.deal_id)?.reviewed,
		prospectRow.reviewed,
	);
});
