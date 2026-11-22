import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const [
	joe,
	dell,
	deal,
	other,
	parked,
	item,
	sent,
	done,
	deadline,
	reply,
	privateReply,
	outgoing,
	lease,
	version,
	property,
	file,
	client,
] = Array.from({ length: 17 }, () => randomUUID());
const job = { job: "cadence" };
const read = (path: string) => save(job, path, {}, "GET");
const watchAs = (subscriber: string, since: string) =>
	read(
		`deal-watches/deal/${deal}?subscriber=${subscriber}&since=${encodeURIComponent(since)}`,
	);

async function watchWatermark() {
	const {
		rows: [watermark],
	} = await db.query<{ since: string }>(
		"select to_jsonb(clock_timestamp()) #>> '{}' as since",
	);
	assert.ok(watermark);
	return watermark.since;
}

before(async () => {
	await setup();
	await db
		.query(`
		begin;
		select set_config('engine.job', 'old_system', true);
		insert into job (slug, label) values ('cadence', 'Example nightly job');
		insert into phase (slug, label) values ('research', 'Research'), ('touring', 'Touring'), ('negotiation', 'Negotiation');
		insert into party (id, kind, name) values ('${joe}', 'person', 'Example Partner'), ('${dell}', 'person', 'Other Partner');
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell');
		insert into party_email (party_id, address, label) values ('${joe}', 'partner@example.test', 'work');
		select set_config('engine.job', '', true), set_config('engine.user_id', '${joe}', true);
		insert into deal (id, name, owner_user_id, parking_reason) values
			('${deal}', 'Example Deal', '${joe}', null),
			('${other}', 'Other Deal', '${joe}', null),
			('${parked}', 'Parked Deal', '${joe}', 'client_paused');
		insert into critical_date (id, deal_id, kind, due_on, source)
			values ('${deadline}', '${deal}', 'loi_expiry', '2000-01-02', 'Example offer');
		update critical_date set status = 'open' where id = '${deadline}';
		insert into next_step (id, deal_id, what, item_title, source_ref, due_on, resolution) values
			('${item}', '${deal}', 'Example checklist', 'Read floor plan', 'example:item', '2000-01-01', null),
			('${sent}', '${deal}', 'Example checklist', 'Review offer', 'example:sent', '2000-01-02', null),
			('${done}', '${deal}', 'Example checklist', 'Check date', 'example:done', '2000-01-03', 'done'),
			(gen_random_uuid(), '${deal}', 'Example checklist', 'Check estimate', chr(9), '2000-01-03', null),
			(gen_random_uuid(), '${parked}', 'Example checklist', 'Read floor plan', 'example:item', '2000-01-01', null);
		insert into home_update (user_id, deal_id, what, checklist_item_ref, due_on)
			values ('${joe}', '${deal}', 'Example reminder', 'deal-item:${sent}', '2000-01-02');
		insert into activity (id, kind, happened_at) values
			('${reply}', 'email', '1999-01-01'), ('${privateReply}', 'email', '1999-01-01'), ('${outgoing}', 'email', '1999-01-01');
		insert into email (activity_id, message_id, sender, subject, body) values
			('${reply}', 'reply@example.test', 'sender@example.test', 'Example reply', 'Example text'),
			('${privateReply}', 'private@example.test', 'sender@example.test', 'Example reply', 'Example text'),
			('${outgoing}', 'outgoing@example.test', 'partner@example.test', 'Example reply', 'Example text');
		insert into email_mailbox (activity_id, user_id) values
			('${reply}', '${joe}'), ('${privateReply}', '${dell}'), ('${outgoing}', '${joe}');
		insert into activity_about (activity_id, deal_id) select id, '${deal}' from activity;
		insert into how_found (slug, label) values ('referral', 'Referral');
		insert into party (id, kind, name, how_found) values ('${client}', 'company', 'Example Clinic', 'referral');
		insert into role (slug, label) values ('client', 'Client');
		insert into party_role (party_id, role) values ('${client}', 'client');
		insert into deal_party (deal_id, party_id, role) values ('${deal}', '${client}', 'client');
		insert into property (id, address) values ('${property}', '100 Example Way');
		insert into deal_property (deal_id, property_id) values ('${deal}', '${property}');
		insert into lease (id, party_id, property_id, deal_id) values ('${lease}', '${client}', '${property}', '${deal}');
		insert into document (id, name, r2_key) values ('${file}', 'Example lease', 'lease.pdf');
		insert into lease_version (id, lease_id, version, document_id, expiration_on)
			values ('${version}', '${lease}', 1, '${file}', '2030-01-01');
		insert into lease_option (lease_version_id, number, kind, notice_on, terms)
			values ('${version}', 1, 'renewal', '2029-01-01', 'Example renewal option');
		update deal set owner_user_id = '${dell}' where id in ('${deal}', '${other}');
		select set_config('engine.user_id', '${dell}', true);
		update deal set owner_user_id = '${joe}', name = 'Renamed Deal' where id = '${deal}';
		commit;
	`)
		.catch(async (error: unknown) => {
			await db.query("rollback");
			throw error;
		});
});
after(cleanup);

