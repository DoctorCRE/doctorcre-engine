import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { withSnapshot } from "../../scripts/test-database.ts";
import { doorTest } from "../test-door.ts";
import worker from "../worker.ts";

const meetings = (search: string, connectionString: string, slug = "joe") =>
	worker.request(
		`https://app.example.test/api/engine/vendor-meetings${search}`,
		{ headers: { Cookie: "__Host-dealroom_session=made-up-session" } },
		{
			CARR: {
				fetch: async () =>
					Response.json({
						actor: { slug, display: "Example Partner" },
						csrf_token: "made-up-csrf",
					}),
			},
			DATABASE: { connectionString },
		},
	);

async function run(url: string, statements: string) {
	const db = new pg.Client({ connectionString: url });
	await db.connect();
	try {
		await db.query(statements);
	} finally {
		await db.end();
	}
}

const at = (hours: number) =>
	new Date(Date.now() + hours * 3_600_000).toISOString();
const ACTOR = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const ORG = "00000000-0000-4000-8000-000000000101";
const PAT = "00000000-0000-4000-8000-000000000102";
const SAM = "00000000-0000-4000-8000-000000000103";
const finding = (status: string) =>
	JSON.stringify({
		found: true,
		epistemic_status: status,
		location_type: "office",
		street_address: "1 Example St",
		city: "Austin",
		state: "TX",
	});
const SEED = `set session_replication_role = replica;
	insert into actor (id, slug, kind, display_name) values
		('${ACTOR}', 'joe', 'human', 'Example'), ('${OTHER}', 'dell', 'human', 'Example'),
		(gen_random_uuid(), 'claude', 'human', 'Example');
	insert into vendor_category (slug, label, sort) values ('lender', 'Example Lender', 1);
	insert into vendor_disposition (slug, label, workable, sort) values ('active', 'Active', true, 1);
	insert into party (id, kind, name, org_id, email, created_by, updated_by) values
		('${ORG}', 'org', 'Example Lending Co', null, null, '${ACTOR}', '${ACTOR}'),
		('${PAT}', 'person', 'Pat Example', '${ORG}', ' Pat@Example.TEST ', '${ACTOR}', '${ACTOR}'),
		('${SAM}', 'person', 'Sam Example', '${ORG}', 'sam@example.test', '${ACTOR}', '${ACTOR}');
	insert into vendor (vendor_ref, party_id, category, category_slug, offers, created_by, updated_by)
		values ('V-1', '${ORG}', 'lender', 'lender', 'Construction loans', '${ACTOR}', '${ACTOR}');
	insert into record_flag (subject_type, subject_id, kind, value, source, observed_at, created_by) values
		('party', '${PAT}', 'address', '${finding("source_backed")}', 'https://example.test/a', now() - interval '1 day', '${ACTOR}'),
		('party', '${SAM}', 'address', '${finding("inferred")}', 'https://example.test/b', now() - interval '1 day', '${ACTOR}');`;
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

type Answer = {
	total: number;
	has_more: boolean;
	next_cursor: string | null;
	items: {
		contact: { name: string };
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

test("vendor research still lists candidates when the calendar cannot be read", () =>
	withSnapshot(async (url) => {
		await run(url, SEED);
		const unplanned = await ready(
			await meetings("?view=research&q=AUSTIN", url),
		);
		assert.deepEqual(people(unplanned), [
			["Sam Example", ["verified_office"], []],
		]);
		assert.equal(unplanned.calendar.state, "unavailable");
		assert.equal(unplanned.calendar.reason, "source_unavailable");
		assert.equal(unplanned.calendar.scheduling.reason, "source_unavailable");
	}));

test("vendor meetings match exact attendee and organizer emails in the signed-in partner's Outlook agenda", async (t) => {
	const { db, readerUrl, setup, cleanup, request, save } = doorTest();
	await setup();
	t.after(cleanup);
	const joe = "00000000-0000-4000-8000-000000000011";
	const dell = "00000000-0000-4000-8000-000000000012";
	const reader = new URL(readerUrl).username;
	await db.query(`grant select on public.actor, public.party, public.vendor, public.lead,
		public.vendor_category, public.vendor_disposition, public.v_vendor_assignment_context,
		public.v_record_flag_subject to ${reader};
		begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${joe}', 'person', 'Example Partner One'), ('${dell}', 'person', 'Example Partner Two');
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell');
		set local search_path = public;
		${SEED}
		set session_replication_role = origin;
		commit;`);
	const own = agenda([
		{ title: "Matched attendee", attendees: [pat] },
		{ title: "Matched organizer", organizer: { email: "PAT@EXAMPLE.TEST" } },
		{
			title: "Different address",
			attendees: [{ email: "not-pat@example.test" }],
		},
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
	const suggested = async (user: string) =>
		ready(await request({ user }, "vendor-meetings", { method: "GET" }));
	await publish("dell", other);
	const missing = await suggested("joe");
	assert.deepEqual(people(missing), [["Pat Example", [], []]]);
	assert.equal(missing.calendar.state, "unavailable");
	assert.equal(missing.calendar.reason, "source_unavailable");
	assert.equal(missing.calendar.scheduling.reason, "source_unavailable");

	await publish("joe", own);
	const page = await suggested("joe");
	assert.deepEqual(people(page), [
		["Pat Example", [], ["Matched attendee", "Matched organizer"]],
	]);
	assert.equal(page.calendar.state, "ready");
	assert.equal(page.calendar.scheduling.state, "ready");
	assert.deepEqual(people(await suggested("dell")), [
		["Pat Example", [], ["Other calendar"]],
	]);
});

test("pages follow their cursor", () =>
	withSnapshot(async (url) => {
		await run(
			url,
			`${SEED};
			update record_flag set value = value || '{"epistemic_status": "source_backed"}'`,
		);
		const first = await ready(await meetings("?limit=1", url));
		assert.equal(first.has_more, true);
		const cursor = encodeURIComponent(first.next_cursor ?? "");
		const second = await ready(
			await meetings(`?limit=1&cursor=${cursor}`, url),
		);
		assert.deepEqual(
			people(first)
				.concat(people(second))
				.map(([name]) => name),
			["Pat Example", "Sam Example"],
		);
	}));

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

test("the read refuses a caller who is not a partner, a bad query and a failed read", () =>
	withSnapshot(async (url) => {
		await run(url, SEED);
		await refused(
			await meetings("?q=x", url, "claude"),
			403,
			"AUTHORIZATION_REFUSED",
		);
		for (const search of [
			`?q=${"x".repeat(81)}`,
			"?q=a&q=b",
			"?limit=0",
			"?limit=51",
			"?limit=1.5",
			"?cursor=",
			"?cursor=!!!",
			`?cursor=${btoa("null")}`,
			`?view=research&cursor=${btoa(encodeURIComponent(JSON.stringify({ v: 1, view: "suggested", q: "", after: [ORG, PAT] })))}`,
		])
			await refused(
				await meetings(search, url),
				400,
				"vendor_meetings_query_invalid",
			);
		await run(url, "alter view v_vendor_assignment_context rename to v_hidden");
		await refused(await meetings("", url), 500, "vendor_meetings_unavailable");
	}));
