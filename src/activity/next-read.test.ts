import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, request } = doorTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [joe, client, company, coworker, formerCompany, deal, otherDeal] = [
	id(1),
	id(2),
	id(3),
	id(4),
	id(5),
	id(6),
	id(7),
];
const [group, frontDesk, leaving, joining] = [id(20), id(21), id(22), id(23)];
const [dell, sharedDeal] = [id(24), id(25)];

before(async () => {
	await setup();
	await db.query(`
		grant select on all tables in schema public to engine_reader;
		insert into public.actor (id, slug, kind, display_name) values ('${joe}', 'joe', 'human', 'Example Partner One');
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${joe}', 'person', 'Example Partner One'), ('${client}', 'person', 'Example Dentist'),
			('${company}', 'company', 'Example Dental Group'), ('${coworker}', 'person', 'Example Office Manager'),
			('${formerCompany}', 'company', 'Example Former Practice'),
			('${group}', 'company', 'Example Imaging Group'), ('${frontDesk}', 'person', 'Example Front Desk'),
			('${leaving}', 'person', 'Example Radiologist'), ('${joining}', 'person', 'Example Technologist'),
			('${dell}', 'person', 'Example Partner Two');
		insert into how_found (slug, label) values ('referral', 'Referral');
		update party set how_found = 'referral' where id in ('${client}', '${group}');
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell');
		insert into role (slug, label) values ('client', 'Client');
		insert into party_role (party_id, role) values ('${client}', 'client'), ('${group}', 'client');
		insert into client (party_id) values ('${client}'), ('${group}');
		insert into deal (id, name, owner_user_id) values
			('${deal}', 'Example Suite Lease', '${joe}'), ('${otherDeal}', 'Example Unrelated Lease', '${joe}'),
			('${sharedDeal}', 'Example Shared Lease', '${joe}');
		insert into deal_party (deal_id, party_id, role) values ('${deal}', '${client}', 'client');
		insert into party_company (person_id, company_id, started_on, ended_on) values
			('${client}', '${company}', null, null), ('${coworker}', '${company}', '2026-01-01', null),
			('${client}', '${formerCompany}', '2020-01-01', '2021-01-01'),
			('${frontDesk}', '${group}', null, null), ('${leaving}', '${group}', null, '2026-11-24'),
			('${joining}', '${group}', '2026-11-24', null);
		insert into activity (id, kind, happened_at, summary) values
			('${id(10)}', 'call', '2026-11-01T12:00:00Z', 'Called the dentist'),
			('${id(11)}', 'note', '2026-11-02T12:00:00Z', 'Toured the suite'),
			('${id(12)}', 'meeting', '2026-11-03T12:00:00Z', 'Met the group'),
			('${id(13)}', 'call', '2026-11-04T12:00:00Z', 'Called the office manager'),
			('${id(14)}', 'note', '2026-11-05T12:00:00Z', 'Old practice note'),
			('${id(15)}', 'note', '2026-11-06T12:00:00Z', 'Unrelated deal note'),
			('${id(16)}', 'email', '2026-11-07T12:00:00Z', 'Sent the plan to the dentist'),
			('${id(17)}', 'call', '2026-11-09T12:00:00Z', 'Called the front desk'),
			('${id(18)}', 'call', '2026-11-10T12:00:00Z', 'Called the radiologist'),
			('${id(19)}', 'call', '2026-11-11T12:00:00Z', 'Called the technologist');
		insert into activity_about (activity_id, deal_id, party_id) values
			('${id(10)}', null, '${client}'), ('${id(11)}', '${deal}', null),
			('${id(12)}', null, '${company}'), ('${id(13)}', null, '${coworker}'),
			('${id(14)}', null, '${formerCompany}'), ('${id(15)}', '${otherDeal}', null),
			('${id(16)}', '${deal}', null), ('${id(16)}', null, '${client}'),
			('${id(17)}', null, '${frontDesk}'), ('${id(18)}', null, '${leaving}'),
			('${id(19)}', null, '${joining}');
		insert into next_step (deal_id, what, created_at) values
			('${deal}', 'Send the lease draft', '2026-11-08T12:00:00Z');
		insert into next_step (deal_id, what, owner_party_id, created_at) values
			('${sharedDeal}', 'Run the rent comparison', '${joe}', '2026-11-12T12:00:00Z'),
			('${sharedDeal}', 'Run the rent comparison', '${dell}', '2026-11-13T12:00:00Z');
	`);
});
after(cleanup);