test("the nightly checklist read names the deal owner and returns only unqueued deadlines", async () => {
	const [status, body] = await read(`deals/${deal}/checklist-reminders`);
	assert.equal(status, 200);
	assert.equal(body.owner_user_id, joe);
	assert.equal(body.owner, "joe");
	assert.deepEqual(body.items, [
		{
			item_ref: `critical-date:${deadline}`,
			title: "LOI expiry",
			due_on: "2000-01-02",
		},
		{
			item_ref: `deal-item:${item}`,
			title: "Read floor plan",
			due_on: "2000-01-01",
		},
	]);
	const [parkedStatus, parkedBody] = await read(
		`deals/${parked}/checklist-reminders`,
	);
	assert.equal(parkedStatus, 200);
	assert.deepEqual(parkedBody.items, []);
});

test("a deal watch sees both owner edits and only newly filed inbound mail for its subscriber", async () => {
	const [status, body] = await read(
		`deal-watches/deal/${deal}?subscriber=joe&since=2000-01-01T00:00:00Z`,
	);
	assert.equal(status, 200);
	assert.deepEqual(body.reply_activity_ids, [reply]);
	assert.ok(Array.isArray(body.changes));
	assert.deepEqual(
		body.changes
			.filter(
				(change) =>
					change.field === "owner_user_id" && change.action === "update",
			)
			.map(({ record, old_value, new_value, actor }) => ({
				record,
				old_value,
				new_value,
				actor,
			})),
		[
			{ record: { id: deal }, old_value: joe, new_value: dell, actor: "joe" },
			{ record: { id: deal }, old_value: dell, new_value: joe, actor: "dell" },
		],
	);
	assert.equal(
		body.changes.some((change) => change.field === "name"),
		false,
	);
});

for (const startingPhase of [null, "research"]) {
	test(`a deal watch reports each phase move from ${startingPhase ?? "no phase"}`, async () => {
		const watchedDeal = randomUUID();
		await db.query(`
			begin;
			select set_config('engine.job', 'old_system', true);
			insert into deal (id, name, owner_user_id) values ('${watchedDeal}', 'Example ${startingPhase ?? "New"} Deal', '${joe}');
			${
				startingPhase
					? `insert into deal_phase_change (deal_id, happened_at, phase)
				values ('${watchedDeal}', '2000-01-01T06:00:00.000001Z', '${startingPhase}');`
					: ""
			}
			commit;
		`);
		const move = async (from: string | null, to: string) => {
			const [status, body] = await save(
				{ user: "joe" },
				`deals/${watchedDeal}/changes`,
				{
					idempotency_key: randomUUID(),
					seen_change_id: 0,
					phase: { from, to, on: "2000-01-01" },
				},
			);
			assert.equal(status, 200, JSON.stringify(body));
		};
		const phaseMoves = async (since: string) => {
			const [status, body] = await read(
				`deal-watches/deal/${watchedDeal}?subscriber=joe&since=${encodeURIComponent(since)}`,
			);
			assert.equal(status, 200);
			assert.ok(Array.isArray(body.changes));
			return body.changes
				.filter(
					({ table_name, field }) =>
						table_name === "deal_phase_change" && field === "phase",
				)
				.map(({ old_value, new_value }) => [old_value, new_value]);
		};

		const beforeFirst = await watchWatermark();
		await move(startingPhase, "touring");
		const afterFirst = await watchWatermark();
		await move("touring", "negotiation");
		await move("negotiation", "touring");
		const laterMoves = [
			["touring", "negotiation"],
			["negotiation", "touring"],
		];
		assert.deepEqual(await phaseMoves(beforeFirst), [
			[startingPhase, "touring"],
			...laterMoves,
		]);
		assert.deepEqual(await phaseMoves(afterFirst), laterMoves);
	});
}

