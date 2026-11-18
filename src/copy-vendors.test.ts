import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import type pg from "pg";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PARTNER = id(1);
const SYSTEM = id(2);
const OTHER_PARTNER = id(4);

const COPY = await readSchema("copy-vendors.sql");

// A row shaped like today's vendor, last changed by the system unless it says otherwise.
const oldVendor = (
	n: number,
	party: number,
	row: Record<string, string> = {},
) => {
	const full = {
		id: id(n),
		party_id: id(party),
		category: "Example category",
		created_by: SYSTEM,
		updated_by: SYSTEM,
		...row,
	};
	return `insert into public.vendor (${Object.keys(full)})
		values (${Object.values(full).map((value) => `'${value}'`)});`;
};

const ORIGINAL_STAGES = [
	"prospect_uncontacted",
	"unrated",
	"target_not_yet_met",
	"building_working_on_it",
	"decent_relationship",
	"important_strengthening",
	"fully_aligned",
	"avoid_not_a_good_partner",
	"tabled_parked_drip_only",
];

// Old parties 10 to 19, of which 15 was merged into 10 and 18 into 17, and 16 was not copied.
const SETUP = `begin;
select set_config('engine.job', 'old_system', true);
insert into party (id, kind, name) values ('${PARTNER}', 'person', 'Example User'), ('${OTHER_PARTNER}', 'person', 'Example Second User'),
	('${id(10)}', 'company', 'Example Bank'),
	('${id(11)}', 'person', 'Example Builder'), ('${id(17)}', 'company', 'Example Parked'), ('${id(19)}', 'person', 'Example Avoided');
insert into app_user (id, slug) values ('${PARTNER}', 'user-${PARTNER}'), ('${OTHER_PARTNER}', 'user-${OTHER_PARTNER}');
insert into outside_id (source, value, party_id) values ('old_system_ref', 'P-0010', '${id(10)}'),
	${[1, 4, 10, 11, 15, 17, 18, 19].map((n) => `('old_system', '${id(n)}', '${id({ 15: 10, 18: 17 }[n] ?? n)}')`)};
insert into public.actor (id, slug, kind, display_name) values
	('${PARTNER}', 'partner_one', 'human', 'Example User'), ('${OTHER_PARTNER}', 'partner_two', 'human', 'Example Second User'),
	('${SYSTEM}', 'example-system', 'system', 'Example system');
insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 10);
insert into public.party (id, kind, name, created_by, updated_by)
	select id, 'person', 'Example party', '${SYSTEM}', '${SYSTEM}' from unnest(array[${[10, 11, 15, 16, 17, 18, 19].map((n) => `'${id(n)}'::uuid`)}]) id;
insert into public.vendor_category (slug, label, sort) values
	('lender', 'Example lender', 10), ('gc', 'Example contractor', 50), ('cpa', 'Example accountant', 20);
insert into public.vendor_stage (slug, label, sort) values ('example', 'Example stage', 0),
	${ORIGINAL_STAGES.map((slug, i) => `('${slug}', 'Example original', ${i + 1})`)};
insert into public.vendor_disposition (slug, label, workable, sort) values
	('active', 'Example active', true, 10), ('parked', 'Example parked', false, 20), ('avoid', 'Example avoid', false, 30);
insert into public.vendor_relationship_level (level, label, note) values (2, 'Example', 'Example'), (3, 'Example', 'Example'), (4, 'Example', 'Example');
${oldVendor(40, 10, {
	vendor_ref: " V-0040 ",
	category_slug: "gc",
	stage: "example",
	relationship_level: "2",
	created_at: "2024-01-02T03:04:05Z",
	updated_by: PARTNER,
	updated_at: "2025-01-02T03:04:05Z",
	territory: "Example territory",
	offers: " Example offer ",
	seeking: "Example introductions",
	loan_programs: `{Example financing,"\tExample financing\n"}`,
	owner_id: PARTNER,
	referral_active: "true",
	originated: " Example referral, date unknown. ",
	owner_label: "Example import label",
	links_label: "Example link label",
	last_touch: "2025-01-01",
	deal_history_verified_at: "2025-01-01",
	out_of_market: "true",
	intro_notes: " Example vendor note ",
	trust_override: `{"tier": "Proven", "recorded_by": "partner_one", "reason": "Example reason", "recorded_at": "2025-01-01"}`,
})}
${oldVendor(41, 15, {
	vendor_ref: "V-0041",
	category_slug: "lender",
	stage: "prospect_uncontacted",
	relationship_level: "3",
	is_target: "true",
	verticals: `{dental,medical," dental ","\tdental","dental\n",NULL," "}`,
	seeking: "Conflicting request",
	owner_id: OTHER_PARTNER,
	originated: "Another origin",
	rivalry_group: " Example rivalry note\nKeep wording. ",
	loan_programs: "{Example financing,Example equipment}",
	intro_notes: " \t",
})}
${oldVendor(42, 11, { vendor_ref: "P-0010", category: "Misc", relationship_level: "4", enrich: "true", referral_active: "false", owner_id: SYSTEM, owner_label: "partner_one" })}
${oldVendor(43, 16, { owner_label: "Unassigned" })}
${oldVendor(44, 17, { disposition: "parked", category_slug: "cpa" })}
${oldVendor(45, 18, { vendor_ref: "V-0045" })}
${oldVendor(46, 19, { disposition: "avoid", is_target: "false" })}
${oldVendor(47, 10, {
	merged_into: id(40),
	owner_label: "Shared",
	category_slug: "cpa",
	stage: "avoid_not_a_good_partner",
	territory: "Example territory",
	offers: "Different offer",
	originated: "Merged origin",
	rivalry_group: "Different rivalry note",
	referral_active: "false",
	verticals: "{medical,vet}",
	intro_notes: " Example vendor note ",
})}
${oldVendor(49, 10, {
	merged_into: id(40),
	category_slug: "cpa",
	intro_notes: "Example merged note",
	originated: "Different merged origin",
	updated_by: PARTNER,
	updated_at: "2025-02-03T04:05:06Z",
})}
commit;`;

