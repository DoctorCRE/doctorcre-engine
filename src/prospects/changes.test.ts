import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const joe = { user: "joe" };
const dell = { user: "dell" };
const joeId = randomUUID();
const dellId = randomUUID();
const lead = randomUUID();
const toDrop = randomUUID();
const key = () => ({ idempotency_key: randomUUID() });

before(async () => {
	await setup();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into role (slug, label) values ('lead', 'Lead');
		insert into stage (role, slug, label) values ('lead', 'opportunity', 'Opportunity'), ('lead', 'archived', 'Archived');
		insert into how_found (slug, label) values ('referral', 'Referral');
		insert into party (id, kind, name, how_found)
			select id, 'person', 'Example Person', 'referral'
			from unnest(array['${joeId}', '${dellId}', '${lead}', '${toDrop}']::uuid[]) as id;
		insert into app_user (id, slug) values ('${joeId}', 'joe'), ('${dellId}', 'dell');
		insert into party_role (party_id, role, stage) values
			('${lead}', 'lead', 'opportunity'), ('${toDrop}', 'lead', 'opportunity');
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

test("drop archives the lead with the partner's reason and keeps the notes", async () => {
	const path = `prospects/${toDrop}/drop`;
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
	assert.equal((await save(joe, `prospects/${toDrop}`, {}, "GET"))[0], 404);
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
});
