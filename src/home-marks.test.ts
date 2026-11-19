import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, save, request } = doorTest();
const alex = { user: "alex" };
const blair = { user: "blair" };
const owner = randomUUID();
const other = randomUUID();
const company = randomUUID();
const until = "2099-11-20T06:00:00Z";
const waiting = {
	target: { kind: "party", id: company },
	reason: "Waiting for revised terms",
};
const path = "home/marks";

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${owner}', 'person', 'Alex Example'), ('${other}', 'person', 'Blair Example'),
			('${company}', 'company', 'Example Company');
		insert into app_user (id, slug) values ('${owner}', 'alex'), ('${other}', 'blair');
		commit;`);
});
after(cleanup);

const kinds = [
	"next_action",
	"capture_post_call_action",
	"notification",
] as const;

async function fixture(kind: (typeof kinds)[number]) {
	const id = randomUUID();
	const deal = randomUUID();
	const call = randomUUID();
	const update = kind === "notification";
	const followUp = kind === "capture_post_call_action";
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Deal ' || '${deal}', '${owner}');
		insert into activity (id, kind, happened_at) values ('${call}', 'call', '2001-01-01T12:00:00Z');
		insert into activity_about (activity_id, deal_id) values ('${call}', '${deal}');
		${
			update
				? `insert into home_update (id, user_id, deal_id, what) values ('${id}', '${owner}', '${deal}', 'Lease updated');`
				: `insert into next_step (id, owner_party_id, deal_id, what, call_activity_id, call_evidence_quote)
				values ('${id}', '${owner}', '${deal}', 'Check the lease',
				${followUp ? `'${call}', 'Check the lease'` : "null, null"});`
		}
		commit;`);
	const {
		rows: [source],
	} = await db.query(
		"select max(id) as id from change where table_name = $1 and record = $2",
		[update ? "home_update" : "next_step", { id }],
	);
	const rows = async () =>
		(
			await db.query({
				text: `select item_kind, disposition, waiting_on_party_id, waiting_reason, changed_by_user_id
			from home_mark where item_id = $1`,
				values: [id],
				rowMode: "array",
			})
		).rows;
	return {
		id,
		item_id: `${kind}:${id}`,
		base_version: `${source.id}:0:inbox`,
		rows,
	};
}

async function cardVersion(item_id: string) {
	const response = await request(
		alex,
		"home/inbox",
		{ method: "GET" },
		{ HOME_INBOX_READ_SCHEMA: "next" },
	);
	assert.equal(response.status, 200);
	const { items }: { items: { item_id: string; base_version: string }[] } =
		await response.json();
	return items.find((card) => card.item_id === item_id)?.base_version;
}

const command = (body: object, action: string, user = alex, extra = {}) =>
	save(user, path, {
		idempotency_key: randomUUID(),
		action,
		...body,
		...extra,
	});

for (const [index, prefix] of kinds.entries()) {
	test(`saves and clears each mark on ${prefix}`, async () => {
		const { item_id, base_version, rows } = await fixture(prefix);
		const card = { item_id, base_version };
		const snooze = {
			...card,
			idempotency_key: randomUUID(),
			action: "snooze",
			until,
		};
		const [status, first] = await save(alex, path, snooze);
		assert.equal(status, 200, JSON.stringify(first));
		assert.deepEqual(await save(alex, path, snooze), [
			200,
			{ ...first, replayed: true },
		]);
		let version = first.base_version;
		const edit = async (action: string, fields = {}) => {
			const [code, body] = await command(
				{ item_id, base_version: version, ...fields },
				action,
			);
			assert.equal(code, 200, JSON.stringify(body));
			version = body.base_version;
			return body;
		};
		await edit("snooze", { until });
		assert.equal(version, first.base_version);
		await edit("set-waiting", waiting);
		const kind = ["next_step", "call_follow_up", "home_update"][index];
		assert.deepEqual(await rows(), [
			[kind, "snoozed", company, waiting.reason, owner],
		]);
		const unsnoozed = await edit("unsnooze");
		assert.deepEqual(unsnoozed.previous, {
			disposition: "snoozed",
			snoozed_until: "2099-11-20T06:00:00+00:00",
			waiting_on_party_id: company,
			waiting_reason: waiting.reason,
		});
		assert.deepEqual(await rows(), [
			[kind, null, company, waiting.reason, owner],
		]);
		await edit("clear-waiting");
		assert.deepEqual(await rows(), []);
		assert.equal(await cardVersion(item_id), version);
		const [stale, conflict] = await command(card, "snooze", alex, { until });
		assert.equal(stale, 409);
		assert.equal(conflict.current_version, version);
		const [foreign, refusal] = await command(
			{ item_id, base_version: version },
			"unsnooze",
			blair,
		);
		assert.equal(foreign, 404);
		assert.equal(refusal.error, "home_item_not_found");
	});
}

test("a crossed save fails and unsnooze clears a lone snooze mark", async () => {
	const { item_id, base_version, rows } = await fixture("next_action");
	const card = { item_id, base_version, until };
	const crossed = await Promise.all([
		command(card, "snooze"),
		command(card, "snooze"),
	]);
	assert.deepEqual(crossed.map(([code]) => code).sort(), [200, 409]);
	const winner = crossed.find(([code]) => code === 200)?.[1];
	assert.ok(winner);
	assert.match(String(winner.base_version), /:snoozed$/);
	assert.equal(await cardVersion(item_id), winner.base_version);
	const [status, unsnoozed] = await command(
		{ item_id, base_version: winner.base_version },
		"unsnooze",
	);
	assert.equal(status, 200, JSON.stringify(unsnoozed));
	assert.match(String(unsnoozed.base_version), /:inbox$/);
	assert.equal(await cardVersion(item_id), unsnoozed.base_version);
	assert.deepEqual(await rows(), []);
});

test("refuses settle, unsettle, unknown cards, past snoozes and waiting without a reason", async () => {
	const { item_id, base_version } = await fixture("notification");
	for (const [action, fields, expected] of [
		["settle", {}, 400],
		["unsettle", {}, 400],
		["unsnooze", { base_version: "1:0:settled" }, 400],
		["unsnooze", { until }, 400],
		["unsnooze", { item_id: `notification:${randomUUID()}` }, 404],
		["snooze", { until: "2001-01-01T06:00:00Z" }, 422],
		["set-waiting", { target: waiting.target }, 400],
	] as const) {
		const [status] = await command(
			{ item_id, base_version, ...fields },
			action,
		);
		assert.equal(status, expected, action);
	}
});
