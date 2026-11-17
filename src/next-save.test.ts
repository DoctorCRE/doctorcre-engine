import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { JsonObject } from "./database.d.ts";
import { changeDeal } from "./deals/next-change.ts";
import { type NextChange, runNextSave, type Stamp } from "./next-save.ts";
import { SaveRefusal } from "./save.ts";
import { copyTest } from "./test-copy.ts";

const { db, setup, cleanup, connectionString } = copyTest();
const writer = `next_save_${randomUUID().replaceAll("-", "")}`;
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ALEX, BLAIR, CASEY, DEAL] = [id(1), id(2), id(3), id(4)];
const login = () => {
	const url = new URL(connectionString);
	url.username = writer;
	return url.href;
};

before(async () => {
	await setup();
	await db.query(`create role ${writer} login; grant engine to ${writer};
		begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${ALEX}', 'person', 'Alex Example'), ('${BLAIR}', 'person', 'Blair Example'), ('${CASEY}', 'person', 'Casey Example');
		insert into app_user (id, slug) values ('${ALEX}', 'alex'), ('${BLAIR}', 'blair'), ('${CASEY}', 'casey');
		insert into deal (id, name, owner_user_id) values ('${DEAL}', 'Example Deal', '${ALEX}'); commit;`);
});
after(async () => {
	await db.query(`drop owned by ${writer}; drop role ${writer}`);
	await cleanup();
});

const latestChange = async () =>
	Number(
		(await db.query("select coalesce(max(id), 0) as id from change")).rows[0]
			.id,
	);

const save = (stamp: Stamp, args: JsonObject, change: NextChange) =>
	runNextSave(login(), { stamp, verb: "example-save", args }, change);

// Moves the deal to the owner named in the arguments, from the change the partner last saw.
const handOver: NextChange = async (tx, args) => {
	const owner = await tx
		.selectFrom("app_user")
		.select("id")
		.where("slug", "=", String(args.owner))
		.executeTakeFirstOrThrow();
	return changeDeal(tx, DEAL, Number(args.seen), { owner_user_id: owner.id });
};
const flag: NextChange = (tx, args) =>
	changeDeal(tx, DEAL, Number(args.seen), {
		needs_attention: Boolean(args.flag),
	});

const refusedAs =
	(error: string) =>
	(thrown: unknown): thrown is SaveRefusal =>
		thrown instanceof SaveRefusal && thrown.refusal.error === error;

const stampOfDeal = async () =>
	(
		await db.query(
			`select u.slug as by_user, d.changed_by_job as by_job, f.slug as for_user
			from deal d left join app_user u on u.id = d.changed_by_user_id
			left join app_user f on f.id = d.changed_for_user_id where d.id = $1`,
			[DEAL],
		)
	).rows[0];

test("a save names the partner or the job that made it", async () => {
	// @ts-expect-error A stamp names a partner or a job, never both.
	({ user: "alex", job: "agent" }) satisfies Stamp;
	const seen = await latestChange();
	await save(
		{ user: "blair" },
		{ idempotency_key: randomUUID(), seen, flag: true },
		flag,
	);
	assert.deepEqual(await stampOfDeal(), {
		by_user: "blair",
		by_job: null,
		for_user: null,
	});
	await save(
		{ job: "agent", for_user: "alex" },
		{ idempotency_key: randomUUID(), seen: await latestChange(), flag: false },
		flag,
	);
	assert.deepEqual(await stampOfDeal(), {
		by_user: null,
		by_job: "agent",
		for_user: "alex",
	});
	await assert.rejects(
		save(
			{ user: "nobody" },
			{ idempotency_key: randomUUID(), seen, flag: true },
			flag,
		),
		refusedAs("actor_not_provisioned"),
	);
});

test("a retried save lands once and answers the same", async () => {
	const args = {
		idempotency_key: randomUUID(),
		seen: await latestChange(),
		owner: "blair",
	};
	const before = await latestChange();
	const [first, second] = await Promise.all([
		save({ user: "alex" }, args, handOver),
		save({ user: "alex" }, args, handOver),
	]);
	const third = await save({ user: "alex" }, args, handOver);
	const answer = { deal_id: DEAL, change_id: before + 1 };
	assert.deepEqual(
		new Set([JSON.stringify(first), JSON.stringify(second)]),
		new Set([
			JSON.stringify(answer),
			JSON.stringify({ replayed: true, ...answer }),
		]),
	);
	assert.deepEqual(third, { replayed: true, ...answer });
	assert.equal(await latestChange(), before + 1);
	await assert.rejects(
		save({ user: "alex" }, { ...args, owner: "alex" }, handOver),
		refusedAs("key_reuse"),
	);
	await assert.rejects(
		save({ user: "blair" }, args, handOver),
		refusedAs("key_reuse"),
	);
});

test("a crossed edit is refused, and so is its retry", async () => {
	const seen = await latestChange();
	const tries = ["alex", "casey"].map((owner) => ({
		idempotency_key: randomUUID(),
		seen,
		owner,
	}));
	const outcomes = await Promise.allSettled(
		tries.map((args) => save({ user: "blair" }, args, handOver)),
	);
	const [won, lost] =
		outcomes[0]?.status === "fulfilled" ? tries : tries.toReversed();
	const refused = outcomes.find((o) => o.status === "rejected");
	assert.ok(won && lost && refused);
	assert.ok(refusedAs("version_conflict")(refused.reason));
	assert.deepEqual(
		(
			await db.query(
				"select u.slug from deal d join app_user u on u.id = d.owner_user_id",
			)
		).rows,
		[{ slug: won.owner }],
	);
	await assert.rejects(
		save({ user: "blair" }, lost, handOver),
		refusedAs("version_conflict"),
	);
});

test("an edit over an unseen change to another field stands and answers rebased, so the next save re-reads", async () => {
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		update deal set owner_user_id = '${ALEX}', needs_attention = false; commit;`);
	const seen = await latestChange();
	await save(
		{ user: "blair" },
		{ idempotency_key: randomUUID(), seen, owner: "casey" },
		handOver,
	);
	const flagged = await save(
		{ user: "alex" },
		{ idempotency_key: randomUUID(), seen, flag: true },
		flag,
	);
	assert.deepEqual(flagged, {
		deal_id: DEAL,
		rebased: true,
		intervening_change_ids: [seen + 1],
	});
	assert.equal(
		(await db.query("select needs_attention from deal")).rows[0]
			.needs_attention,
		true,
	);
	await assert.rejects(
		save(
			{ user: "alex" },
			{ idempotency_key: randomUUID(), seen, owner: "alex" },
			handOver,
		),
		(thrown) =>
			refusedAs("version_conflict")(thrown) &&
			thrown.refusal.extra.current_version === seen + 2,
	);
});
