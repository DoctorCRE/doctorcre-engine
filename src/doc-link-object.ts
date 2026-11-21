import { DurableObject } from "cloudflare:workers";
import { randomBytes } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { credentialHash, docLinkRefusal } from "./doc-link.ts";
import { nextTransaction } from "./next-connection.ts";
import type { DB } from "./next-database.d.ts";
import { asText } from "./reader.ts";
import type { WriterEnv } from "./save.ts";

export class DocLink extends DurableObject<WriterEnv["Bindings"]> {
	#pending = Promise.resolve();

	async #serialize<T>(run: () => Promise<T>): Promise<T> {
		const previous = this.#pending;
		const { promise, resolve } = Promise.withResolvers<void>();
		this.#pending = promise;
		await previous;
		try {
			return await run();
		} finally {
			resolve();
		}
	}

	#ownerTransaction<T>(
		run: (tx: Transaction<DB>, owner: string) => Promise<T>,
	) {
		const owner = this.ctx.id.name;
		const writer = this.env.DATABASE_WRITER;
		if (!owner || !writer) throw new Error("Doc link unavailable");
		return nextTransaction(writer.connectionString, "save", async (tx) => {
			await sql`select set_config('engine.user_id', ${owner}, true)`.execute(
				tx,
			);
			return run(tx, owner);
		});
	}

	#openSockets() {
		return this.ctx
			.getWebSockets()
			.filter((socket) => socket.readyState === WebSocket.OPEN);
	}

	#closeLink(reason: string) {
		for (const socket of this.#openSockets()) socket.close(1008, reason);
	}

	issue() {
		return this.#serialize(async () => {
			const credential = randomBytes(32).toString("base64url");
			const hash = credentialHash(credential);
			await this.#ownerTransaction(async (tx, owner) => {
				await tx
					.insertInto("doc_link")
					.values({ owner_user_id: owner, credential_hash: hash })
					.onConflict((conflict) =>
						conflict
							.column("owner_user_id")
							.doUpdateSet({ credential_hash: hash, issued_at: sql`now()` }),
					)
					.execute();
				// Close before commit so a committed rotation cannot leave the old socket live.
				this.#closeLink("Credential replaced");
			});
			return { credential };
		});
	}

	revoke() {
		return this.#serialize(() =>
			this.#ownerTransaction(async (tx, owner) => {
				await tx
					.deleteFrom("doc_link")
					.where("owner_user_id", "=", owner)
					.execute();
				this.#closeLink("Credential revoked");
			}),
		);
	}

	presence() {
		return this.#serialize(() =>
			this.#ownerTransaction(async (tx, owner) => {
				const link = await tx
					.selectFrom("doc_link")
					.select(asText(sql.ref("issued_at")).as("issued_at"))
					.where("owner_user_id", "=", owner)
					.executeTakeFirst();
				return {
					connected: this.#openSockets().length > 0,
					issued_at: link?.issued_at ?? null,
				};
			}),
		);
	}

	fetch(request: Request) {
		return this.#serialize(async () => {
			const hash = request.headers.get("Doc-Link-Hash");
			if (!hash) return docLinkRefusal(401);
			const authorized = await this.#ownerTransaction((tx, owner) =>
				tx
					.selectFrom("doc_link")
					.select("owner_user_id")
					.where("owner_user_id", "=", owner)
					.where("credential_hash", "=", hash)
					.executeTakeFirst(),
			);
			if (!authorized) return docLinkRefusal(401);

			const { 0: client, 1: server } = new WebSocketPair();
			this.#closeLink("Another Mac connected");
			this.ctx.acceptWebSocket(server);
			return new Response(null, {
				status: 101,
				webSocket: client,
				headers: { "Cache-Control": "no-store" },
			});
		});
	}

	webSocketClose(socket: WebSocket, code: number, reason: string) {
		if ([1005, 1006].includes(code)) socket.close();
		else socket.close(code, reason);
	}

	webSocketMessage() {
		// Turn routing is added in #978.
	}
}
