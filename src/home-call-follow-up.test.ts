import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { sql } from "kysely";
import { nextTransaction } from "./next-connection.ts";
import { isArguments } from "./save-door.ts";
import { doorTest } from "./test-door.ts";

const { db, writerUrl, setup, cleanup, request, save } = doorTest();
const recorder = { user: "joe" };
const editor = { user: "dell" };
const recorderId = randomUUID();
const editorId = randomUUID();
const deal = randomUUID();
const recordedCall = randomUUID();
const recordedFollowUp = randomUUID();
const copiedCall = randomUUID();
const copiedFollowUp = randomUUID();

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into job values ('call_capture', 'Example call capture');
		insert into party (id, kind, name) values
			('${recorderId}', 'person', 'Example Recorder'), ('${editorId}', 'person', 'Example Editor');
		insert into app_user (id, slug) values ('${recorderId}', '${recorder.user}'), ('${editorId}', '${editor.user}');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Follow-up Deal', '${recorderId}');

		select set_config('engine.job', 'call_capture', true), set_config('engine.user_id', '${recorderId}', true);
		insert into activity (id, kind, happened_at, summary)
			values ('${recordedCall}', 'call', '2001-02-03T15:00Z', 'The recorder took this call.');
		insert into activity_about (activity_id, deal_id) values ('${recordedCall}', '${deal}');
		insert into proposal (id, kind, activity_id, activity_kind, proposed_by_job, deal_id, what, evidence)
			values ('${recordedFollowUp}', 'log_call', '${recordedCall}', 'call', 'call_capture', '${deal}',
				'Log the recorded call.', 'The recorder took this call.');

		select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
		insert into activity (id, kind, happened_at, summary)
			values ('${copiedCall}', 'call', '2001-02-04T15:00Z', 'A copied call.');
		insert into activity_about (activity_id, deal_id) values ('${copiedCall}', '${deal}');
		select set_config('engine.user_id', '${editorId}', true);
		insert into proposal (id, kind, activity_id, activity_kind, proposed_by_job, deal_id, what, evidence)
			values ('${copiedFollowUp}', 'log_call', '${copiedCall}', 'call', 'old_system', '${deal}',
				'Log the copied call.', 'A copied call.');
		commit;`);
});
after(cleanup);

async function inboxJson(caller: { user: string }) {
	const response = await request(
		caller,
		"home/inbox",
		{ method: "GET" },
		{ HOME_INBOX_READ_SCHEMA: "next" },
	);
	assert.equal(response.status, 200);
	const body: unknown = await response.json();
	assert.ok(isArguments(body) && Array.isArray(body.items));
	return JSON.stringify(body.items);
}

async function detailStatus(caller: { user: string }, proposal: string) {
	const [status] = await save(caller, `proposals/${proposal}`, {}, "GET");
	return status;
}

test("a call's follow-up stays with its recorder after another partner edits the call", async () => {
	await nextTransaction(writerUrl, "save", async (tx) => {
		await sql`select set_config('engine.user_id', ${editorId}, true)`.execute(
			tx,
		);
		await tx
			.updateTable("activity")
			.set({ summary: "The editor corrected this call." })
			.where("id", "=", recordedCall)
			.execute();
	});
	const {
		rows: [call],
	} = await db.query(
		"select call_owner_user_id, changed_by_user_id, summary from activity where id = $1",
		[recordedCall],
	);
	assert.deepEqual(call, {
		call_owner_user_id: recorderId,
		changed_by_user_id: editorId,
		summary: "The editor corrected this call.",
	});

	assert.ok((await inboxJson(recorder)).includes(recordedFollowUp));
	assert.ok(!(await inboxJson(editor)).includes(recordedFollowUp));
	assert.equal(await detailStatus(recorder, recordedFollowUp), 200);
	assert.equal(await detailStatus(editor, recordedFollowUp), 404);
});

test("a copied call with no recorder sends its copied log only to the partner it was stamped for", async () => {
	const {
		rows: [call],
	} = await db.query("select call_owner_user_id from activity where id = $1", [
		copiedCall,
	]);
	assert.deepEqual(call, { call_owner_user_id: null });

	assert.ok((await inboxJson(editor)).includes(copiedFollowUp));
	assert.ok(!(await inboxJson(recorder)).includes(copiedFollowUp));
	assert.equal(await detailStatus(editor, copiedFollowUp), 200);
	assert.equal(await detailStatus(recorder, copiedFollowUp), 404);
});