async function recent(query: string, limit = 20) {
	const params = new URLSearchParams({ query, limit: String(limit) });
	const response = await request(
		{ user: "joe" },
		`recent-activity?${params}`,
		{ method: "GET" },
		{ ACTIVITY_READ_SCHEMA: "next" },
	);
	const body = await response.json();
	assert.equal(response.status, 200, JSON.stringify(body));
	return body as { catch_up: { timeline: Record<string, unknown>[] } };
}

test("a person client's history includes its deals and current company but not its coworkers", async () => {
	const { catch_up } = await recent("Example Dentist");
	assert.deepEqual(
		catch_up.timeline.map(({ summary, deal_id, filed_on }) => ({
			summary,
			deal_id,
			filed_on,
		})),
		[
			{
				summary: "Send the lease draft",
				deal_id: deal,
				filed_on: { kind: "deal", name: "Example Suite Lease" },
			},
			{
				summary: "Sent the plan to the dentist",
				deal_id: deal,
				filed_on: null,
			},
			{
				summary: "Met the group",
				deal_id: null,
				filed_on: { kind: "company", name: "Example Dental Group" },
			},
			{
				summary: "Toured the suite",
				deal_id: deal,
				filed_on: { kind: "deal", name: "Example Suite Lease" },
			},
			{ summary: "Called the dentist", deal_id: null, filed_on: null },
		],
	);
	assert.equal(
		(await recent("Example Dentist", 2)).catch_up.timeline.length,
		2,
	);
});

const summaries = (timeline: Record<string, unknown>[]) =>
	timeline.map(({ summary, filed_on }) => ({ summary, filed_on }));

test("a company client's history includes its current people", async (t) => {
	t.mock.timers.enable({
		apis: ["Date"],
		now: Date.parse("2026-11-24T18:00:00Z"),
	});
	const { catch_up } = await recent("Example Imaging Group");
	assert.deepEqual(summaries(catch_up.timeline), [
		{
			summary: "Called the technologist",
			filed_on: { kind: "person", name: "Example Technologist" },
		},
		{
			summary: "Called the front desk",
			filed_on: { kind: "person", name: "Example Front Desk" },
		},
	]);
});

test("a company's current people are counted on the partners' Chicago day", async (t) => {
	// 9pm in Chicago on Nov 23 is already Nov 24 in UTC.
	t.mock.timers.enable({
		apis: ["Date"],
		now: Date.parse("2026-11-24T03:00:00Z"),
	});
	const { catch_up } = await recent("Example Imaging Group");
	assert.deepEqual(summaries(catch_up.timeline), [
		{
			summary: "Called the radiologist",
			filed_on: { kind: "person", name: "Example Radiologist" },
		},
		{
			summary: "Called the front desk",
			filed_on: { kind: "person", name: "Example Front Desk" },
		},
	]);
});

test("a deal's history stays the deal's own", async () => {
	const { catch_up } = await recent("Example Suite Lease");
	assert.deepEqual(
		catch_up.timeline.map(({ summary, filed_on }) => ({ summary, filed_on })),
		[
			{ summary: "Send the lease draft", filed_on: null },
			{ summary: "Sent the plan to the dentist", filed_on: null },
			{ summary: "Toured the suite", filed_on: null },
		],
	);
});

test("each partner's step names its owner", async () => {
	const { catch_up } = await recent("Example Shared Lease");
	assert.deepEqual(
		catch_up.timeline.map(({ summary, step_owner }) => ({
			summary,
			step_owner,
		})),
		[
			{ summary: "Run the rent comparison", step_owner: "dell" },
			{ summary: "Run the rent comparison", step_owner: "joe" },
		],
	);
	const dentist = await recent("Example Dentist");
	assert.deepEqual(
		dentist.catch_up.timeline.map(({ step_owner }) => step_owner),
		[null, null, null, null, null],
	);
});
