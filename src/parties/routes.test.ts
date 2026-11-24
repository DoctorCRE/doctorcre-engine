import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { readSchema } from "../test-copy.ts";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const joe = { user: "joe" };
const dell = { user: "dell" };
const key = () => ({ idempotency_key: randomUUID() });
const joeId = randomUUID();
const dellId = randomUUID();
const company = randomUUID();
const copied = randomUUID();

before(async () => {
	await setup();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into party (id, kind, name) values
			('${joeId}', 'person', 'Example Partner One'), ('${dellId}', 'person', 'Example Partner Two'),
			('${company}', 'company', 'Example Dental Group'), ('${copied}', 'person', ' ');
		insert into app_user (id, slug) values ('${joeId}', 'joe'), ('${dellId}', 'dell');
		insert into party_email (party_id, address, label, is_primary) values
			('${company}', 'front@example.test', 'work', true);
		commit;`);
});
after(cleanup);

const add = (fields: object, caller = joe) =>
	save(caller, "parties", { ...key(), ...fields });
const read = (id: unknown) => save(joe, `parties/${id}`, {}, "GET");

test("a new person is stored with a primary email, a converted phone and their company", async () => {
	const args = {
		...key(),
		kind: "person",
		name: " Avery Example ",
		email: " Avery@Example.TEST ",
		phone: "(202) 555-0101 x12",
		city: "Springfield",
		company_id: company,
		title: "Office manager",
	};
	const [status, added] = await save(joe, "parties", args);
	assert.equal(status, 201, JSON.stringify(added));
	assert.deepEqual(added, {
		party_id: added.party_id,
		kind: "person",
		name: "Avery Example",
		city: "Springfield",
		email: "avery@example.test",
		phone: {
			number: "+12025550101",
			extension: "12",
			shown: "+12025550101 x12",
		},
		company: {
			company_id: company,
			name: "Example Dental Group",
			title: "Office manager",
		},
	});
	assert.deepEqual(await save(joe, "parties", args), [
		201,
		{ ...added, replayed: true },
	]);
	assert.deepEqual(await read(added.party_id), [
		200,
		{ ...added, client: null },
	]);
	const { rows } = await db.query(
		"select changed_by_user_id from party where id = $1",
		[added.party_id],
	);
	assert.deepEqual(rows, [{ changed_by_user_id: joeId }]);
});

test("a likely duplicate is offered back until the partner confirms a separate record", async () => {
	const [status, refusal] = await add({
		kind: "company",
		name: "example dental group",
	});
	assert.equal(status, 409);
	assert.partialDeepStrictEqual(refusal, {
		error: "party_exists",
		candidates: [{ id: company, name: "Example Dental Group", deal_count: 0 }],
	});
	const [byEmail, emailRefusal] = await add({
		kind: "person",
		name: "Someone Else",
		email: "FRONT@example.test",
	});
	assert.equal(byEmail, 409);
	assert.partialDeepStrictEqual(emailRefusal, {
		candidates: [{ id: company }],
	});
	const [forced] = await add({
		kind: "company",
		name: "Example Dental Group",
		force_new: true,
	});
	assert.equal(forced, 201);
});

test("an add waits for another save of the same email, then offers its record", async () => {
	const other = randomUUID();
	await db.query(`begin; set local engine.job = 'old_system';
		select pg_advisory_xact_lock(hashtextextended('race@example.test', 0));
		insert into party (id, kind, name) values ('${other}', 'person', 'Example Racer');
		insert into party_email (party_id, address, label, is_primary)
			values ('${other}', 'race@example.test', 'work', true)`);
	let finished = false;
	const pending = add({
		kind: "person",
		name: "Example Second Racer",
		email: "Race@Example.test",
	}).finally(() => {
		finished = true;
	});
	let waited = false;
	try {
		const deadline = AbortSignal.timeout(10_000);
		while (!finished && !waited) {
			deadline.throwIfAborted();
			const { rows } = await db.query(`select from pg_locks
				where locktype = 'advisory' and not granted
				and pg_backend_pid() = any(pg_blocking_pids(pid))`);
			waited = rows.length > 0;
		}
	} finally {
		await db.query("commit");
	}
	const [status, refusal] = await pending;
	assert.ok(waited, "the add must wait for the email lock");
	assert.equal(status, 409, JSON.stringify(refusal));
	assert.partialDeepStrictEqual(refusal, { candidates: [{ id: other }] });
});

test("malformed contacts, blank names and misplaced company fields are refused", async () => {
	for (const [fields, refused] of [
		[
			{ kind: "person", name: "Example Bad Email", email: "not an email" },
			["email"],
		],
		[{ kind: "person", name: "Example Bad Phone", phone: "555-01" }, ["phone"]],
		[
			{ kind: "company", name: "Example Co", company_id: company },
			["company_id"],
		],
		[{ kind: "person", name: "Example Title", title: "Owner" }, ["title"]],
		[
			{ kind: "person", name: "Example Not Company", company_id: joeId },
			["company_id"],
		],
		[{ kind: "person", name: "   " }, ["name"]],
	] as const) {
		const [status, refusal] = await add(fields);
		assert.equal(status, 400, JSON.stringify(fields));
		assert.deepEqual(refusal.fields, refused);
	}
});

test("the database refuses a blank name the engine saves, with the install applied twice", async () => {
	for (const _ of [1, 2])
		await db.query(await readSchema("allow-party-edits.sql"));
	await assert.rejects(
		db.query(`begin; set local role engine; set local engine.user_id = '${joeId}';
			update party set name = ' ' where id = '${company}'`),
		{ constraint: "party_name_saved_nonblank" },
	);
	await db.query("rollback");
});

test("an edit changes what the partner saw and refuses what changed since", async () => {
	const [, person] = await add({
		kind: "person",
		name: "Blake Example",
		email: "blake@example.test",
		phone: "2025550102",
	});
	const id = person.party_id;
	const edit = (fields: object, caller = joe) =>
		save(caller, `parties/${id}`, { ...key(), ...fields });

	const [status, edited] = await edit({
		name: { from: "Blake Example", to: "Blake Q. Example" },
		city: { from: null, to: "Shelbyville" },
		email: { from: "blake@example.test", to: "Blake.Q@Example.test" },
		phone: { from: "+12025550102", to: "+1 202 555 0103" },
	});
	assert.equal(status, 200, JSON.stringify(edited));
	assert.partialDeepStrictEqual(edited, {
		name: "Blake Q. Example",
		city: "Shelbyville",
		email: "blake.q@example.test",
		phone: { number: "+12025550103", extension: null },
	});
	const { rows } = await db.query(
		`select (select count(*)::int from party_email where party_id = $1) as emails,
			(select count(*)::int from party_phone where party_id = $1) as phones`,
		[id],
	);
	assert.deepEqual(rows, [{ emails: 1, phones: 1 }]);

	const [stale, conflict] = await edit(
		{ name: { from: "Blake Example", to: "Someone" } },
		dell,
	);
	assert.equal(stale, 409);
	assert.partialDeepStrictEqual(conflict, {
		error: "version_conflict",
		fields: ["name"],
		current: { name: "Blake Q. Example" },
	});
	const [, phoneConflict] = await edit({
		phone: { from: "+12025550102", to: null },
	});
	assert.deepEqual(phoneConflict.current, edited);

	const [taken, takenRefusal] = await edit({
		email: { from: "blake.q@example.test", to: "Front@Example.test" },
	});
	assert.equal(taken, 409);
	assert.partialDeepStrictEqual(takenRefusal, {
		error: "party_exists",
		candidates: [{ id: company }],
	});
	assert.equal(
		(
			await edit({
				email: { from: "blake.q@example.test", to: "blake.q@example.test" },
			})
		)[0],
		200,
	);
	const [shared, sharedAnswer] = await edit({
		email: { from: "blake.q@example.test", to: "front@example.test" },
		force_new: true,
	});
	assert.equal(shared, 200, JSON.stringify(sharedAnswer));
	assert.equal(sharedAnswer.email, "front@example.test");

	const [cleared, answer] = await edit({
		email: { from: "front@example.test", to: null },
		phone: { from: "+12025550103", to: null },
		city: { from: "Shelbyville", to: null },
	});
	assert.equal(cleared, 200);
	assert.partialDeepStrictEqual(answer, {
		email: null,
		phone: null,
		city: null,
	});
	assert.equal((await edit({}))[0], 400);
	assert.equal(
		(await edit({ name: { from: "Blake Q. Example", to: null } }))[0],
		400,
	);
});

test("a copied record with a blank name can be named, and an unknown one is not found", async () => {
	const [status, named] = await save(joe, `parties/${copied}`, {
		...key(),
		name: { from: "", to: "Casey Example" },
	});
	assert.equal(status, 200, JSON.stringify(named));
	assert.equal(named.name, "Casey Example");
	assert.equal((await read(randomUUID()))[0], 404);
	assert.equal(
		(
			await save(joe, `parties/${randomUUID()}`, {
				...key(),
				city: { from: null, to: "X" },
			})
		)[0],
		404,
	);
});
