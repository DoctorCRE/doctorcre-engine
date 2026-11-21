import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { copyTest, readSchema } from "./test-copy.ts";

const { db, setup, cleanup } = copyTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1);
const other = id(2);
const turn = id(20);
const wrongKind = id(21);
const otherTurn = id(22);
const mail = id(10);
const otherMail = id(11);
const jobMail = id(12);
const receipt = id(30);

before(async () => {
	await setup();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into party (id, kind, name) values
			('${owner}', 'person', 'Example One'), ('${other}', 'person', 'Example Two');
		insert into app_user (id, slug) values ('${owner}', 'joe'), ('${other}', 'dell');
		insert into activity (id, kind, happened_at)
			select id, 'email', now() from unnest(array['${mail}', '${otherMail}', '${jobMail}']::uuid[]) id;
		insert into email (activity_id, message_id, sender, subject, body)
			select id, '<' || id || '@example.test>', 'sender@example.test', 'Example', 'Please reply' from activity;
		insert into activity_about (activity_id, party_id) select id, '${owner}' from activity;
		insert into doc_conversation (id, owner_user_id) values ('${id(3)}', '${owner}'), ('${id(4)}', '${other}');
		insert into save_receipt (idempotency_key, verb, request_hash, answer) values
			('${id(31)}', 'confirm-doc-turn', 'example', '{}'), ('${id(32)}', 'confirm-doc-turn', 'example', '{}');
		insert into doc_turn (id, conversation_id, owner_user_id, position, idempotency_key, request_hash,
			question, state, answer, confirmation_key)
		select id, chat, partner, position, gen_random_uuid(), 'example', 'Draft a reply', 'answered',
			jsonb_build_object('proposal', jsonb_build_object('kind', kind, 'target',
				jsonb_build_object('ref', jsonb_build_object('kind', 'email', 'id', '${mail}')))), confirmation
		from (values
			('${turn}'::uuid, '${id(3)}'::uuid, '${owner}'::uuid, 1, 'reply_draft', null::uuid),
			('${wrongKind}', '${id(3)}', '${owner}', 2, 'revise_draft', '${id(31)}'),
			('${otherTurn}', '${id(4)}', '${other}', 1, 'reply_draft', '${id(32)}'))
			as turns(id, chat, partner, position, kind, confirmation);
		commit;`);
});
after(cleanup);

const insertDraft = (
	email: string,
	partner: string,
	job: string | null,
	source: string | null,
) =>
	db.query(
		`insert into reply_draft (email_activity_id, owner_user_id, proposed_by_job, confirmed_doc_turn_id,
			evidence, subject, body) values ($1, $2, $3, $4, 'Please reply', 'Re: Example', 'Thanks')`,
		[email, partner, job, source],
	);

test("a Doc draft requires exactly one origin and its owner's confirmed proposal for that email", async () => {
	await db.query(`set role engine; set engine.user_id = '${owner}'`);
	try {
		await assert.rejects(insertDraft(mail, owner, null, null), {
			code: "23514",
			constraint: "reply_draft_one_origin",
		});
		for (const source of [id(99), turn, wrongKind, otherTurn]) {
			await assert.rejects(insertDraft(mail, owner, null, source), {
				code: "23514",
			});
		}
		await db.query("set engine.job = 'old_system'");
		await assert.rejects(insertDraft(mail, owner, "old_system", turn), {
			code: "23514",
			constraint: "reply_draft_one_origin",
		});
	} finally {
		await db.query("reset role; reset engine.user_id; reset engine.job");
	}

	await db.query(`begin; update doc_turn set confirmation_key = '${receipt}' where id = '${turn}';
		set local role engine; set local engine.user_id = '${owner}';`);
	try {
		await db.query("savepoint refused_draft");
		await assert.rejects(insertDraft(otherMail, owner, null, turn), {
			code: "23514",
		});
		await db.query("rollback to savepoint refused_draft");
		await insertDraft(mail, owner, null, turn);
		await db.query(`insert into save_receipt (idempotency_key, verb, request_hash, answer)
			values ('${receipt}', 'confirm-doc-turn', 'example', '{}')`);
		await db.query("commit");
	} finally {
		await db.query("rollback");
	}
	const { rows } = await db.query(
		`select proposed_by_job, confirmed_doc_turn_id, changed_by_user_id, status, revision
		from reply_draft where email_activity_id = $1`,
		[mail],
	);
	assert.deepEqual(rows, [
		{
			proposed_by_job: null,
			confirmed_doc_turn_id: turn,
			changed_by_user_id: owner,
			status: "pending",
			revision: 1,
		},
	]);
});

test("the origin migration preserves existing job drafts and can run twice", async (t) => {
	const old = copyTest();
	await old.setup();
	t.after(old.cleanup);
	await old.db.query(`drop trigger if exists reply_draft_doc_origin on reply_draft;
		drop function if exists reply_draft_doc_origin();
		alter table reply_draft drop column if exists confirmed_doc_turn_id, alter column proposed_by_job set not null;
		begin; set local engine.job = 'old_system';
		insert into party (id, kind, name) values ('${owner}', 'person', 'Example One');
		insert into app_user (id, slug) values ('${owner}', 'joe');
		insert into activity (id, kind, happened_at) values ('${jobMail}', 'email', now());
		insert into email (activity_id, message_id, sender, subject, body)
			values ('${jobMail}', '<job@example.test>', 'sender@example.test', 'Example', 'Please reply');
		insert into activity_about (activity_id, party_id) values ('${jobMail}', '${owner}');
		set local role engine;
		insert into reply_draft (email_activity_id, owner_user_id, proposed_by_job, evidence, subject, body)
			values ('${jobMail}', '${owner}', 'old_system', 'Please reply', 'Re: Example', 'Thanks');
		commit;`);
	const { rows } =
		await old.db.query(`select count(*)::int as drafts, count(*) filter (where proposed_by_job is null)::int as invalid
		from reply_draft`);
	assert.deepEqual(rows, [{ drafts: 1, invalid: 0 }]);
	const migration = await readSchema("add-reply-draft-doc-origin.sql");
	await old.db.query(migration);
	await old.db.query(migration);
	await old.db.query(`begin; set local role engine; set local engine.user_id = '${owner}';
		update reply_draft set body = 'Updated reply'; commit;`);
	assert.deepEqual(
		(
			await old.db.query(
				"select proposed_by_job, confirmed_doc_turn_id, body, revision from reply_draft",
			)
		).rows,
		[
			{
				proposed_by_job: "old_system",
				confirmed_doc_turn_id: null,
				body: "Updated reply",
				revision: 2,
			},
		],
	);
});
