import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { readSchema } from "../test-copy.ts";
import { doorTest } from "../test-door.ts";
import { vendorMeetings as route } from "./meeting-routes.ts";

const at = (hours: number) =>
	new Date(Date.now() + hours * 3_600_000).toISOString();
const ACTOR = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const ORG = "00000000-0000-4000-8000-000000000101";
const PAT = "00000000-0000-4000-8000-000000000102";
const SAM = "00000000-0000-4000-8000-000000000103";
const NEW_ORG = "00000000-0000-4000-8000-000000000201";
const NEW_CONTACT = "00000000-0000-4000-8000-000000000202";
const SEED = `set session_replication_role = replica;
	insert into public.actor (id, slug, kind, display_name) values
		('${ACTOR}', 'joe', 'human', 'Example'), ('${OTHER}', 'dell', 'human', 'Example');
	insert into public.vendor_category (slug, label, sort) values ('lender', 'Example Lender', 1);
	insert into public.party (id, kind, name, org_id, email, city, created_by, updated_by) values
		('${ORG}', 'org', 'Example Lending Co', null, null, null, '${ACTOR}', '${ACTOR}'),
		('${PAT}', 'person', 'Pat Example', '${ORG}', ' Pat@Example.TEST ', 'Austin', '${ACTOR}', '${ACTOR}'),
		('${SAM}', 'person', 'Sam Example', '${ORG}', 'sam@example.test', 'Austin', '${ACTOR}', '${ACTOR}');
	insert into public.vendor (vendor_ref, party_id, category, category_slug, offers, created_by, updated_by)
		values ('V-1', '${ORG}', 'lender', 'lender', 'Construction loans', '${ACTOR}', '${ACTOR}');
	set session_replication_role = origin;`;

const NEW_VENDOR = `
	insert into party (id, kind, name, city) values
		('${NEW_ORG}', 'company', 'Example Builders', null),
		('${NEW_CONTACT}', 'person', 'New Contact', 'Austin');
	insert into party_role (party_id, role, offers) values
		('${NEW_ORG}', 'vendor', 'Build-outs'), ('${NEW_ORG}', 'contractor', null);
	insert into party_company (person_id, company_id) values ('${NEW_CONTACT}', '${NEW_ORG}');
	insert into party_email (party_id, address, label, is_primary)
		values ('${NEW_CONTACT}', 'new-contact@example.test', 'work', true);`;
function agenda(items: object[]) {
	return {
		schema: "carr-calendar-agenda.v1",
		observed_at: at(-1),
		items: items.map((item, i) => ({
			start: at(2 + i),
			end: at(3 + i),
			...item,
		})),
		follow_up_reviews: [],
		warnings: [],
	};
}

const pat = { email: "pat@example.test" };
const newContact = { email: "new-contact@example.test" };

async function vendorMeetings(t: TestContext) {
	const door = doorTest();
	await door.setup();
	t.after(door.cleanup);
	const meetings = (search = "", user = "joe") =>
		door.request({ user }, `vendor-meetings${search}`, { method: "GET" });
	return { ...door, meetings };
}

async function seedVendors(db: ReturnType<typeof doorTest>["db"]) {
	await db.query(SEED);
	for (const file of ["copy-parties.sql", "copy-vendors.sql"])
		await db.query(`begin; ${await readSchema(file)} commit;`);
	await db.query(`begin;
		select set_config('engine.user_id', '${ACTOR}', true);
		${NEW_VENDOR}
		commit;`);
}

type Answer = {
	schema: string;
	view: string;
	total: number;
	has_more: boolean;
	next_cursor: string | null;
	items: {
		vendor_id: string;
		contact: { id: string; name: string };
		missing: string[];
		possible_meetings: { title: string }[];
	}[];
	calendar: {
		state: string;
		reason?: string;
		scheduling: { state: string; reason?: string };
	};
};
const ready = async (response: Response) => {
	assert.equal(response.status, 200);
	return (await response.json()) as Answer;
};
const people = (answer: Answer) =>
	answer.items.map((item) => [
		item.contact.name,
		item.missing,
		item.possible_meetings.map((m) => m.title),
	]);

