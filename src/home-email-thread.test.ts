import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, request } = doorTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const partner = id(1);
const deal = id(10);
const [ask, reply, confirm, confirmCopy] = [id(20), id(21), id(22), id(23)];

const askBody =
	"Can you send the plan?\n\nThanks,\nMaya Example\nDirect: 555-010-2000\nmaya@example.test";
const replyAuthored = "Here it is.\n\nThanks,\nSam";
const replyHistory =
	"On Mon, Nov 2, 2026 at 9:00 AM Maya Example <maya@example.test> wrote:\n> Can you send the plan?";
const confirmBody = "Tuesday works.\n\n> Here it is.";

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${partner}', 'person', 'Alex Example');
		insert into app_user (id, slug) values ('${partner}', 'alex');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example lease', '${partner}');
		insert into activity (id, kind, happened_at) values
			('${ask}', 'email', '2026-11-02T15:00:00Z'), ('${reply}', 'email', '2026-11-03T15:00:00Z'),
			('${confirm}', 'email', '2026-11-04T15:00:00Z'), ('${confirmCopy}', 'email', '2026-11-04T15:00:00Z');`);
	const maya = ["maya@example.test", "Maya Example"];
	const sam = ["sam@example.test", "Sam Example"];
	const emails = [
		[ask, "ask@example.test", ...maya, askBody, null, null],
		[
			reply,
			"reply@example.test",
			...sam,
			`${replyAuthored}\n\n${replyHistory}`,
			replyAuthored,
			replyHistory,
		],
		[
			confirm,
			"confirm@example.test",
			...maya,
			confirmBody,
			"Tuesday works.",
			"  ",
		],
		[confirmCopy, null, ...maya, confirmBody, null, null],
	];
	for (const row of emails) {
		await db.query(
			`insert into email
				(activity_id, message_id, sender, sender_name, body, authored, history, imported, conversation_id, subject)
			values ($1, $2::text, $3, $4, $5, $6, $7, $2 is null, 'Example thread', 'Suite plan')`,
			row,
		);
		await db.query(
			"insert into email_mailbox (activity_id, user_id) values ($1, $2)",
			[row[0], partner],
		);
		await db.query(
			"insert into activity_about (activity_id, deal_id) values ($1, $2)",
			[row[0], deal],
		);
	}
	await db.query("commit");
});

after(async () => {
	await db.query("rollback");
	await cleanup();
});

type Message = { activity_id: string; body: string; folded: string | null };
const thread = async (source: string) => {
	const response = await request(
		{ user: "alex" },
		`deals/${deal}/emails/${source}`,
		{},
		{ DEALS_READ_SCHEMA: "next" },
	);
	assert.equal(response.status, 200);
	const { thread } = (await response.json()) as { thread: Message[] };
	return thread.map(({ activity_id, body, folded }) => ({
		activity_id,
		body,
		folded,
	}));
};

test("an email with a stored split shows what the sender wrote, sign-off included, and folds its history", async () => {
	const messages = await thread(reply);
	assert.deepEqual(messages[1], {
		activity_id: reply,
		body: replyAuthored,
		folded: replyHistory,
	});
	assert.deepEqual(messages[2], {
		activity_id: confirm,
		body: "Tuesday works.",
		folded: null,
	});
});

test("an email without a stored split shows its body as stored, unfolded", async () => {
	assert.deepEqual((await thread(ask))[0], {
		activity_id: ask,
		body: askBody,
		folded: null,
	});
});

test("a three-message thread keeps one entry per message, oldest first, whichever message is opened", async () => {
	for (const source of [ask, reply, confirm, confirmCopy]) {
		assert.deepEqual(
			(await thread(source)).map(({ activity_id }) => activity_id),
			[ask, reply, confirm],
		);
	}
});
