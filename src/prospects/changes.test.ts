import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "../save-door.ts";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const joe = { user: "joe" };
const dell = { user: "dell" };
const joeId = randomUUID();
const dellId = randomUUID();
const otherUser = randomUUID();
const lead = randomUUID();
const toDrop = randomUUID();
const onDeal = randomUUID();
const deal = randomUUID();
const key = () => ({ idempotency_key: randomUUID() });

before(async () => {
	await setup();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into role (slug, label) values ('lead', 'Lead'), ('client_contact', 'Client contact');
		insert into stage (role, slug, label) values ('lead', 'opportunity', 'Opportunity'), ('lead', 'archived', 'Archived');
		insert into how_found (slug, label) values ('referral', 'Referral');
		insert into party (id, kind, name, how_found)
			select id, 'person', 'Example Person', 'referral'
			from unnest(array['${joeId}', '${dellId}', '${otherUser}', '${lead}', '${toDrop}', '${onDeal}']::uuid[]) as id;
		insert into app_user (id, slug) values ('${joeId}', 'joe'), ('${dellId}', 'dell'), ('${otherUser}', 'claude');
		insert into party_role (party_id, role, stage) values
			('${lead}', 'lead', 'opportunity'), ('${toDrop}', 'lead', 'opportunity'),
			('${onDeal}', 'lead', 'opportunity');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Deal', '${joeId}');
		insert into deal_party (deal_id, party_id, role) values ('${deal}', '${onDeal}', 'client_contact');
		commit;`);
});
after(async () => {
	await db.query("rollback");
	await cleanup();
});

async function leadVersion(partyId: string) {
	const [status, prospect] = await save(joe, `prospects/${partyId}`, {}, "GET");
	assert.equal(status, 200);
	assert.equal(typeof prospect.change_id, "number");
	return prospect.change_id;
}

test("partners can claim, hand off, unclaim and highlight without overwriting a stale field", async () => {
	const path = `prospects/${lead}/changes`;
	const initial = await leadVersion(lead);
	const [invalidOwner, refusal] = await save(joe, path, {
		...key(),
		seen_change_id: initial,
		fields: { owner: "claude" },
	});
	assert.equal(invalidOwner, 400);
	assert.partialDeepStrictEqual(refusal, {
		error: "unknown_owner",
		hint: "Choose Joe or Dell, or leave it Unclaimed.",
	});
	const claim = { ...key(), seen_change_id: initial, fields: { owner: "joe" } };
	const [status, claimed] = await save(joe, path, claim);
	assert.equal(status, 200);
	assert.deepEqual(await save(joe, path, claim), [
		200,
		{ ...claimed, replayed: true },
	]);
	const [flagStatus, flagged] = await save(dell, path, {
		...key(),
		seen_change_id: initial,
		fields: { needs_attention: true },
	});
	assert.equal(flagStatus, 200);
	assert.deepEqual(flagged, {
		party_id: lead,
		rebased: true,
		intervening_change_ids: [claimed.change_id],
	});
	const [refused, conflict] = await save(dell, path, {
		...key(),
		seen_change_id: initial,
		fields: { owner: "dell" },
	});
	assert.equal(refused, 409);
	assert.equal(conflict.error, "version_conflict");
	assert.equal(conflict.current_version, await leadVersion(lead));
	const { rows } = await db.query(
		"select owner_user_id, needs_attention from party_role where party_id = $1",
		[lead],
	);
	assert.deepEqual(rows, [{ owner_user_id: joeId, needs_attention: true }]);

	const [handedOff, handoff] = await save(joe, path, {
		...key(),
		seen_change_id: conflict.current_version,
		fields: { owner: "dell" },
	});
	assert.equal(handedOff, 200);
	assert.equal(
		(
			await db.query(
				"select owner_user_id from party_role where party_id = $1",
				[lead],
			)
		).rows[0]?.owner_user_id,
		dellId,
	);
	assert.equal(
		(
			await save(dell, path, {
				...key(),
				seen_change_id: handoff.change_id,
				fields: { owner: null, needs_attention: false },
			})
		)[0],
		200,
	);
	assert.deepEqual(
		(
			await db.query(
				"select owner_user_id, needs_attention from party_role where party_id = $1",
				[lead],
			)
		).rows,
		[{ owner_user_id: null, needs_attention: false }],
	);
	assert.equal(
		(await save({ job: "agent", for_user: "joe" }, path, claim))[0],
		404,
	);
});

test("a dropped prospect still opens with its reason and history and refuses prospect saves", async () => {
	const path = `prospects/${toDrop}/drop`;
	const seen_change_id = await leadVersion(toDrop);
	const week_of = "2026-11-16";
	const [markStatus, mark] = await save(joe, "weekly-reviews", {
		...key(),
		week_of,
		party_id: toDrop,
		seen_change_id: 0,
	});
	assert.equal(markStatus, 201);
	const [noteStatus, note] = await save(joe, "activities", {
		...key(),
		kind: "note",
		summary: "Example history",
		about: [{ party_id: toDrop }],
	});
	assert.equal(noteStatus, 201);

	const [missing, invalid] = await save(dell, path, { ...key(), reason: " " });
	assert.equal(missing, 400);
	assert.equal(invalid.error, "missing_required");
	const request = { ...key(), reason: " No longer looking " };
	const [status, dropped] = await save(dell, path, request);
	assert.deepEqual(
		[status, dropped],
		[200, { party_id: toDrop, stage: "archived" }],
	);
	const [readStatus, detail] = await save(
		joe,
		`prospects/${toDrop}`,
		{},
		"GET",
	);
	assert.equal(readStatus, 200);
	assert.partialDeepStrictEqual(detail, {
		party_id: toDrop,
		state: "dropped",
		dropped: { by: "dell", reason: "No longer looking" },
		latest_note: { summary: "Example history" },
	});
	assert.ok(isArguments(detail.dropped));
	assert.ok(Number.isFinite(Date.parse(String(detail.dropped.at))));
	const [laneStatus, lane] = await save(joe, "prospects", {}, "GET");
	assert.equal(laneStatus, 200);
	assert.ok(Array.isArray(lane.prospects));
	assert.ok(
		!lane.prospects.some(
			(item) => isArguments(item) && item.party_id === toDrop,
		),
	);
	const [afterDrop, edit] = await save(joe, `prospects/${toDrop}/changes`, {
		...key(),
		seen_change_id,
		fields: { owner: "joe" },
	});
	assert.equal(afterDrop, 409);
	assert.equal(edit.error, "not_a_prospect");
	assert.deepEqual(await save(dell, path, request), [
		200,
		{ ...dropped, replayed: true },
	]);
	const result = await db.query(
		`select l.stage, m.reason, m.changed_by_user_id, a.activity_id
		from party_role l join lead_stage_move m using (party_id)
		join activity_about a using (party_id) where l.party_id = $1`,
		[toDrop],
	);
	assert.deepEqual(result.rows, [
		{
			stage: "archived",
			reason: "No longer looking",
			changed_by_user_id: dellId,
			activity_id: note.activity_id,
		},
	]);
	const [again, refusal] = await save(dell, path, { ...request, ...key() });
	assert.equal(again, 409);
	assert.equal(refusal.error, "not_a_prospect");
	for (const [door, args] of [
		[
			"weekly-reviews",
			{ week_of: "2026-11-23", party_id: toDrop, seen_change_id: 0 },
		],
		[`weekly-reviews/${mark.review_id}/remove`, { seen_change_id: 0 }],
		[
			"next-steps",
			{
				party_id: toDrop,
				what: "Follow up",
				due_on: "2026-11-24",
				replaces: "current",
				seen_current_step: null,
			},
		],
		[
			"deals",
			{
				prospect_id: toDrop,
				client_id: toDrop,
				name: "Example New Deal",
				phase: "pending",
				owner: "joe",
			},
		],
	] as const) {
		const [status, answer] = await save(joe, door, { ...key(), ...args });
		assert.deepEqual([status, answer.error], [409, "not_a_prospect"], door);
	}
});

test("owner and attention changes require a real lead and at least one field", async () => {
	const request = { ...key(), seen_change_id: 0, fields: { owner: "joe" } };
	assert.equal(
		(await save(joe, `prospects/${randomUUID()}/changes`, request))[0],
		404,
	);
	const [status, error] = await save(joe, `prospects/${lead}/changes`, {
		...request,
		fields: {},
	});
	assert.equal(status, 400);
	assert.partialDeepStrictEqual(error, {
		error: "invalid_field_value",
		fields: ["fields"],
	});
});

test("a lead already on a deal cannot be claimed or dropped from Prospects", async () => {
	const path = `prospects/${onDeal}`;
	const { rows } = await db.query(
		"select max(id) from change where table_name = 'party_role' and record = jsonb_build_object('party_id', $1::uuid, 'role', 'lead')",
		[onDeal],
	);
	const seen_change_id = Number(rows[0]?.max);
	for (const [operation, fields] of [
		["changes", { seen_change_id, fields: { owner: "joe" } }],
		["drop", { reason: "Example reason" }],
	] as const) {
		const [status, answer] = await save(joe, `${path}/${operation}`, {
			...key(),
			...fields,
		});
		assert.equal(status, 409);
		assert.partialDeepStrictEqual(answer, {
			error: "not_a_prospect",
			party_id: onDeal,
		});
	}
});
