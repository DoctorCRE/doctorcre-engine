import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { URL } from "node:url";
import pg from "pg";
import { asAdmin } from "../scripts/test-database.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PARTNER = id(1);
const AGENT = id(2);
const MAIL = id(3);
const SYSTEM = id(4);
const attribution = await readFile(
	new URL("../schema/copy-attribution.sql", import.meta.url),
	"utf8",
);
const name = `copy_attribution_${randomUUID().replaceAll("-", "")}`;
const url = new URL(
	process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1/postgres",
);
url.pathname = `/${name}`;
const db = new pg.Client({
	connectionString: url.href,
	options: "-c search_path=next",
});
type Attribution = [string | null, string | null, string | null];
const attributed = async (call: string, args: (string | null)[]) =>
	(
		await db.query(
			`select changed_by_user_id, changed_by_job, changed_for_user_id from ${call}`,
			args,
		)
	).rows.map(Object.values);
const oldEvent = (
	n: number,
	actor: string,
	deal: number,
	field: string,
	cause: string,
	sponsor: string | null,
) =>
	`('${id(n)}', '${actor}', 'example', 'deal', '${id(deal)}', '${field}', '${cause}', '2025-01-01', ${sponsor ? `'${sponsor}'` : "null"})`;
before(async () => {
	assert.ok(process.env.TEST_SNAPSHOT, "Run npm run check");
	await asAdmin(
		`create database "${name}" template "${process.env.TEST_SNAPSHOT}"`,
	);
	await db.connect();
	await db.query(`create schema next; ${attribution}`);
	// Inserted in order, so each later row is a later mutation; partner_two has no actor.
	await db.query(`insert into public.actor (id, slug, kind, display_name) values
 ('${PARTNER}', 'partner_one', 'human', 'Example User'), ('${AGENT}', 'codex', 'automation', 'Example agent'),
 ('${MAIL}', 'example-mail', 'automation', 'Example mail'), ('${SYSTEM}', 'example-system', 'system', 'Example system');
 insert into public.event (id, actor_id, verb, subject_type, subject_id, field, cause, occurred_at, sponsoring_human_slug) values
 ${[
		oldEvent(10, AGENT, 50, "phase", "human_stated", null),
		oldEvent(11, AGENT, 50, "phase", "human_stated", "partner_one"),
		oldEvent(12, MAIL, 51, "phase", "ingest_email", "partner_one"),
		oldEvent(13, MAIL, 51, "phase", "ingest_email", null),
		oldEvent(14, MAIL, 51, "phase", "automation_job", "partner_one"),
		oldEvent(15, AGENT, 52, "phase", "human_stated", "partner_two"),
		oldEvent(16, PARTNER, 52, "phase", "ingest_email", "partner_one"),
		oldEvent(17, SYSTEM, 52, "phase", "ingest_email", "partner_one"),
		oldEvent(18, AGENT, 53, "vendor_assignment", "human_stated", "partner_one"),
		oldEvent(19, AGENT, 53, "phase", "human_stated", null),
 ].join(",\n ")};`);
});
after(async () => {
	await db.end();
	await asAdmin(`drop database "${name}" with (force)`);
});

test("one event is attributed by its own cause and sponsor, never a later one", async () => {
	const cases: [string, string | null, number | null, Attribution][] = [
		["older unsponsored agent change", AGENT, 10, [null, "agent", null]],
		["later sponsored agent change", AGENT, 11, [null, "agent", PARTNER]],
		["scheduled mail filing", MAIL, 12, [null, "mail_capture", PARTNER]],
		["mail filing without a sponsor", MAIL, 13, [null, "mail_capture", null]],
		["other scheduled work", MAIL, 14, [null, "old_system", null]],
		["sponsor with no partner actor", AGENT, 15, [null, "agent", null]],
		["partner's own change", PARTNER, 16, [PARTNER, null, null]],
		["system change", SYSTEM, 17, [null, "old_system", null]],
		["another author's event", AGENT, 12, [null, "agent", null]],
		["no author", null, null, [null, "old_system", null]],
	];
	for (const [label, author, event, expected] of cases) {
		assert.deepEqual(
			await attributed("copy_event_attribution($1, $2)", [
				author,
				event === null ? null : id(event),
			]),
			[expected],
			label,
		);
	}
});

test("a row takes its latest event, or the latest for its own field", async () => {
	const cases: [string, number, string, string | null, Attribution][] = [
		["latest change", 50, AGENT, null, [null, "agent", PARTNER]],
		["latest by another author", 52, AGENT, null, [null, "agent", null]],
		[
			"field's own change",
			53,
			AGENT,
			"vendor_assignment",
			[null, "agent", PARTNER],
		],
		["later field's change", 53, AGENT, null, [null, "agent", null]],
		["no events", 54, MAIL, null, [null, "old_system", null]],
	];
	for (const [label, deal, author, field, expected] of cases) {
		assert.deepEqual(
			await attributed("copy_attribution('deal', $1, $2, $3)", [
				id(deal),
				author,
				field,
			]),
			[expected],
			label,
		);
	}
});
