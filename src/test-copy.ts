import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import pg from "pg";
import { asAdmin } from "../scripts/test-database.ts";

const closingClients = new Map<string, Promise<void>[]>();
const Pool = pg.Pool;
pg.Pool = class extends Pool {
	constructor(config?: pg.PoolConfig) {
		super(config);
		const database = config?.connectionString
			? new URL(config.connectionString).pathname.slice(1)
			: undefined;
		const clients = database ? closingClients.get(database) : undefined;
		if (clients) {
			this.on("connect", (client) => {
				clients.push(
					new Promise<void>((resolve) => client.once("end", resolve)),
				);
			});
		}
	}
};

export function readSchema(file: string): Promise<string> {
	return readFile(new URL(`../schema/${file}`, import.meta.url), "utf8");
}

export function copyTest() {
	const name = `copy_${randomUUID().replaceAll("-", "")}`;
	const clients: Promise<void>[] = [];
	closingClients.set(name, clients);
	const url = new URL(
		process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1/postgres",
	);
	url.pathname = `/${name}`;
	const db = new pg.Client({
		connectionString: url.href,
		options: "-c search_path=next -c TimeZone=UTC",
	});
	const setup = async () => {
		const template = process.env.TEST_COPY_SNAPSHOT;
		assert.ok(template, "Run npm run check");
		await asAdmin(
			`create database "${name}" template "${template}"`,
			// Compiling the copy queries costs more than running them on small fixtures.
			`alter database "${name}" set jit = off`,
		);
		await db.connect();
	};
	const cleanup = async () => {
		await db.end();
		await Promise.all(clients);
		closingClients.delete(name);
		await asAdmin(`drop database if exists "${name}" with (force)`);
	};
	return { db, setup, cleanup, connectionString: url.href };
}
