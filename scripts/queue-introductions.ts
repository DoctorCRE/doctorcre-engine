import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import { introductionMails } from "../src/activity/introduction-judgment.ts";
import type { DB } from "../src/next-database.d.ts";

export async function main() {
	const connectionString = process.env.DATABASE_URL;
	if (
		!connectionString ||
		process.argv.slice(2).some((arg) => arg !== "--dry-run")
	) {
		console.error("Set DATABASE_URL and optionally pass --dry-run.");
		process.exit(2);
	}
	const dryRun = process.argv.includes("--dry-run");
	const db = new Kysely<DB>({
		dialect: new PostgresDialect({
			pool: new pg.Pool({ connectionString, options: "-c search_path=next" }),
		}),
	});
	try {
		const tx = await db.startTransaction().execute();
		try {
			await sql`select set_config('engine.job', 'mail_capture', true)`.execute(
				tx,
			);
			const {
				rows: [ownership],
			} = await sql<{ owner: boolean }>`
				select current_user = pg_get_userbyid(relowner) as owner from pg_class where oid = 'next.email'::regclass
			`.execute(tx);
			if (!ownership?.owner) throw new Error("Schema owner required");
			let cursor = "00000000-0000-0000-0000-000000000000";
			let eligible = 0;
			let queued = 0;
			let alreadyQueued = 0;
			while (true) {
				const { rows } = await sql<{
					activity_id: string;
					user_id: string;
					lock_key: string;
				}>`
				select e.activity_id, m.user_id, coalesce(e.message_id, e.activity_id::text) as lock_key
				from email e join lateral (
					select m.user_id from email_mailbox m join app_user u on u.id = m.user_id
					where m.activity_id = e.activity_id and u.is_account_partner order by m.user_id limit 1
				) m on true
				where e.activity_id > ${cursor}::uuid
					and not exists (select from lead_email_source s where s.activity_id = e.activity_id)
					and not exists (select from lead_source_sender s where lower(s.address) = e.sender or s.domain = split_part(e.sender, '@', 2))
				order by e.activity_id limit 100
			`.execute(tx);
				const last = rows.at(-1);
				if (!last) break;
				cursor = last.activity_id;
				const matches = new Set(
					(
						await introductionMails(
							tx,
							rows.map((row) => row.activity_id),
						)
					).map((mail) => mail.activity_id),
				);
				for (const row of rows) {
					if (!matches.has(row.activity_id)) continue;
					eligible++;
					await sql`select pg_advisory_xact_lock(hashtextextended('email ' || ${row.lock_key}, 0))`.execute(
						tx,
					);
					const {
						rows: [existing],
					} = await sql<{ queued: boolean }>`select exists (
						select from doc_judgment_job where activity_id = ${row.activity_id}::uuid and kind = 'introduction'
					) as queued`.execute(tx);
					if (existing?.queued) {
						alreadyQueued++;
						continue;
					}
					await sql`select set_config('engine.user_id', ${row.user_id}, true)`.execute(
						tx,
					);
					await sql`select queue_introduction(${row.activity_id}::uuid)`.execute(
						tx,
					);
					queued++;
				}
			}
			if (dryRun) await tx.rollback().execute();
			else await tx.commit().execute();
			process.stdout.write(
				`eligible,queued,already_queued\n${eligible},${queued},${alreadyQueued}\n${dryRun ? "dry_run" : "applied"}\n`,
			);
		} catch (error) {
			await tx.rollback().execute();
			throw error;
		}
	} catch {
		console.error("Introduction queue failed.");
		process.exitCode = 1;
	} finally {
		await db.destroy();
	}
}

if (
	process.argv[1] &&
	import.meta.url === new URL(process.argv[1], `file://${process.cwd()}/`).href
)
	await main();