const { db, setup, cleanup } = copyTest();
const rows = async (sql: string) => (await db.query(sql)).rows;
const copy = async (sql = "") => {
	const results = await db.query(sql + COPY);
	return (results as unknown as pg.QueryResult[])
		.at(-1)
		?.rows.map((row) => Object.values(row));
};
const rolledBack = async (check: () => Promise<void>) => {
	await db.query("begin");
	try {
		await check();
	} finally {
		await db.query("rollback");
	}
};
let report: unknown[][] = [];

before(async () => {
	await setup();
	await db.query(SETUP);
	await db.query("begin");
	report = (await copy()) ?? [];
	await db.query("commit");
});

after(cleanup);

test("each category is a vendor role, gc is contractor, and the roles vendors play on deals join them", async () => {
	// biome-ignore format: one row per role
	assert.deepEqual(await rows("select slug, label, category_of from role order by slug"), [
		{ slug: "architect", label: "Architect", category_of: "vendor" },
		{ slug: "attorney", label: "Attorney", category_of: "vendor" },
		{ slug: "contractor", label: "Example contractor", category_of: "vendor" },
		{ slug: "cpa", label: "Example accountant", category_of: "vendor" },
		{ slug: "inspector", label: "Inspector", category_of: "vendor" },
		{ slug: "landlord_rep", label: "Landlord rep", category_of: "vendor" },
		{ slug: "lender", label: "Example lender", category_of: "vendor" },
		{ slug: "title", label: "Title", category_of: "vendor" },
		{ slug: "vendor", label: "Vendor", category_of: null },
	]);
});

test("today's stages are vendor stages, but not the nine that migration 0047 split", async () => {
	assert.deepEqual(await rows("select role, slug, label from stage"), [
		{ role: "vendor", slug: "example", label: "Example stage" },
	]);
});

test("a record's vendors become one vendor role with each category, and a ruled vendor waits whole", async () => {
	// biome-ignore format: one row per role
	assert.deepEqual(await rows("select party_id, role, stage, relationship_level, disposition, is_target from party_role order by party_id, role"), [
		{ party_id: id(10), role: "contractor", stage: null, relationship_level: null, disposition: null, is_target: false },
		{ party_id: id(10), role: "cpa", stage: null, relationship_level: null, disposition: null, is_target: false },
		{ party_id: id(10), role: "lender", stage: null, relationship_level: null, disposition: null, is_target: false },
		{ party_id: id(10), role: "vendor", stage: "example", relationship_level: 2, disposition: null, is_target: true },
		{ party_id: id(11), role: "vendor", stage: null, relationship_level: null, disposition: null, is_target: false },
	]);
});

test("a vendor role keeps when its vendor was stored and who last changed it", async () => {
	assert.deepEqual(
		await rows(
			`select role, created_at::text, changed_by_user_id, changed_by_job, changed_at::text
			from party_role where party_id = '${id(10)}' and role in ('vendor', 'contractor') order by role`,
		),
		["contractor", "vendor"].map((role) => ({
			role,
			created_at: "2024-01-02 03:04:05+00",
			changed_by_user_id: PARTNER,
			changed_by_job: null,
			changed_at: "2025-01-02 03:04:05+00",
		})),
	);
});

test("each copied vendor's id and reference number lead to its record", async () => {
	// biome-ignore format: one row per id
	assert.deepEqual(await rows(`select source, value, party_id from outside_id where value in ('${id(40)}', '${id(41)}', '${id(42)}', '${id(47)}', 'V-0040', 'V-0041', 'P-0010') order by source, value`), [
		{ source: "old_system", value: id(40), party_id: id(10) },
		{ source: "old_system", value: id(41), party_id: id(10) },
		{ source: "old_system", value: id(42), party_id: id(11) },
		{ source: "old_system", value: id(47), party_id: id(10) },
		{ source: "old_system_ref", value: "P-0010", party_id: id(10) },
		{ source: "old_system_ref", value: "V-0040", party_id: id(10) },
		{ source: "old_system_ref", value: "V-0041", party_id: id(10) },
	]);
});

