import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "./save-door.ts";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, request, save } = doorTest();
const owner = randomUUID();
const other = randomUUID();
const deal = randomUUID();
const alex = { user: "joe" };
const blair = { user: "dell" };
const older = randomUUID();
const newer = randomUUID();
const read = randomUUID();
const dropped = randomUUID();
const theirs = randomUUID();

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${owner}', 'person', 'Alex Example'), ('${other}', 'person', 'Blair Example');
		insert into app_user (id, slug) values ('${owner}', '${alex.user}'), ('${other}', '${blair.user}');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Dental', '${owner}');
		insert into home_update (id, user_id, deal_id, what, checklist_item_ref, due_on, created_at, read_at) values
			('${older}', '${owner}', '${deal}', 'Review the survey', 'survey/item', '2001-02-01', '2001-01-01T15:00Z', null),
			('${newer}', '${owner}', '${deal}', 'Sign the lease', 'lease/item', '2001-02-02', '2001-01-03T15:00Z', null),
			('${read}', '${owner}', '${deal}', 'Order the keys', 'keys/item', '2001-02-03', '2001-01-02T15:00Z', '2001-01-02T16:00Z'),
			('${dropped}', '${owner}', '${deal}', 'Old reminder', 'old/item', '2001-02-04', '2001-01-04T15:00Z', null),
			('${theirs}', '${other}', '${deal}', 'Not for Alex', 'other/item', '2001-02-05', '2001-01-05T15:00Z', null);
		insert into home_mark (user_id, home_update_id, disposition, drop_reason)
			values ('${owner}', '${dropped}', 'dropped', 'Handled elsewhere');
		commit;`);
});
after(cleanup);

async function list(caller: typeof alex) {
	const response = await request(caller, "updates", { method: "GET" });
	assert.equal(response.status, 200);
	const body: unknown = await response.json();
	assert.ok(isArguments(body) && Array.isArray(body.updates));
	return {
		unread_count: body.unread_count,
		updates: body.updates.filter(isArguments),
	};
}

test("Updates lists the partner's own updates newest first with read state", async () => {
	const { unread_count, updates } = await list(alex);
	assert.equal(unread_count, 2);
	assert.deepEqual(
		updates.map(({ source_id, unseen, read_at }) => ({
			source_id,
			unseen,
			read_at,
		})),
		[
			{ source_id: newer, unseen: true, read_at: null },
			{ source_id: read, unseen: false, read_at: "2001-01-02T16:00:00.000Z" },
			{ source_id: older, unseen: true, read_at: null },
		],
	);
	assert.partialDeepStrictEqual(updates[0], {
		item_id: `notification:${newer}`,
		kind: "update",
		context_label: "Example Dental",
		open_url: `/deals?deal=${deal}`,
	});
	assert.match(String(updates[1]?.base_version), /:done$/);
	assert.deepEqual(
		(await list(blair)).updates.map((update) => update.source_id),
		[theirs],
	);
});

test("Marking updates read is idempotent and keeps the first read time", async () => {
	const idempotency_key = randomUUID();
	const [status, answer] = await save(alex, "updates/read", {
		idempotency_key,
		update_ids: [older, read],
	});
	assert.equal(status, 200);
	assert.equal(answer.unread_count, 1);
	assert.ok(Array.isArray(answer.updates));
	const times = new Map(
		answer.updates.filter(isArguments).map((u) => [u.id, u.read_at]),
	);
	assert.equal(times.get(read), "2001-01-02T16:00:00.000Z");
	assert.ok(typeof times.get(older) === "string");

	const [, replay] = await save(alex, "updates/read", {
		idempotency_key,
		update_ids: [read, older],
	});
	assert.equal(replay.replayed, true);
	const [again, fresh] = await save(alex, "updates/read", {
		idempotency_key: randomUUID(),
		update_ids: [older],
	});
	assert.equal(again, 200);
	assert.deepEqual(fresh.updates, [{ id: older, read_at: times.get(older) }]);
	assert.equal((await list(alex)).unread_count, 1);
});

test("A partner cannot mark another partner's update read", async () => {
	const [status, answer] = await save(alex, "updates/read", {
		idempotency_key: randomUUID(),
		update_ids: [newer, theirs],
	});
	assert.equal(status, 404);
	assert.equal(answer.error, "not_found");
	const { rows } = await db.query(
		`select id from home_update where id in ('${newer}', '${theirs}') and read_at is not null`,
	);
	assert.deepEqual(rows, []);
	const [invalid] = await save(alex, "updates/read", {
		idempotency_key: randomUUID(),
		update_ids: [],
	});
	assert.equal(invalid, 400);
});
