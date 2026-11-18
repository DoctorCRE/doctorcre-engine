import assert from "node:assert/strict";
import type pg from "pg";

export const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Old completion events on one record's actions 800 to 807; only 806 is still open.
export const completionEvents = (subject: string, record: number) => `
 update public.next_action set status='done' where subject_type='${subject}' and subject_id='${id(record)}' and owner_id='${id(1)}' and status='open';
 update next_step set resolution='done' where owner_party_id='${id(1)}' and status='open' and item_title is null
 and (deal_id='${id(record)}' or party_id in (select party_id from outside_id where source='old_system' and value='${id(record)}'));
 insert into public.next_action (id,subject_type,subject_id,owner_id,description,status,created_at,updated_at,created_by)
 select v.id, '${subject}', '${id(record)}', '${id(1)}', 'Example completion ' || v.id,
 case when v.n = 806 then 'open' else 'done' end, '2025-01-01', '2025-04-01', '${id(1)}'
 from (select n, ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid as id from generate_series(800,807) n) v;
 insert into public.event (subject_type,subject_id,new_value,actor_id,verb,cause,occurred_at) values
 ('${subject}','${id(record)}','{"next_action_id":"${id(800)}","status":"done"}','${id(1)}','complete-action','human_stated','2025-01-10'),
 ('${subject}','${id(record)}','{"completed":"${id(801)}","next_action":"${id(806)}"}','${id(1)}','log-outreach','human_stated','2025-01-11'),
 ('${subject}','${id(record)}','{"next_action_id":"${id(803)}","status":"done"}','${id(1)}','complete-action','human_stated','2025-01-12'),
 ('${subject}','${id(record)}','{"action_id":"${id(803)}","status":"open"}','${id(1)}','reopen-one-action','human_stated','2025-01-13'),
 ('${subject}','${id(record)}','{"completed":"${id(804)}"}','${id(1)}','log-outreach','human_stated','2025-01-20'),
 ('${subject}','${id(record)}','{"action_id":"${id(804)}","status":"open"}','${id(1)}','reopen-one-action','human_stated','2025-01-21'),
 ('${subject}','${id(record)}','{"next_action_id":"${id(804)}","status":"done"}','${id(1)}','complete-action','human_stated','2025-01-14'),
 ('${subject}','${id(record)}','{"completed":null,"next_action":"${id(805)}"}','${id(1)}','log-outreach','human_stated','2025-01-15'),
 ('${subject}','${id(record)}','{"completed":"${id(807)}"}','${id(1)}','log-outreach','human_stated','2025-01-16'),
 ('${subject}','${id(record)}','{"action_id":"${id(807)}","status":"open"}','${id(1)}','reopen-one-action','human_stated','2025-01-17');`;

export async function assertCompletionDates(
	rows: (sql: string) => Promise<pg.QueryResultRow[]>,
) {
	const steps = await rows(
		`select id,status,done_at::text from next_step where id between '${id(800)}' and '${id(807)}' order by id`,
	);
	assert.deepEqual(steps.map(Object.values), [
		[id(800), "done", "2025-01-10 00:00:00+00"],
		[id(801), "done", "2025-01-11 00:00:00+00"],
		[id(802), "done", null],
		[id(803), "done", null],
		[id(804), "done", "2025-01-14 00:00:00+00"],
		[id(805), "done", null],
		[id(806), "open", null],
		[id(807), "done", null],
	]);
}

export const stepsAndHistory =
	"select jsonb_agg(s order by id) as steps, (select jsonb_agg(c order by id) from change c) as history from next_step s";