test("each value it does not copy is listed, with why", () => {
	// biome-ignore format: one row per value
	assert.deepEqual(report, [
		[id(40), "out_of_market", "true", "no place in the new database"],
		[id(40), "trust_override", "Proven", "a hand-set rating, which the new database does not keep"],
		[id(41), "originated", "Another origin", "its record holds another value"],
		[id(41), "owner_id", OTHER_PARTNER, "its record holds another value"],
		[id(41), "relationship_level", "3", "its record holds another level"],
		[id(41), "seeking", "Conflicting request", "its record holds another value"],
		[id(41), "verticals", " ", "blank or null list entry"],
		[id(41), "verticals", null, "blank or null list entry"],
		[id(42), "category", "Misc", "not a vendor category"],
		[id(42), "owner_id", SYSTEM, "relationship owner is not a copied user"],
		[id(42), "relationship_level", "4", "not a relationship level"],
		[id(42), "vendor_ref", "P-0010", `also the id of ${id(10)}`],
		[id(43), "vendor", null, "its record is not copied"],
		[id(44), "disposition", "parked", "a ruling without a reason"],
		[id(45), "vendor", "V-0045", "another vendor of its record waits for a ruling"],
		[id(46), "disposition", "avoid", "a ruling without a reason"],
		[id(47), "offers", "Different offer", "its record holds another value"],
		[id(47), "originated", "Merged origin", "its record holds another value"],
		[id(47), "owner_label", "Shared", "relationship owner has no actor id"],
		[id(47), "referral_active", "false", "its record holds another value"],
		[id(47), "rivalry_group", "Different rivalry note", "its record holds another value"],
		[id(49), "originated", "Different merged origin", "its record holds another value"],
	]);
});

test("vendor relationship owners must map to a user and reruns keep a partner's edit", () =>
	rolledBack(async () => {
		const owners = () =>
			rows(`select party_id, owner_user_id from party_role
			where role = 'vendor' order by party_id`);
		assert.deepEqual(await owners(), [
			{ party_id: id(10), owner_user_id: PARTNER },
			{ party_id: id(11), owner_user_id: null },
		]);
		await db.query(`select set_config('engine.user_id', '${PARTNER}', true);
			update party_role set owner_user_id = null where party_id = '${id(10)}' and role = 'vendor';
			set constraints all immediate;`);
		await copy();
		assert.deepEqual(await owners(), [
			{ party_id: id(10), owner_user_id: null },
			{ party_id: id(11), owner_user_id: null },
		]);
	}));

test("a vendor with only a partner label is copied without an owner and listed", () =>
	rolledBack(async () => {
		await db.query(`select set_config('engine.job', 'old_system', true);
			insert into party (id, kind, name) values ('${id(21)}', 'person', 'Example Vendor');
			insert into public.party (id, kind, name, created_by, updated_by)
			values ('${id(21)}', 'person', 'Example Vendor', '${SYSTEM}', '${SYSTEM}');
			insert into outside_id (source, value, party_id) values ('old_system', '${id(21)}', '${id(21)}');`);
		const listed = await copy(
			oldVendor(59, 21, { owner_label: "partner_one" }),
		);
		assert.deepEqual(
			await rows(
				`select owner_user_id from party_role where party_id = '${id(21)}' and role = 'vendor'`,
			),
			[{ owner_user_id: null }],
		);
		assert.deepEqual(
			listed?.filter(
				([oldId, field]) => oldId === id(59) && field === "owner_label",
			),
			[
				[
					id(59),
					"owner_label",
					"partner_one",
					"relationship owner has no actor id",
				],
			],
		);
	}));

test("relationship wording and referral yes, no and unknown copy without inference", () =>
	rolledBack(async () => {
		await db.query("discard temp");
		await copy(
			reviewed([44, "Example parked reason"], [46, "Example avoid reason"]),
		);
		assert.deepEqual(
			await rows(`select party_id, relationship_origin, rivalry_note, refers_business
				from party_role where role = 'vendor' order by party_id`),
			[
				{
					party_id: id(10),
					relationship_origin: " Example referral, date unknown. ",
					rivalry_note: " Example rivalry note\nKeep wording. ",
					refers_business: true,
				},
				...[11, 17, 19].map((n) => ({
					party_id: id(n),
					relationship_origin: null,
					rivalry_note: null,
					refers_business: n === 11 ? false : null,
				})),
			],
		);
		assert.deepEqual(await rows("select * from introduction"), []);
		assert.deepEqual(await rows("select * from party_link"), []);
	}));

for (const field of [
	"relationship_origin",
	"rivalry_note",
	"refers_business",
]) {
	test(`${field} belongs only on the vendor role`, () =>
		rolledBack(async () => {
			await db.query(`set local role engine; select set_config('engine.user_id', '${PARTNER}', true);
			select set_config('engine.job', '', true);`);
			const value = field === "refers_business" ? "false" : "'Example'";
			await assert.rejects(
				db.query(
					`update party_role set ${field} = ${value} where role = 'contractor'`,
				),
				{
					code: "23514",
					constraint: "party_role_relationship_notes_on_vendor",
				},
			);
		}));
}

test("users can keep empty wording, clear unknown referral status, and reruns keep their edits", () =>
	rolledBack(async () => {
		await db.query(`set local role engine; select set_config('engine.user_id', '${PARTNER}', true);
			select set_config('engine.job', '', true);
			update party_role set relationship_origin = '', rivalry_note = '  ', refers_business = null
			where party_id = '${id(10)}' and role = 'vendor'; reset role; set constraints all immediate; discard temp;`);
		await copy();
		assert.deepEqual(
			await rows(`select relationship_origin, rivalry_note, refers_business
			from party_role where party_id = '${id(10)}' and role = 'vendor'`),
			[{ relationship_origin: "", rivalry_note: "  ", refers_business: null }],
		);
	}));