test("a lease watch reads the lease dates, options and linked deal history", async () => {
	const path = `deal-watches/lease/${lease}?subscriber=joe&since=`;
	const [status, body] = await read(`${path}2000-01-01T00:00:00Z`);
	assert.equal(status, 200);
	assert.equal(body.href, `/clients?record=${client}`);
	assert.equal(body.deal_id, deal);
	assert.ok(Array.isArray(body.changes));
	assert.ok(
		body.changes.some(
			(change) =>
				change.record.id === version &&
				change.field === "expiration_on" &&
				change.new_value === "2030-01-01",
		),
	);
	assert.ok(
		body.changes.some(
			(change) =>
				change.record.lease_version_id === version &&
				change.field === "notice_on" &&
				change.new_value === "2029-01-01",
		),
	);
	assert.ok(
		body.changes.some(
			(change) => change.record.id === deal && change.field === "owner_user_id",
		),
	);
	const [, since] = await read(`${path}9999-01-01T00:00:00Z`);
	assert.deepEqual(since.changes, []);
	assert.deepEqual(since.reply_activity_ids, []);
});

test("a second mailbox sees a filed reply when its copy arrives after the watermark", async () => {
	const since = await watchWatermark();
	const [beforeStatus, before] = await watchAs("dell", since);
	assert.equal(beforeStatus, 200);
	assert.deepEqual(before.reply_activity_ids, []);
	await db.query(`
		begin;
		select set_config('engine.job', 'mail_capture', true), set_config('engine.user_id', '${dell}', true);
		insert into email_mailbox (activity_id, user_id) values ('${reply}', '${dell}');
		commit;
	`);
	const [status, body] = await watchAs("dell", since);
	assert.equal(status, 200);
	assert.deepEqual(body.reply_activity_ids, [reply]);
});

test("a deleted ordinary step keeps its old date and actor in watch history", async () => {
	const stepId = randomUUID();
	await db.query(`
		begin;
		select set_config('engine.user_id', '${joe}', true);
		insert into next_step (id, deal_id, what, due_on) values ('${stepId}', '${deal}', 'Example call', '2000-01-01');
		commit;
	`);
	const since = await watchWatermark();
	await db.query(`
		begin;
		set local role engine;
		select set_config('engine.user_id', '${joe}', true);
		delete from next_step where id = '${stepId}';
		commit;
	`);
	const [status, body] = await watchAs("joe", since);
	assert.equal(status, 200);
	assert.ok(Array.isArray(body.changes));
	const dates = body.changes.filter(
		(change) => change.record.id === stepId && change.field === "due_on",
	);
	assert.deepEqual(
		dates.map(({ action, old_value, new_value, actor }) => ({
			action,
			old_value,
			new_value,
			actor,
		})),
		[
			{
				action: "delete",
				old_value: "2000-01-01",
				new_value: null,
				actor: "joe",
			},
		],
	);
});

test("the watch follows proposal detail visibility for step-completion reviews", async () => {
	const [sourceId, stepId, proposalId] = Array.from({ length: 3 }, () =>
		randomUUID(),
	);
	const since = await watchWatermark();
	await db.query(`
		begin;
		select set_config('engine.user_id', '${dell}', true);
		insert into next_step (id, deal_id, what, due_on) values ('${stepId}', '${deal}', 'Example call', '2000-01-01');
		insert into activity (id, kind, happened_at, summary) values ('${sourceId}', 'note', '2001-01-01', 'Example note');
		insert into activity_about (activity_id, deal_id) values ('${sourceId}', '${deal}');
		select set_config('engine.job', 'cadence', true);
		insert into proposal (id, kind, activity_id, activity_kind, deal_id, next_step_id, evidence, proposed_by_job)
			values ('${proposalId}', 'next_step_done', '${sourceId}', 'note', '${deal}', '${stepId}', 'Example evidence', 'cadence');
		commit;
	`);
	for (const [subscriber, detailStatus] of [
		["dell", 200],
		["joe", 404],
	] as const) {
		const [proposalStatus] = await save(
			{ user: subscriber },
			`proposals/${proposalId}`,
			{},
			"GET",
		);
		assert.equal(proposalStatus, detailStatus);
		const [status, body] = await watchAs(subscriber, since);
		assert.equal(status, 200);
		assert.ok(Array.isArray(body.changes));
		assert.equal(
			body.changes.some((change) => change.record.id === proposalId),
			detailStatus === 200,
			subscriber,
		);
	}
});