test("vendor meetings match exact attendee and organizer emails in the signed-in partner's Outlook agenda", async (t) => {
	const { db, meetings, save } = await vendorMeetings(t);
	await seedVendors(db);
	const own = agenda([
		{ title: "Matched attendee", attendees: [{ email: "pAt@Example.TEST" }] },
		{ title: "Matched organizer", organizer: { email: "PAT@EXAMPLE.TEST" } },
		{
			title: "Different address",
			attendees: [{ email: "pat+other@example.test" }],
		},
		{ title: "New vendor meeting", attendees: [newContact] },
	]);
	const other = agenda([{ title: "Other calendar", attendees: [pat] }]);
	const publish = async (slug: string, snapshot: ReturnType<typeof agenda>) => {
		const [status] = await save(
			{ job: "mail_capture", for_user: slug },
			"calendar/agenda",
			snapshot,
			"PUT",
		);
		assert.equal(status, 200);
	};
	await publish("dell", other);
	const missing = await ready(await meetings("?q=Pat"));
	assert.deepEqual(people(missing), [["Pat Example", ["verified_office"], []]]);
	assert.equal(missing.calendar.state, "unavailable");
	assert.equal(missing.calendar.reason, "source_unavailable");
	assert.equal(missing.calendar.scheduling.reason, "source_unavailable");

	await publish("joe", own);
	const page = await ready(await meetings());
	assert.equal(page.view, "research");
	assert.deepEqual(people(page), [
		[
			"Pat Example",
			["verified_office"],
			["Matched attendee", "Matched organizer"],
		],
		["Sam Example", ["verified_office"], []],
		["New Contact", ["verified_office"], ["New vendor meeting"]],
	]);
	assert.partialDeepStrictEqual(page.items[0], {
		vendor_id: ORG,
		ref: "V-1",
		contact: { id: PAT, email: pat.email },
	});
	assert.partialDeepStrictEqual(page.items[2], {
		vendor_id: NEW_ORG,
		category: "contractor",
		contact: { id: NEW_CONTACT, email: newContact.email },
	});
	assert.equal(page.calendar.state, "ready");
	assert.equal(page.calendar.scheduling.state, "ready");
	assert.deepEqual(people(await ready(await meetings("?q=Pat", "dell"))), [
		["Pat Example", ["verified_office"], ["Other calendar"]],
	]);
});

test("Research pages follow their cursor within and across vendors", async (t) => {
	const { db, meetings } = await vendorMeetings(t);
	await seedVendors(db);
	const search = "?view=research&q=AUSTIN&limit=1";
	const first = await ready(await meetings(search));
	assert.equal(first.schema, "vendor-meetings.v1");
	assert.equal(first.view, "research");
	const defaultPage = await ready(await meetings("?q=AUSTIN&limit=1"));
	for (const field of [
		"schema",
		"view",
		"total",
		"items",
		"has_more",
		"next_cursor",
	] as const)
		assert.deepEqual(defaultPage[field], first[field]);
	assert.equal(first.has_more, true);
	assert.ok(first.next_cursor);
	const cursor = encodeURIComponent(first.next_cursor);
	const second = await ready(await meetings(`${search}&cursor=${cursor}`));
	assert.equal(second.has_more, true);
	assert.ok(second.next_cursor);
	const third = await ready(
		await meetings(
			`${search}&cursor=${encodeURIComponent(second.next_cursor)}`,
		),
	);
	assert.equal(third.has_more, false);
	assert.equal(third.next_cursor, null);
	assert.deepEqual([first.total, second.total, third.total], [3, 3, 3]);
	assert.deepEqual(
		[first, second, third].map(({ items }) =>
			items.map(({ vendor_id, contact }) => [vendor_id, contact.id]),
		),
		[[[ORG, PAT]], [[ORG, SAM]], [[NEW_ORG, NEW_CONTACT]]],
	);
	await refused(
		await meetings(`?view=research&q=Pat&limit=1&cursor=${cursor}`),
		400,
		"vendor_meetings_query_invalid",
	);
});

test("Suggested is refused like any unknown vendor meeting view", async () => {
	const answers = [];
	for (const view of ["suggested", "bogus"]) {
		const response = await route.request(`/vendor-meetings?view=${view}`);
		assert.equal(response.status, 400);
		const { correlation_id, ...body } = (await response.json()) as Record<
			string,
			unknown
		>;
		assert.equal(typeof correlation_id, "string");
		assert.partialDeepStrictEqual(body, {
			error: "value_not_in_declared_vocabulary",
			fields: ["view"],
			allowed_values: ["research"],
		});
		answers.push(body);
	}
	assert.deepEqual(answers[0], answers[1]);
});

async function refused(response: Response, status: number, error: string) {
	assert.equal(response.status, status);
	const { correlation_id, hint, ...body } = (await response.json()) as Record<
		string,
		unknown
	>;
	assert.equal(typeof correlation_id, "string");
	assert.equal(typeof hint, "string");
	assert.deepEqual(body, { error });
}

test("the read refuses a caller who is not a partner, a bad query and a failed read", async (t) => {
	const { db, meetings } = await vendorMeetings(t);
	await refused(await meetings("?q=x", "claude"), 403, "AUTHORIZATION_REFUSED");
	for (const search of [
		`?q=${"x".repeat(81)}`,
		"?q=a&q=b",
		"?limit=0",
		"?limit=51",
		"?limit=1.5",
		"?cursor=",
		"?cursor=!!!",
		`?cursor=${btoa("null")}`,
		`?view=research&cursor=${btoa(encodeURIComponent(JSON.stringify({ v: 1, view: "research", q: "", after: [ORG, PAT] })))}`,
	])
		await refused(await meetings(search), 400, "vendor_meetings_query_invalid");

	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${ACTOR}', 'person', 'Example Partner');
		insert into app_user (id, slug) values ('${ACTOR}', 'joe');
		alter table party_role rename to hidden_party_role;
		commit;`);
	await refused(await meetings(), 500, "vendor_meetings_unavailable");
});
