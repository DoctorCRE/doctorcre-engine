import type pg from "pg";

export async function blockedBy(
	db: pg.Client,
	request: Promise<unknown>,
	blocker?: number,
) {
	let settled = false;
	const finish = () => {
		settled = true;
	};
	void request.then(finish, finish);
	while (!settled) {
		const { rows } = await db.query<{ pid: number }>(
			`select distinct pid from pg_locks
			where not granted
			and coalesce($1, pg_backend_pid()) = any(pg_blocking_pids(pid))`,
			[blocker ?? null],
		);
		if (rows[0]) return rows[0].pid;
	}
}
