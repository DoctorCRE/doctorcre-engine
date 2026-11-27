import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, request } = doorTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const deal = id(10);
const otherDeal = id(11);
const alex = { user: "alex" };
const casey = { user: "casey" };
const ask = id(20);
const reply = id(21);
const onOtherDeal = id(22);
const caseyOnly = id(23);
const call = id(24);

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${id(1)}', 'person', 'Alex Example'), ('${id(2)}', 'person', 'Casey Example');
		insert into app_user (id, slug) values ('${id(1)}', 'alex'), ('${id(2)}', 'casey');
		insert into deal (id, name, owner_user_id) values
			('${deal}', 'Example lease', '${id(1)}'), ('${otherDeal}', 'Example purchase', '${id(2)}');
		insert into activity (id, kind, happened_at) values
			('${ask}', 'email', '2026-11-02T15:00:00Z'), ('${reply}', 'email', '2026-11-03T15:00:00Z'),
			('${onOtherDeal}', 'email', '2026-11-04T15:00:00Z'), ('${caseyOnly}', 'email', '2026-11-05T15:00:00Z'),
			('${call}', 'call', '2026-11-06T15:00:00Z');
		insert into email (activity_id, message_id, conversation_id, sender, sender_name, subject, body, authored, history) values
			('${ask}', 'ask@example.test', 'Suite thread', 'rob@example.test', 'Rob Example', 'Suite plan',
				'Can you send the plan?', null, null),
			('${reply}', 'reply@example.test', 'Suite thread', 'sam@example.test', 'Sam Example', 'RE: Suite plan',
				E'Here it is.\\n\\nOn Mon, Nov 2, 2026 at 9:00 AM Rob Example <rob@example.test> wrote:\\n> Can you send the plan?',
				'Here it is.', E'On Mon, Nov 2, 2026 at 9:00 AM Rob Example <rob@example.test> wrote:\\n> Can you send the plan?'),
			('${onOtherDeal}', 'other@example.test', null, 'rob@example.test', 'Rob Example', 'Other', 'Other deal.', null, null),
			('${caseyOnly}', 'casey@example.test', null, 'rob@example.test', 'Rob Example', 'Private', 'For Casey.', null, null);
		insert into email_mailbox (activity_id, user_id) values
			('${ask}', '${id(1)}'), ('${reply}', '${id(1)}'), ('${ask}', '${id(2)}'), ('${reply}', '${id(2)}'),
			('${onOtherDeal}', '${id(1)}'), ('${caseyOnly}', '${id(2)}');
		insert into activity_about (activity_id, party_id) values ('${ask}', '${id(1)}');
		insert into activity_about (activity_id, deal_id) values
			('${reply}', '${deal}'), ('${onOtherDeal}', '${otherDeal}'), ('${caseyOnly}', '${deal}'), ('${call}', '${deal}');
		commit;`);
});

after(async () => {
	await db.query("rollback");
	await cleanup();
});

const binding = { DEALS_READ_SCHEMA: "next" };
type Message = {
	activity_id: string;
	sender_name: string | null;
	happened_at: string;
	body: string;
	folded: string | null;
};
const thread = async (response: Response) =>
	((await response.json()) as { thread: Message[] }).thread;
const read = (email: string, caller = alex, dealId = deal) =>
	request(caller, `deals/${dealId}/emails/${email}`, {}, binding);

test("a filed email opens as its conversation, oldest first", async () => {
	for (const caller of [alex, casey]) {
		const response = await read(reply, caller);
		assert.equal(response.status, 200);
		const messages = await thread(response);
		assert.deepEqual(
			messages.map(({ activity_id, sender_name, body }) => ({
				activity_id,
				sender_name,
				body,
			})),
			[
				{
					activity_id: ask,
					sender_name: "Rob Example",
					body: "Can you send the plan?",
				},
				{ activity_id: reply, sender_name: "Sam Example", body: "Here it is." },
			],
		);
		assert.match(messages[1]?.folded ?? "", /wrote:/);
		assert.equal(messages[0]?.happened_at, "2026-11-02T15:00:00.000Z");
	}
});

test("an email outside the partner's mailbox opens with no messages", async () => {
	const response = await read(caseyOnly);
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { thread: [] });
	const own = await read(caseyOnly, casey);
	assert.equal((await thread(own))[0]?.body, "For Casey.");
});

for (const [why, email, dealId] of [
	["filed to a different deal", onOtherDeal, deal],
	["not filed to the deal", ask, deal],
	["that is a call", call, deal],
	["on an unknown deal", reply, id(99)],
	["named by a malformed id", "not-a-uuid", deal],
] as const) {
	test(`a record ${why} is not found`, async () => {
		const response = await read(email, alex, dealId);
		assert.equal(response.status, 404);
		assert.partialDeepStrictEqual(await response.json(), {
			error: "not_found",
		});
	});
}

test("a session without deal page access cannot read a deal's email", async () => {
	const response = await read(reply, { user: "unprovisioned" });
	assert.equal(response.status, 422);
	assert.partialDeepStrictEqual(await response.json(), {
		error: "unauthenticated",
	});
});
