import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = (first: number, count: number) =>
	Array.from({ length: count }, (_, i) => first + i);
const vendor = id(1);
const partner = id(2);
const script = fileURLToPath(
	new URL("../schema/backfill-party-links.sql", import.meta.url),
);

const { db, setup, cleanup, connectionString } = copyTest();
before(setup);
after(cleanup);

function oldLink(
	n: number,
	kind: string,
	from = vendor,
	to = id(100 + n),
	via: string | null = null,
) {
	return `('${id(n + 200)}', '${kind}', '${from}', '${to}', ${via ? `'${via}'` : "null"}, 'example', '${partner}')`;
}

const insertOldLinks = `insert into public.party_link (id, kind, from_party, to_party, via_party, source, created_by) values`;

test("the vendor copy embeds the same SQL that the backfill loads", async () => {
	const copy = await readSchema("copy-vendors.sql");
	const backfillStatements = await readSchema("copy-party-links.sql");
	assert.ok(copy.includes(backfillStatements));
});

test("the standalone backfill refuses a count mismatch, copies the missing rows with history, and replays without changes", async () => {
	const parties = [1, 2, ...ids(101, 54)];
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into public.actor (id, slug, kind, display_name) values ('${partner}', 'partner_one', 'human', 'Example Partner');
		insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example Active', true, 0);
		insert into public.party (id, kind, name, created_by, updated_by) values
			${parties.map((n) => `('${id(n)}', 'person', 'Example ${n}', '${partner}', '${partner}')`)};
		insert into party (id, kind, name) select id, kind, name from public.party;
		insert into app_user (id, slug) values ('${partner}', 'partner_one');
		insert into outside_id (source, value, party_id) select 'old_system', id::text, id from party;
		insert into role (slug, label) values ('vendor', 'Vendor') on conflict do nothing;
		insert into party_role (party_id, role) values ('${vendor}', 'vendor');
		insert into public.party_link_kind (slug, label, sort) values
			${["introduced", "intro", "referral", "can_introduce", "knows", "works_with"].map((kind, i) => `('${kind}', '${kind}', ${i})`)};
		${insertOldLinks}
			${[
				...ids(2, 4).map((n) =>
					oldLink(n, "introduced", vendor, id(100 + n), partner),
				),
				...ids(6, 4).map((n) => oldLink(n, "introduced")),
				...ids(10, 7).map((n) => oldLink(n, "intro")),
				...ids(17, 4).map((n) => oldLink(n, "referral")),
				...ids(21, 6).map((n) =>
					oldLink(n, "can_introduce", partner, id(100 + n), vendor),
				),
				...ids(27, 20).map((n) => oldLink(n, "knows")),
				...ids(47, 4).map((n) => oldLink(n, "knows", id(80 + n), vendor)),
				...ids(51, 4).map((n) => oldLink(n, "works_with")),
			]};
		insert into party_link (id, kind, party_id, other_party_id)
			select id, kind, from_party, to_party from public.party_link where kind = 'knows' and from_party = '${vendor}';
		commit;`);

	const snapshot = async () => ({
		introductions: (await db.query("select * from introduction order by id"))
			.rows,
		links: (await db.query("select * from party_link order by id")).rows,
		history: (await db.query("select * from change order by id")).rows,
	});
	const runBackfill = () => {
		const result = spawnSync(
			"psql",
			["-X", "--csv", "-f", script, connectionString],
			{ encoding: "utf8" },
		);
		if (result.error) throw result.error;
		return result;
	};
	const original = await snapshot();
	const refused = runBackfill();
	assert.equal(refused.status, 3, refused.stderr);
	assert.match(refused.stderr, /Expected legacy party link counts/);
	assert.deepEqual(await snapshot(), original);

	await db.query(
		`${insertOldLinks} ${oldLink(1, "introduced", vendor, id(101), partner)}`,
	);
	const firstRun = runBackfill();
	assert.equal(firstRun.status, 0, firstRun.stderr);
	const copied = await snapshot();
	const newIntroductionIds = ids(201, 5).map(id);
	const newLinkIds = [...ids(221, 6), ...ids(251, 4)].map(id);
	const existingLinkIds = new Set(original.links.map((row) => row.id));
	assert.deepEqual(
		copied.introductions.map((row) => row.id),
		newIntroductionIds,
	);
	assert.deepEqual(
		copied.links.filter((row) => existingLinkIds.has(row.id)),
		original.links,
	);
	assert.deepEqual(
		copied.links
			.filter((row) => !existingLinkIds.has(row.id))
			.map((row) => row.id),
		newLinkIds,
	);
	assert.deepEqual(
		copied.history.slice(0, original.history.length),
		original.history,
	);
	assert.deepEqual(
		copied.history
			.slice(original.history.length)
			.map(({ table_name, action, record }) => [table_name, action, record.id])
			.sort(),
		[
			...newIntroductionIds.map((id) => ["introduction", "insert", id]),
			...newLinkIds.map((id) => ["party_link", "insert", id]),
		],
	);

	const replay = runBackfill();
	assert.equal(replay.status, 0, replay.stderr);
	assert.deepEqual(await snapshot(), copied);
	assert.match(firstRun.stdout, /^change_history_rows\n15$/m);
	assert.match(replay.stdout, /^change_history_rows\n0$/m);
});
