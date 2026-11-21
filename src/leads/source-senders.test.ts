import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, save, request } = doorTest();
const job = { job: "mail_capture" };
const fields = {
	name: "Prospect name",
	request: "Requested help",
	email: "Prospect email",
};

before(setup);
after(cleanup);

test("the jobs door returns lead-source senders in name order and requires Access", async () => {
	const unauthorized = await request(job, "leads/sources", {
		method: "GET",
		headers: { "Cf-Access-Jwt-Assertion": "" },
	});
	assert.equal(unauthorized.status, 401);
	assert.equal((await save(job, "leads/sources", {}, "GET"))[0], 200);

	await db.query(
		`insert into lead_source_sender (address, domain, name, fields) values
			('notices@example.test', null, 'Second Source', null),
			(null, 'leads.example.test', 'First Source', $1)`,
		[fields],
	);
	try {
		assert.deepEqual(await save(job, "leads/sources", {}, "GET"), [
			200,
			{
				senders: [
					{
						address: null,
						domain: "leads.example.test",
						name: "First Source",
						fields,
					},
					{
						address: "notices@example.test",
						domain: null,
						name: "Second Source",
						fields: null,
					},
				],
			},
		]);
	} finally {
		await db.query("delete from lead_source_sender");
	}
});

test("the database requires exactly one address or hostname and a name", async () => {
	for (const [address, domain, name] of [
		["notices@example.test", "leads.example.test", "Example Source"],
		[null, null, "Example Source"],
		[null, "@example.test", "Example Source"],
		[null, "Leads.example.test", "Example Source"],
		[null, "leads-.example.test", "Example Source"],
		[null, "leads.example.test", " \t"],
	]) {
		await assert.rejects(
			db.query(
				"insert into lead_source_sender (address, domain, name) values ($1, $2, $3)",
				[address, domain, name],
			),
			{ code: "23514" },
		);
	}
});

test("the database rejects duplicate lead-source addresses and domains", async () => {
	await db.query("begin");
	try {
		for (const [address, domain] of [
			["same@example.test", null],
			[null, "same.example.test"],
		]) {
			const insert = (name: string) =>
				db.query(
					"insert into lead_source_sender (address, domain, name) values ($1, $2, $3)",
					[address, domain, name],
				);
			await insert("Example Source");
			await db.query("savepoint duplicate_sender");
			await assert.rejects(insert("Another Name"), { code: "23505" });
			await db.query("rollback to savepoint duplicate_sender");
		}
	} finally {
		await db.query("rollback");
	}
});

test("field labels must have known keys, nonblank string values, a name and a request", async () => {
	for (const fieldLabels of [
		{ ...fields, unknown: "Unknown label" },
		{ ...fields, phone: " \t" },
		{ ...fields, phone: "Phone: " },
		{ ...fields, phone: 123 },
		{ ...fields, phone: null },
		{ email: fields.email, request: fields.request },
		{ name: fields.name, email: fields.email },
		[fields],
		null,
	]) {
		await assert.rejects(
			db.query(
				"insert into lead_source_sender (domain, name, fields) values ($1, $2, $3)",
				["leads.example.test", "Example Source", JSON.stringify(fieldLabels)],
			),
			{ code: "23514" },
			JSON.stringify(fieldLabels),
		);
	}
});