const noteId = (vendor: number) => {
	const hex = createHash("md5")
		.update(`old_system:vendor:${id(vendor)}:intro_notes`)
		.digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

test("each nonblank vendor note is a note about its record, unless its surviving vendor holds it too", async () => {
	// biome-ignore format: one row per note
	assert.deepEqual(await rows(`select a.id, a.kind, a.happened_at::text, a.summary, about.party_id, about.created_at::text,
		a.changed_by_user_id, a.changed_by_job, a.changed_at::text from activity a join activity_about about on about.activity_id = a.id
		order by a.happened_at`), [
		{ id: noteId(40), kind: "note", happened_at: "2025-01-02 03:04:05+00", summary: " Example vendor note ", party_id: id(10),
			created_at: "2025-01-02 03:04:05+00", changed_by_user_id: PARTNER, changed_by_job: null, changed_at: "2025-01-02 03:04:05+00" },
		{ id: noteId(49), kind: "note", happened_at: "2025-02-03 04:05:06+00", summary: "Example merged note", party_id: id(10),
			created_at: "2025-02-03 04:05:06+00", changed_by_user_id: PARTNER, changed_by_job: null, changed_at: "2025-02-03 04:05:06+00" },
	]);
});

const COPIED_ROWS = `select to_jsonb(v) as row from vendor_vertical v union all select to_jsonb(p) from vendor_loan_program p
	union all select to_jsonb(a) from activity a union all select to_jsonb(a) from activity_about a`;

test("a second run changes nothing, lists the same corrections again, and lists a vendor added to a copied record", () =>
	rolledBack(async () => {
		const roles = await rows(
			"select * from party_role order by party_id, role",
		);
		const history = await rows("select * from change order by id");
		const lists = await rows(COPIED_ROWS);
		await db.query("discard temp");
		// biome-ignore format: one vendor
		assert.deepEqual(await copy(oldVendor(48, 10, { vendor_ref: "V-0048", intro_notes: "Example waiting note" })), [
			...report.filter(([old]) => String(old) < id(48)),
			[id(48), "vendor", "V-0048", "its record holds a vendor role copied before"],
			...report.filter(([old]) => String(old) > id(48)),
		]);
		assert.deepEqual(
			await rows("select * from party_role order by party_id, role"),
			roles,
		);
		assert.deepEqual(await rows("select * from change order by id"), history);
		assert.deepEqual(await rows(COPIED_ROWS), lists);
	}));

const reviewed = (...reasons: [number, string][]) =>
	`create temp table copy_vendor_ruling_reason (old_id uuid, reason text) on commit drop;
	insert into copy_vendor_ruling_reason values ${reasons.map(([n, reason]) => `('${id(n)}', '${reason}')`)};`;
const RULED = `select party_id, role, disposition, disposition_reason, is_target from party_role
	where party_id in ('${id(17)}', '${id(19)}') order by party_id, role`;
const RULING_FIELDS = [
	"vendor",
	"disposition",
	"disposition_reason",
	"is_target",
	"party_link",
];
const rulingRows = async (sql: string) =>
	(await copy(sql))?.filter((row) => RULING_FIELDS.includes(row[1] as string));

test("a ruled vendor comes across with its reviewed reason, the strictest on its record, and then brings its note and introductions", () =>
	rolledBack(async () => {
		await db.query(`alter table public.vendor disable trigger vendor_touch;
		update public.vendor set intro_notes = 'Example parked note' where id = '${id(44)}';
		update public.vendor set disposition = 'avoid', is_target = true where id = '${id(45)}';
		insert into public.party_link_kind (slug, label, sort) values ('introduced', 'Example', 1);
		${link(93, 17, 11, "introduced", 17)}`);
		// biome-ignore format: one row per value
		assert.deepEqual(await rulingRows(reviewed([46, "Example reason one"], [46, "Example reason two"])), [
			[id(43), "vendor", null, "its record is not copied"],
			[id(44), "disposition", "parked", "a ruling without a reason"],
			[id(45), "disposition", "avoid", "a ruling without a reason"],
			[id(46), "disposition", "avoid", "its reviewed reasons conflict"],
			[id(93), "party_link", "introduced", "made by neither a copied vendor nor a user"],
		]);
		assert.deepEqual(await rows(RULED), []);

		await db.query(
			`discard temp; update public.vendor set disposition = 'active' where id = '${id(46)}'`,
		);
		const reasons = reviewed(
			[44, " Example parked reason "],
			[44, "Example parked reason"],
			[45, "Example avoid reason"],
			[46, "Example reason one"],
			[99, "Example stray reason"],
		);
		const listed = await rulingRows(reasons);
		// biome-ignore format: one row per value
		assert.deepEqual(listed, [
			[id(43), "vendor", null, "its record is not copied"],
			[id(44), "disposition_reason", "Example parked reason", "its record holds a stricter ruling"],
			[id(45), "is_target", "true", "an avoided vendor cannot be a target"],
			[id(46), "disposition_reason", "Example reason one", "not a parked or avoided vendor"],
			[id(99), "disposition_reason", "Example stray reason", "not a vendor"],
		]);
		// biome-ignore format: one row per role
		assert.deepEqual(await rows(RULED), [
			{ party_id: id(17), role: "cpa", disposition: null, disposition_reason: null, is_target: false },
			{ party_id: id(17), role: "vendor", disposition: "avoid", disposition_reason: "Example avoid reason", is_target: false },
			{ party_id: id(19), role: "vendor", disposition: null, disposition_reason: null, is_target: false },
		]);
		assert.deepEqual(
			await rows(
				`select a.summary, i.vendor_id, i.introduced_party_id from activity_about about join activity a on a.id = about.activity_id,
				introduction i where about.party_id = '${id(17)}' and i.id = '${id(93)}'`,
			),
			[
				{
					summary: "Example parked note",
					vendor_id: id(17),
					introduced_party_id: id(11),
				},
			],
		);

		const copiedRows = `select to_jsonb(r) from party_role r union all select to_jsonb(o) from outside_id o
			union all select to_jsonb(i) from introduction i union all ${COPIED_ROWS}`;
		const kept = await rows(copiedRows);
		const history = await rows("select * from change order by id");
		await db.query("discard temp");
		assert.deepEqual(await rulingRows(reasons), listed);
		assert.deepEqual(await rows(copiedRows), kept);
		assert.deepEqual(await rows("select * from change order by id"), history);
	}));

test("vendor capabilities keep text and union lists without inventing a vocabulary", async () => {
	assert.deepEqual(
		await rows(
			`select offers, seeking from party_role where party_id = '${id(10)}' and role = 'vendor'`,
		),
		[{ offers: "Example offer", seeking: "Example introductions" }],
	);
	assert.deepEqual(
		await rows("select vertical from vendor_vertical order by vertical"),
		["dental", "medical", "vet"].map((vertical) => ({ vertical })),
	);
	assert.deepEqual(
		await rows(
			"select loan_program from vendor_loan_program order by loan_program",
		),
		["Example equipment", "Example financing"].map((loan_program) => ({
			loan_program,
		})),
	);
	assert.deepEqual(
		await rows(`select created_at::text, changed_at::text, changed_by_user_id, changed_by_job
		from vendor_loan_program where loan_program = 'Example financing'`),
		[
			{
				created_at: "2024-01-02 03:04:05+00",
				changed_at: "2025-01-02 03:04:05+00",
				changed_by_user_id: PARTNER,
				changed_by_job: null,
			},
		],
	);
});

for (const [sql, code] of [
	[
		`update party_role set offers = 'Example' where role = 'contractor'`,
		"23514",
	],
	[
		`update party_role set seeking = 'Example' where role = 'contractor'`,
		"23514",
	],
	[`update party_role set offers = E' \n' where role = 'vendor'`, "23514"],
	[`update party_role set seeking = ' ' where role = 'vendor'`, "23514"],
	...(["vendor_vertical", "vendor_loan_program"] as const).flatMap(
		(table): [string, string][] => {
			const column = table === "vendor_vertical" ? "vertical" : "loan_program";
			return [
				[
					`insert into ${table} (party_id, ${column}) values ('${id(1)}', 'Example')`,
					"23503",
				],
				[
					`insert into ${table} (party_id, role, ${column}) values ('${id(10)}', 'contractor', 'Example')`,
					"23514",
				],
				[
					`insert into ${table} (party_id, ${column}) values ('${id(10)}', ' ')`,
					"23514",
				],
				[
					`insert into ${table} (party_id, ${column}) values ('${id(10)}', ' Example ')`,
					"23514",
				],
				[
					`insert into ${table} (party_id, ${column}) values ('${id(10)}', E'\\tExample')`,
					"23514",
				],
				[
					`insert into ${table} (party_id, ${column}) values ('${id(10)}', E'Example\\n')`,
					"23514",
				],
				[
					`insert into ${table} (party_id, ${column}) values ('${id(10)}', null)`,
					"23502",
				],
				[
					`insert into ${table} (party_id, ${column}) select party_id, ${column} from ${table} limit 1`,
					"23505",
				],
			];
		},
	),
] satisfies [string, string][]) {
	test(`vendor capability constraints refuse ${sql}`, () =>
		rolledBack(async () => {
			await db.query(`set local role engine; select set_config('engine.user_id', '${PARTNER}', true);
			select set_config('engine.job', '', true);`);
			await assert.rejects(db.query(sql), { code });
		}));
}

test("users edit vendor text and add or remove stamped list entries; reruns keep them", () =>
	rolledBack(async () => {
		await db.query(`set local role engine; select set_config('engine.user_id', '${PARTNER}', true);
		select set_config('engine.job', '', true);
		update party_role set offers = 'Revised offer' where party_id = '${id(10)}' and role = 'vendor';
		insert into vendor_vertical (party_id, vertical) values ('${id(10)}', 'Example new vertical');
		delete from vendor_vertical where vertical = 'vet';`);
		assert.deepEqual(
			await rows(
				"select changed_by_user_id, changed_by_job from vendor_vertical where vertical = 'Example new vertical'",
			),
			[{ changed_by_user_id: PARTNER, changed_by_job: null }],
		);
		await db.query("reset role; set constraints all immediate; discard temp");
		const before = await rows(
			"select * from vendor_vertical order by vertical",
		);
		await copy();
		assert.deepEqual(
			await rows("select * from vendor_vertical order by vertical"),
			before,
		);
		assert.deepEqual(
			await rows(
				`select offers from party_role where party_id = '${id(10)}' and role = 'vendor'`,
			),
			[{ offers: "Revised offer" }],
		);
	}));

test("merging vendor roles keeps the survivor's owner and text, fills missing values and unions capabilities", () =>
	rolledBack(async () => {
		await db.query(`select set_config('engine.user_id', '${PARTNER}', true); select set_config('engine.job', '', true);
		update party set kind = 'company' where id = '${id(11)}';
		update party_role set relationship_origin = 'Other origin', rivalry_note = 'Other rivalry', refers_business = true,
		offers = 'Other offer', seeking = 'Other request', owner_user_id = '${OTHER_PARTNER}' where party_id = '${id(11)}';
		update party_role set rivalry_note = null, refers_business = false, seeking = null where party_id = '${id(10)}' and role = 'vendor';
		insert into vendor_vertical (party_id, vertical) values ('${id(11)}', 'dental'), ('${id(11)}', 'Example new');
		insert into vendor_loan_program (party_id, loan_program) values ('${id(11)}', 'Example financing'), ('${id(11)}', 'Example new');
		set local role engine;
		select merge_party('${id(11)}', '${id(10)}'); set constraints all immediate;`);
		assert.deepEqual(
			await rows(
				`select offers, seeking from party_role where party_id = '${id(10)}' and role = 'vendor'`,
			),
			[{ offers: "Example offer", seeking: "Other request" }],
		);
		assert.deepEqual(
			await rows(`select relationship_origin, rivalry_note, refers_business, owner_user_id
			from party_role where party_id = '${id(10)}' and role = 'vendor'`),
			[
				{
					relationship_origin: " Example referral, date unknown. ",
					rivalry_note: "Other rivalry",
					refers_business: false,
					owner_user_id: PARTNER,
				},
			],
		);
		await db.query(`update party_role set relationship_origin = null, rivalry_note = null, refers_business = null, owner_user_id = null
			where party_id = '${id(10)}' and role = 'vendor';
			insert into party_role (party_id, role, relationship_origin, rivalry_note, refers_business, owner_user_id)
			values ('${id(17)}', 'vendor', 'Filled origin', 'Filled rivalry', false, '${OTHER_PARTNER}');
			select merge_party('${id(17)}', '${id(10)}');`);
		assert.deepEqual(
			await rows(`select relationship_origin, rivalry_note, refers_business, owner_user_id
			from party_role where party_id = '${id(10)}' and role = 'vendor'`),
			[
				{
					relationship_origin: "Filled origin",
					rivalry_note: "Filled rivalry",
					refers_business: false,
					owner_user_id: OTHER_PARTNER,
				},
			],
		);
		assert.equal((await rows("select * from vendor_vertical")).length, 4);
		assert.equal((await rows("select * from vendor_loan_program")).length, 3);
		assert.deepEqual(
			await rows(
				`select party_id from vendor_vertical where party_id <> '${id(10)}'`,
			),
			[],
		);
	}));

const link = (
	n: number,
	from: number,
	to: number,
	kind: string,
	via?: number,
) =>
	`insert into public.party_link (id, from_party, to_party, kind, source, created_by, created_at, via_party, occurred_on, note)
		values ('${id(n)}', '${id(from)}', '${id(to)}', '${kind}', 'example', '${PARTNER}', '2025-03-04T00:00:00Z',
		${via ? `'${id(via)}'` : "null"}, '2025-03-01', ' Example note ${n} ');`;
const evidence = (vendor: number, ...entries: [string, number][]) =>
	`update public.vendor set deal_evidence = '${JSON.stringify(
		entries.map(([role, deal]) => ({
			deal_id: id(deal),
			role,
			occurred_at: "2025-04-01T02:00:00Z",
			evidence_ref: `Example ${role}`,
		})),
	)}' where id = '${id(vendor)}';`;
// Old deals 70 and 72 were copied, 71 was not, and each is the deal of client 60, who is record 20.
const DEALS = `select set_config('engine.job', 'old_system', true);
insert into party (id, kind, name) values ('${id(20)}', 'person', 'Example Client');
insert into deal (id, name, owner_user_id) values ('${id(70)}', 'Example deal', '${PARTNER}'), ('${id(72)}', 'Example deal', '${PARTNER}');
insert into outside_id (source, value, party_id, deal_id) values ('old_system', '${id(20)}', '${id(20)}', null),
	('old_system', '${id(70)}', null, '${id(70)}'), ('old_system', '${id(72)}', null, '${id(72)}');
insert into public.party (id, kind, name, created_by, updated_by) values ('${id(1)}', 'person', 'Example', '${SYSTEM}', '${SYSTEM}'),
	('${id(20)}', 'person', 'Example', '${SYSTEM}', '${SYSTEM}');
insert into public.client (id, party_id, created_by, updated_by) values ('${id(60)}', '${id(20)}', '${SYSTEM}', '${SYSTEM}');
insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Example lease', 1);
insert into public.deal_phase (slug, label) values ('negotiation', 'Example negotiation');
insert into public.deal (id, client_id, name, deal_type, phase, created_by, updated_by)
	select deal, '${id(60)}', 'Example deal', 'lease', 'negotiation', '${SYSTEM}', '${SYSTEM}' from unnest(array['${id(70)}'::uuid, '${id(72)}'::uuid]) deal;
insert into public.party_link_kind (slug, label, sort) values
	('knows', 'Example', 1), ('introduced', 'Example', 2), ('intro', 'Example', 3), ('referral', 'Example', 4), ('referred', 'Example', 5);
${link(50, 20, 1, "introduced", 10)} ${link(51, 11, 20, "intro", 1)} ${link(52, 10, 20, "referral")} ${link(53, 10, 20, "referred")}
${link(54, 10, 20, "knows", 11)} ${link(55, 20, 11, "introduced", 17)} ${link(56, 16, 20, "introduced", 10)} ${link(57, 20, 1, "intro", 1)}
insert into public.actor (id, slug, kind, display_name) values ('${id(3)}', 'codex', 'automation', 'Example agent');
update public.party_link set created_by = '${id(3)}' where id = '${id(51)}';
insert into public.event (actor_id, verb, subject_type, subject_id, cause, occurred_at, sponsoring_human_slug)
	values ('${id(3)}', 'link-parties', 'party', '${id(11)}', 'human_stated', now(), 'partner_one');
${link(58, 1, 20, "referred", 15)}
insert into public.party_link_deal (link_id, deal_id, referred_by, note, created_by, created_at) values
	('${id(52)}', '${id(70)}', '${id(10)}', 'Example deal referral', '${PARTNER}', '2025-05-01'),
	('${id(58)}', '${id(70)}', '${id(15)}', 'Example merged referral', '${PARTNER}', '2025-06-01');
alter table public.vendor disable trigger vendor_touch;
${evidence(40, ["worked", 70], ["worked", 71], ["referred", 72], ["referred", 70], ["example", 70])}
${evidence(42, ["worked", 70], ["referred", 72])}
${evidence(41, ["referred", 20], ["referred", 72])}
${evidence(47, ["worked", 72])}
${evidence(44, ["worked", 70])}`;
const DEAL_FIELDS = ["deal_evidence", "party_link", "party_link_deal"];

test("introductions either way, and the deals a vendor worked or referred, are copied, or listed with why", () =>
	rolledBack(async () => {
		const listed = (await copy(DEALS))?.filter((row) =>
			DEAL_FIELDS.includes(row[1] as string),
		);
		// biome-ignore format: one row per introduction
		assert.deepEqual(await rows("select vendor_id, made_by, introduced_by_user_id, introduced_party_id, introduced_on::text, deal_id, note from introduction order by vendor_id, made_by, deal_id"), [
			{ vendor_id: id(10), made_by: "vendor", introduced_by_user_id: null, introduced_party_id: id(20), introduced_on: null, deal_id: id(70), note: "Example deal referral" },
			{ vendor_id: id(10), made_by: "vendor", introduced_by_user_id: null, introduced_party_id: id(20), introduced_on: "2025-03-31", deal_id: id(72), note: "Example referred" },
			{ vendor_id: id(10), made_by: "vendor", introduced_by_user_id: null, introduced_party_id: id(20), introduced_on: "2025-03-01", deal_id: null, note: "Example note 50" },
			{ vendor_id: id(11), made_by: "team", introduced_by_user_id: PARTNER, introduced_party_id: id(20), introduced_on: "2025-03-01", deal_id: null, note: "Example note 51" },
			{ vendor_id: id(11), made_by: "vendor", introduced_by_user_id: null, introduced_party_id: id(20), introduced_on: "2025-03-31", deal_id: id(72), note: "Example referred" },
		]);
		assert.deepEqual(
			await rows(
				"select deal_id, party_id, role from deal_party order by party_id, deal_id",
			),
			[
				{ deal_id: id(70), party_id: id(10), role: "contractor" },
				{ deal_id: id(72), party_id: id(10), role: "cpa" },
				{ deal_id: id(70), party_id: id(11), role: "vendor" },
			],
		);
		// biome-ignore format: one row per value
		assert.deepEqual(listed, [
			[id(40), "deal_evidence", `example ${id(70)}`, "neither worked nor referred"],
			[id(40), "deal_evidence", `worked ${id(71)}`, "its deal is not copied"],
			[id(41), "deal_evidence", `referred ${id(20)}`, "its deal is not copied"],
			[id(53), "party_link", "referred", "who made it is not recorded"],
			[id(55), "party_link", "introduced", "made by neither a copied vendor nor a user"],
			[id(56), "party_link", "introduced", "a party it links is not copied"],
			[id(57), "party_link", "intro", "no single copied vendor on either side"],
		]);
		assert.deepEqual(
			await rows(
				`select changed_by_user_id, changed_by_job, changed_for_user_id from introduction where id = '${id(51)}'`,
			),
			[
				{
					changed_by_user_id: null,
					changed_by_job: "agent",
					changed_for_user_id: PARTNER,
				},
			],
		);
		const history = await rows("select * from change order by id");
		await db.query("discard temp");
		assert.deepEqual(
			(await copy())?.filter((row) => DEAL_FIELDS.includes(row[1] as string)),
			listed,
		);
		assert.deepEqual(await rows("select * from change order by id"), history);

		const released = `select to_jsonb(p) from deal_party p union all select to_jsonb(c) from change c`;
		await db.query("discard temp");
		await copy(reviewed([44, "Example parked reason"]));
		assert.deepEqual(
			await rows(
				`select deal_id, role from deal_party where party_id = '${id(17)}'`,
			),
			[{ deal_id: id(70), role: "cpa" }],
		);
		const kept = await rows(released);
		await db.query("discard temp");
		await copy(reviewed([44, "Example parked reason"]));
		assert.deepEqual(await rows(released), kept);
	}));

// Party 12 is a second user, and 16 is the party that was not copied.
const LINKS = `select set_config('engine.job', 'old_system', true);
insert into party (id, kind, name) values ('${id(12)}', 'person', 'Example Second User');
insert into app_user (id, slug) values ('${id(12)}', 'user-${id(12)}');
insert into outside_id (source, value, party_id) values ('old_system', '${id(12)}', '${id(12)}');
insert into public.party (id, kind, name, created_by, updated_by)
	select id, 'person', 'Example', '${SYSTEM}', '${SYSTEM}' from unnest(array['${id(1)}'::uuid, '${id(12)}'::uuid]) id;
insert into public.party_link_kind (slug, label, sort) values ('knows', 'Example', 1), ('can_introduce', 'Example', 2),
	('works_with', 'Example', 3), ('intro_requested', 'Example', 4), ('example_kind', 'Example', 5);
${link(80, 10, 11, "knows")} ${link(81, 11, 10, "knows")} ${link(82, 10, 15, "knows")} ${link(83, 10, 16, "knows")}
${link(84, 17, 11, "can_introduce")} ${link(85, 1, 11, "can_introduce", 10)} ${link(86, 11, 17, "can_introduce", 10)}
${link(87, 1, 12, "can_introduce", 10)} ${link(88, 11, 1, "can_introduce", 16)} ${link(89, 10, 11, "works_with")}
${link(90, 11, 10, "intro_requested")} ${link(91, 10, 11, "example_kind")} ${link(92, 17, 19, "knows", 11)}`;
const LINK_FIELDS = ["party_link", "via_party"];
const LINK_ROWS = `select id, kind, party_id, other_party_id, started_on::text, ended_on, note, created_at::text,
	changed_by_user_id, changed_by_job, changed_at::text from party_link order by id`;
const copiedLink = (n: number, kind: string, from: number, to: number) => ({
	id: id(n),
	kind,
	party_id: id(from),
	other_party_id: id(to),
	started_on: "2025-03-01",
	ended_on: null,
	note: `Example note ${n}`,
	created_at: "2025-03-04 00:00:00+00",
	changed_by_user_id: PARTNER,
	changed_by_job: null,
	changed_at: "2025-03-04 00:00:00+00",
});

test("who knows or can introduce whom is copied, and a link with no place is listed with why", () =>
	rolledBack(async () => {
		const listed = (await copy(LINKS))?.filter((row) =>
			LINK_FIELDS.includes(row[1] as string),
		);
		assert.deepEqual(await rows(LINK_ROWS), [
			copiedLink(80, "knows", 10, 11),
			copiedLink(84, "can_introduce", 17, 11),
			copiedLink(85, "can_introduce", 10, 11),
			copiedLink(92, "knows", 17, 19),
		]);
		// biome-ignore format: one row per value
		assert.deepEqual(listed, [
			[id(81), "party_link", "knows", "the same link is kept already"],
			[id(82), "party_link", "knows", "it links a record to itself"],
			[id(83), "party_link", "knows", "a party it links is not copied"],
			[id(86), "party_link", "can_introduce", "neither end is a user"],
			[id(87), "party_link", "can_introduce", "both ends are users"],
			[id(88), "party_link", "can_introduce", "a party it links is not copied"],
			[id(89), "party_link", "works_with", "outside the owner's ruling"],
			[id(90), "party_link", "intro_requested", "outside the owner's ruling"],
			[id(91), "party_link", "example_kind", "not a kind of link"],
			[id(92), "via_party", id(11), "a knows link has no broker"],
		]);
		const links = await rows(LINK_ROWS);
		const history = await rows("select * from change order by id");
		await db.query("discard temp");
		assert.deepEqual(
			(await copy())?.filter((row) => LINK_FIELDS.includes(row[1] as string)),
			listed,
		);
		assert.deepEqual(await rows(LINK_ROWS), links);
		assert.deepEqual(await rows("select * from change order by id"), history);
	}));

for (const [sql, code] of [
	[
		`insert into party_link (kind, party_id, other_party_id, started_on) values ('knows', '${id(11)}', '${id(10)}', '2025-03-01')`,
		"23505",
	],
	[
		`insert into party_link (kind, party_id, other_party_id, started_on) values ('can_introduce', '${id(17)}', '${id(11)}', '2025-03-01')`,
		"23505",
	],
	[
		`update party_link set ended_on = '2025-02-28' where id = '${id(80)}'`,
		"23514",
	],
] satisfies [string, string][]) {
	test(`a copied link is guarded: ${sql}`, () =>
		rolledBack(async () => {
			await copy(LINKS);
			await db.query(`set constraints all immediate; set local role engine;
			select set_config('engine.user_id', '${PARTNER}', true); select set_config('engine.job', '', true);`);
			await assert.rejects(db.query(sql), { code });
		}));
}
