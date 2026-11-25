import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "../save-door.ts";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, request, save } = doorTest();
const joe = { user: "joe" };
const dell = { user: "dell" };
const [
	joeId,
	dellId,
	highlighted,
	earlier,
	later,
	newest,
	recentlyMoved,
	oldest,
	onDeal,
	qualified,
	deal,
	note,
	olderNote,
] = Array.from({ length: 13 }, () => randomUUID());
const property = randomUUID();
const completedStep = randomUUID();

before(async () => {
	await setup();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into how_found (slug, label) values ('referral', 'Referral');
		insert into party (id, kind, name, how_found)
			select id, 'person', 'Example Person', 'referral' from unnest(array[
				'${joeId}', '${dellId}', '${highlighted}', '${earlier}', '${later}', '${newest}',
				'${recentlyMoved}', '${oldest}', '${onDeal}', '${qualified}']::uuid[]) as id;
		insert into app_user (id, slug) values ('${joeId}', 'joe'), ('${dellId}', 'dell');
		insert into role (slug, label) values ('lead', 'Lead'), ('client', 'Client'), ('client_contact', 'Client contact');
		insert into stage (role, slug, label) values ('lead', 'opportunity', 'Opportunity'), ('lead', 'qualified', 'Qualified');
		set local engine.job = '';
		set local engine.user_id = '${joeId}';
		insert into party_role (party_id, role, stage, owner_user_id, needs_attention, created_at) values
			('${highlighted}', 'lead', 'opportunity', null, true, '2024-01-01'),
			('${earlier}', 'lead', 'opportunity', '${joeId}', false, '2024-01-01'),
			('${later}', 'lead', 'opportunity', '${dellId}', false, '2024-01-01'),
			('${newest}', 'lead', 'opportunity', null, false, '2024-02-01'),
			('${oldest}', 'lead', 'opportunity', null, false, '2024-01-01'),
			('${recentlyMoved}', 'lead', 'qualified', null, false, '2001-01-01'),
			('${onDeal}', 'lead', 'opportunity', null, false, '2024-01-01'),
			('${qualified}', 'lead', 'qualified', null, false, '2024-01-01');
		update party_role set stage = 'opportunity' where party_id = '${recentlyMoved}' and role = 'lead';
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Deal', '${joeId}');
		insert into deal_party (deal_id, party_id, role) values ('${deal}', '${onDeal}', 'client_contact');
		insert into next_step (party_id, owner_party_id, what, due_on, resolution) values
			('${earlier}', '${dellId}', 'Email', '2024-03-05', null),
			('${earlier}', '${joeId}', 'Call', '2024-03-03', null),
			('${later}', '${dellId}', 'Ask', '2024-03-04', null),
			('${highlighted}', '${dellId}', 'Relationship touch — C-0420. 60-day client cadence.', '2024-03-06', null);
		insert into outside_id (source, value, party_id) values ('old_system_ref', 'C-0420', '${qualified}');
		insert into next_step (id, party_id, owner_party_id, what, due_on, created_at, resolution, done_at) values
			('${completedStep}', '${later}', '${joeId}', 'Past step', '2024-02-02', '2024-02-01', 'done', now());
		insert into activity (id, kind, from_party_id, happened_at, summary) values
			('${note}', 'note', '${dellId}', '2024-02-01', E'Newest note\\nMore text'),
			('${olderNote}', 'note', '${joeId}', '2023-11-30', 'Older note');
		insert into activity_about (activity_id, party_id) values ('${note}', '${earlier}'), ('${olderNote}', '${earlier}'), ('${note}', '${newest}'), ('${olderNote}', '${newest}');
		-- Exercise the reader's scope independently of the storage constraints.
		alter table next_step drop constraint next_step_one_record, drop constraint next_step_item_shape;
		insert into property (id, address) values ('${property}', '100 Example Way');
		insert into next_step (party_id, owner_party_id, what, due_on, deal_id, property_id, item_title) values
			('${newest}', '${joeId}', 'Deal step', '2024-01-10', '${deal}', null, null),
			('${newest}', '${joeId}', 'Property step', '2024-01-11', null, '${property}', null),
			('${newest}', '${joeId}', 'Checklist step', '2024-01-12', null, null, 'Example checklist');
		commit;`);
});
after(async () => {
	await db.query("rollback");
	await cleanup();
});

function field(value: unknown, name: string) {
	assert.ok(isArguments(value));
	return value[name];
}

function steps(prospect: unknown) {
	const followUps = field(prospect, "follow_ups");
	assert.ok(Array.isArray(followUps));
	return followUps.map((step) => field(step, "what"));
}

test("lane includes only eligible leads and orders attention, follow-up date, then newest", async () => {
	for (const [filter, expected] of [
		["", [highlighted, earlier, later, recentlyMoved, newest, oldest]],
		["?owner=joe", [highlighted, earlier, recentlyMoved, newest, oldest]],
		["?owner=dell", [highlighted, later, recentlyMoved, newest, oldest]],
	] as const) {
		const response = await request(joe, `prospects${filter}`, {
			method: "GET",
		});
		assert.equal(response.status, 200);
		const lane = await response.json();
		assert.ok(isArguments(lane) && Array.isArray(lane.prospects));
		const { prospects, count } = lane;
		assert.deepEqual(
			prospects.map((row) => field(row, "party_id")),
			expected,
		);
		assert.equal(count, expected.length);
		assert.equal(field(prospects[0], "needs_attention"), true);
		assert.equal(field(prospects[0], "owner"), null);
		if (!filter) {
			assert.deepEqual(field(prospects[1], "latest_note"), {
				summary: "Newest note\nMore text",
				by: "dell",
				at: "2024-02-01T00:00:00+00:00",
			});
			assert.equal(field(prospects[1], "owner"), "joe");
			assert.equal(field(prospects[1], "how_found"), "referral");
			assert.deepEqual(steps(prospects[1]), ["Call", "Email"]);
			assert.deepEqual(steps(prospects[2]), ["Ask"]);
		}
	}
	assert.equal(
		(await request(joe, "prospects?owner=example", { method: "GET" })).status,
		400,
	);
	assert.equal(
		(await request({ job: "agent" }, "prospects", { method: "GET" })).status,
		404,
	);
});

test("a check-in follow-up names who to check in with and keeps its stored wording for the editor", async () => {
	const read = async (path: string): Promise<unknown> =>
		(await request(joe, path, { method: "GET" })).json();
	const prospects = field(await read("prospects"), "prospects");
	assert.ok(Array.isArray(prospects));
	for (const prospect of [
		prospects[0],
		await read(`prospects/${highlighted}`),
	]) {
		const followUps = field(prospect, "follow_ups");
		assert.ok(Array.isArray(followUps));
		assert.deepEqual(
			followUps.map((step) => ({
				what: field(step, "what"),
				display_title: field(step, "display_title"),
			})),
			[
				{
					what: "Relationship touch — C-0420. 60-day client cadence.",
					display_title: "Check in with Example Person (client)",
				},
			],
		);
	}
});

test("only ordinary party steps appear as a prospect's follow-ups", async () => {
	const response = await request(joe, `prospects/${newest}`, { method: "GET" });
	assert.equal(response.status, 200);
	assert.deepEqual(steps(await response.json()), []);
});

test("a Done card links to the saved prospect follow-up", async () => {
	const response = await request(
		joe,
		"home/inbox",
		{ method: "GET" },
		{
			HOME_INBOX_READ_SCHEMA: "next",
		},
	);
	assert.equal(response.status, 200);
	const items = field(await response.json(), "items");
	assert.ok(Array.isArray(items));
	assert.partialDeepStrictEqual(
		items.filter(isArguments).find((item) => item.source_id === completedStep),
		{
			section: "done",
			open_url: `/deals?prospect=${later}&focus=follow-up&step=${completedStep}`,
		},
	);
});

test("prospect detail returns just the requested completion outside the open follow-ups", async () => {
	const response = await request(
		joe,
		`prospects/${later}?step=${completedStep}`,
		{ method: "GET" },
	);
	assert.equal(response.status, 200);
	const detail: unknown = await response.json();
	assert.deepEqual(steps(detail), ["Ask"]);
	assert.partialDeepStrictEqual(field(detail, "completed_follow_up"), {
		next_step_id: completedStep,
		what: "Past step",
		set_by: "Example Person",
		set_at: "2024-02-01T00:00:00+00:00",
	});
	const other = await request(
		joe,
		`prospects/${earlier}?step=${completedStep}`,
		{ method: "GET" },
	);
	assert.equal(other.status, 200);
	assert.equal(field(await other.json(), "completed_follow_up"), null);
});

test("detail includes older notes and a second partner's poll picks up a new note", async () => {
	const path = `prospects/${newest}`;
	const first = await request(joe, path, { method: "GET" });
	assert.equal(first.status, 200);
	const version = first.headers.get("etag");
	assert.ok(version);
	const detail = await first.json();
	assert.ok(
		isArguments(detail) &&
			Array.isArray(detail.notes) &&
			typeof detail.change_id === "number",
	);
	assert.deepEqual(
		detail.notes.map((item) => field(item, "activity_id")),
		[note, olderNote],
	);
	assert.ok(detail.change_id > 0);
	const poll = () =>
		request(joe, path, {
			method: "GET",
			headers: { "If-None-Match": version },
		});
	const unchanged = await poll();
	assert.equal(unchanged.status, 304);
	assert.equal(await unchanged.text(), "");
	const [status, added] = await save(dell, "activities", {
		idempotency_key: randomUUID(),
		kind: "note",
		about: [{ party_id: newest }],
		happened_at: "2024-02-02T00:00:00Z",
		summary: "Shared note",
	});
	assert.equal(status, 201);
	const changed = await poll();
	assert.equal(changed.status, 200);
	assert.notEqual(changed.headers.get("etag"), version);
	const updated = await changed.json();
	assert.ok(isArguments(updated) && Array.isArray(updated.notes));
	assert.deepEqual(updated.notes[0], {
		activity_id: added.activity_id,
		summary: "Shared note",
		by: "dell",
		at: "2024-02-02T00:00:00+00:00",
	});
	assert.equal(updated.change_id, detail.change_id);
	assert.equal(
		(await request(joe, `prospects/${onDeal}`, { method: "GET" })).status,
		404,
	);
});
