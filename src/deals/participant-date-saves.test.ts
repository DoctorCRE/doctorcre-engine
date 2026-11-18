import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { type Caller, doorTest } from "../test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const alex = randomUUID();
const blair = randomUUID();
const [company, deal] = [randomUUID(), randomUUID()];
const partner = { user: "alex" };
const datePath = `deals/${deal}/critical-dates`;
const participants = `deals/${deal}/parties`;
const key = () => ({ idempotency_key: randomUUID() });

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${alex}', 'person', 'Alex Example'), ('${blair}', 'person', 'Blair Example'),
			('${company}', 'company', 'Sample Company');
		insert into app_user (id, slug) values ('${alex}', 'alex'), ('${blair}', 'blair');
		insert into role (slug, label) values
			('market_agent', 'Market agent'), ('lender', 'Lender'), ('support', 'Support');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Deal', '${alex}');
		commit;`);
});
after(cleanup);

async function saveAndRetry(
	path: string,
	args: object,
	status: number,
	caller: Caller = partner,
) {
	const [saved, answer] = await save(caller, path, args);
	assert.equal(saved, status, JSON.stringify(answer));
	assert.deepEqual(await save(caller, path, args), [
		status,
		{ ...answer, replayed: true },
	]);
	return answer;
}

const dateFields = {
	kind: "loi_expiry",
	due_on: "2027-02-10",
	source: "Sample offer",
	note: "Sample note",
};

async function addDate() {
	const [status, answer] = await save(partner, datePath, {
		...key(),
		...dateFields,
	});
	assert.equal(status, 201, JSON.stringify(answer));
	assert.equal(answer.status, "open");
	assert.ok(typeof answer.critical_date_id === "string");
	return answer.critical_date_id;
}

async function proposeDate() {
	const id = randomUUID();
	await db.query(`begin; select set_config('engine.job', 'agent', true);
		insert into critical_date (id, deal_id, kind, due_on, source)
		values ('${id}', '${deal}', 'loi_expiry', '2027-02-10', 'Offer round');
		commit;`);
	return id;
}

test("add a person and a company in their roles once", async () => {
	for (const [party_id, role] of [
		[blair, "market_agent"],
		[company, "lender"],
	] as const) {
		const answer = await saveAndRetry(
			participants,
			{ ...key(), party_id, role },
			201,
		);
		assert.deepEqual(answer, { deal_id: deal, party_id, role });
		const rows = await db.query(
			"select changed_by_user_id from deal_party where deal_id = $1 and party_id = $2 and role = $3",
			[deal, party_id, role],
		);
		assert.deepEqual(rows.rows, [{ changed_by_user_id: alex }]);
	}
});

test("remove only the requested role, keep its history and replay after removal", async () => {
	const party_id = company;
	for (const role of ["market_agent", "support"]) {
		const [status, answer] = await save(partner, participants, {
			...key(),
			party_id,
			role,
		});
		assert.equal(status, 201, JSON.stringify(answer));
	}
	const role = "support";
	const answer = await saveAndRetry(
		`${participants}/remove`,
		{ ...key(), party_id, role },
		200,
	);
	assert.deepEqual(answer, { deal_id: deal, party_id, role });
	const remaining = await db.query(
		"select role from deal_party where deal_id = $1 and party_id = $2 and role in ('market_agent', 'support')",
		[deal, party_id],
	);
	assert.deepEqual(remaining.rows, [{ role: "market_agent" }]);
	const history = await db.query(
		`select changed_by_user_id from change where table_name = 'deal_party' and action = 'delete'
			and record = jsonb_build_object('deal_id', $1::uuid, 'party_id', $2::uuid, 'role', $3::text)`,
		[deal, party_id, role],
	);
	assert.deepEqual(history.rows, [{ changed_by_user_id: alex }]);
});

test("refuse removal of someone absent from the deal", async () => {
	const [status, body] = await save(partner, `${participants}/remove`, {
		...key(),
		party_id: alex,
		role: "support",
	});
	assert.deepEqual([status, body.error], [404, "not_found"]);
});

test("add a sourced critical date once and stamp the adding partner's confirmation", async () => {
	const fields = {
		...dateFields,
		kind: "phase_effective_date",
		source: "Sample phase record",
		note: null,
	};
	const answer = await saveAndRetry(datePath, { ...key(), ...fields }, 201, {
		user: "blair",
	});
	assert.equal(answer.status, "open");
	const rows = await db.query(
		`select id, kind, due_on::text, source, note, status, confirmed_by_user_id,
			confirmed_at = created_at as confirmed_on_add, changed_by_user_id
			from critical_date where deal_id = $1 and source = $2`,
		[deal, fields.source],
	);
	assert.deepEqual(rows.rows, [
		{
			id: answer.critical_date_id,
			...fields,
			status: "open",
			confirmed_by_user_id: blair,
			confirmed_on_add: true,
			changed_by_user_id: blair,
		},
	]);
});

test("confirm a proposal once and record the partner", async () => {
	const path = `critical-dates/${await proposeDate()}/confirm`;
	const answer = await saveAndRetry(path, key(), 200);
	assert.equal(answer.status, "open");
	const result = await db.query(
		"select status, confirmed_by_user_id, confirmed_at from critical_date where id = $1",
		[answer.critical_date_id],
	);
	assert.equal(result.rows[0]?.status, "open");
	assert.equal(result.rows[0]?.confirmed_by_user_id, alex);
	assert.ok(result.rows[0]?.confirmed_at);
	const [status, conflict] = await save(partner, path, key());
	assert.deepEqual(
		[status, conflict.error, conflict.status],
		[409, "version_conflict", "open"],
	);
});

for (const [initial, resolution] of [
	["proposed", "dropped"],
	["open", "dropped"],
	["open", "done"],
	["open", "passed"],
] as const) {
	test(`resolve a ${initial} date as ${resolution} once and keep any confirmation`, async () => {
		const id = initial === "open" ? await addDate() : await proposeDate();
		const read = async () =>
			(
				await db.query(
					`select status, confirmed_by_user_id, confirmed_at::text, resolved_by_user_id,
				resolved_at is not null as resolved, resolution_reason from critical_date where id = $1`,
					[id],
				)
			).rows[0];
		const before = await read();
		const reason = "Sample reason";
		const answer = await saveAndRetry(
			`critical-dates/${id}/resolve`,
			{ ...key(), resolution, reason },
			200,
			{ user: "blair" },
		);
		assert.deepEqual(answer, { critical_date_id: id, status: resolution });
		assert.deepEqual(await read(), {
			status: resolution,
			confirmed_by_user_id: before.confirmed_by_user_id,
			confirmed_at: before.confirmed_at,
			resolved_by_user_id: blair,
			resolved: true,
			resolution_reason: reason,
		});
	});
}

test("refuse a job confirming a critical date even when it works for a partner", async () => {
	const [status, body] = await save(
		{ job: "agent", for_user: "alex" },
		`critical-dates/${await proposeDate()}/confirm`,
		key(),
	);
	assert.deepEqual([status, body.error], [404, "not_found"]);
});

test("refuse a blank reason for dropping a proposed date", async () => {
	const path = `critical-dates/${await proposeDate()}/resolve`;
	const [status, body] = await save(partner, path, {
		...key(),
		resolution: "dropped",
		reason: " \t ",
	});
	assert.deepEqual(
		[status, body.error, body.fields],
		[400, "invalid_field_value", ["reason"]],
	);
});
