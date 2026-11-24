import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { nameOldRecords } from "./old-record-names.ts";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, request } = doorTest();
const joe = randomUUID();
const dental = randomUUID();
const doctor = randomUUID();
const deal = randomUUID();
const note = randomUUID();
const oldClient = randomUUID();
const lead = randomUUID();
const leadNote = randomUUID();
const caller = { user: "joe" };
type Link = { text: string; url: string };
type Detail = {
	thread: { text: string }[];
	next_actions: {
		display_title: string;
		display_instruction: string;
		description: string;
	}[];
	record_links: Link[];
};
type Client = { record: { notes: string; record_links: Link[] } };
const links = [
	{ text: "Example Dental", url: `/relationships?node=party:${dental}` },
	{ text: "Dr. Pat Example", url: `/relationships?node=party:${doctor}` },
];

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into how_found (slug, label) values ('inbound', 'Inbound');
		insert into party (id, kind, name) values ('${joe}', 'person', 'Example Partner'),
			('${doctor}', 'person', 'Dr. Pat Example');
		insert into party (id, kind, name, how_found) values ('${dental}', 'company', 'Example Dental', 'inbound'),
			('${lead}', 'person', 'Example Lead', 'inbound');
		insert into app_user (id, slug) values ('${joe}', 'joe');
		insert into role (slug, label) values ('client', 'Client'), ('lead', 'Lead');
		insert into stage (role, slug, label) values ('lead', 'new', 'New');
		insert into party_role (party_id, role, stage) values ('${dental}', 'client', null), ('${lead}', 'lead', 'new');
		insert into client (party_id) values ('${dental}');
		insert into outside_id (source, value, party_id) values
			('old_system_ref', 'C-013', '${dental}'), ('old_system_ref', 'L-032', '${doctor}'),
			('old_system', '${oldClient}', '${dental}');
		insert into deal_kind (slug, label) values ('lease', 'Lease');
		insert into phase (slug, label) values ('research', 'Research');
		insert into deal (id, name, kind, owner_user_id) values ('${deal}', 'Example lease', 'lease', '${joe}');
		insert into deal_party (deal_id, party_id, role) values ('${deal}', '${dental}', 'client');
		insert into deal_phase_change (deal_id, happened_at, phase) values ('${deal}', '2026-01-01', 'research');
		insert into activity (id, kind, happened_at, summary) values
			('${note}', 'note', '2026-01-02T16:00:00Z',
				'Called C-013 about the lease. L-999 never answered; the space is Suite C-101.'),
			(md5('old_system:client:${oldClient}:notes')::uuid, 'note', '2026-01-03T16:00:00Z', 'Referred by L-032.'),
			('${leadNote}', 'note', '2026-01-04T16:00:00Z', 'Wants Suites C-101 and C-102 near C-013.');
		insert into activity_about (activity_id, deal_id, party_id) values
			('${note}', '${deal}', null), ('${leadNote}', null, '${lead}');
		insert into next_step (what, item_title, source_ref, owner_party_id, deal_id) values
			('Send C-013 the plan', 'Plan review (L-032)', 'example-item', '${joe}', '${deal}');
		commit;`);
});
after(cleanup);

async function read<Body>(path: string, bindings: Record<string, string>) {
	const response = await request(caller, path, { method: "GET" }, bindings);
	assert.equal(response.status, 200, await response.clone().text());
	return (await response.json()) as Body;
}

test("the deal page names old record codes in notes and steps, with where each opens", async () => {
	const detail = await read<Detail>(`deals/${deal}`, {
		DEALS_READ_SCHEMA: "next",
	});
	assert.deepEqual(
		detail.thread.map(({ text }) => text),
		[
			"Called Example Dental about the lease. An old record never answered; the space is Suite C-101.",
		],
	);
	const [step] = detail.next_actions;
	assert.ok(step);
	assert.equal(step.display_title, "Plan review (Dr. Pat Example)");
	assert.equal(step.display_instruction, "Send Example Dental the plan");
	assert.equal(step.description, "Send C-013 the plan");
	assert.deepEqual(
		[...detail.record_links].sort((a, b) => a.text.localeCompare(b.text)),
		[links[1], links[0]],
	);
	const { rows } = await db.query(
		`select summary from activity where id = '${note}'`,
	);
	assert.match(rows[0].summary, /^Called C-013 /);
});

test("the client drawer names old record codes in its notes", async () => {
	const { record } = await read<Client>(
		`clients/${dental}?contract=vendor-directory.v2`,
		{ DIRECTORY_READ_SCHEMA: "next" },
	);
	assert.equal(record.notes, "Referred by Dr. Pat Example.");
	assert.deepEqual(record.record_links, [links[1]]);
});

test("the lead drawer names old record codes in its notes and plans", async () => {
	const { detail } = await read<{
		detail: { notes: string; plans: string; record_links: Link[] };
	}>(`leads?workspace=leads&lead_id=${lead}`, { LEADS_READ_SCHEMA: "next" });
	const named = "Wants Suites C-101 and C-102 near Example Dental.";
	assert.deepEqual(
		[detail.notes, detail.plans, detail.record_links],
		[named, named, [links[0]]],
	);
});

test("a client's recent activity names old record codes in its entries", async () => {
	const params = new URLSearchParams({ query: "Example Dental", limit: "20" });
	const { catch_up } = await read<{
		catch_up: { timeline: { summary: string }[] };
	}>(`recent-activity?${params}`, { ACTIVITY_READ_SCHEMA: "next" });
	assert.deepEqual(catch_up.timeline.map(({ summary }) => summary).sort(), [
		"Called Example Dental about the lease. An old record never answered; the space is Suite C-101.",
		"Send Example Dental the plan",
	]);
});

test("only a copied code reads as a record", () => {
	const kept = [
		"Toured Level P-2, Space C-101, Lot P-12 and Floor L-2.",
		"Bay C-4, Apt C-3, Office C-210 and Ste. C-1010 are open.",
		"Suites C-101 and C-102, Units #L-201, L-202 and P-203 are listed.",
		"The V-8 runs; parking is in lot P-1200.",
		"Signed 2026-01-02; call 555-0100 ext. 12; rent is $1,200-1,450.",
		"Mail C-013@example.test or see example.test/clients/C-013?ref=L-032&id=P-0010.",
		"Open https://example.test/#C-013 and file=V-CPA-006 or X-C-013.",
		"See https://example.test/view?ids=C-013,L-032 and ?q=Dental+C-013.",
		"Files /a.C-013, /(C-013) and x/C-013;L-032 moved.",
		"Codes like C-13, C-01300 and c-013 are not copied codes.",
	];
	assert.deepEqual(
		kept.map((text) => nameOldRecords(text, new Map())),
		kept,
	);
	assert.equal(
		nameOldRecords("C-013 met T-123, V-CPA-006 and P-0010 (L-032).", new Map()),
		"An old record met an old record, an old record and an old record (an old record).",
	);
});
