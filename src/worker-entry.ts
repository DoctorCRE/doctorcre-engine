import { WorkerEntrypoint } from "cloudflare:workers";
import {
	redeemWebsiteGrant,
	verifyWebsitePassword,
} from "./deals/client-website-access.ts";
import { failureKind } from "./failure.ts";
import type { WriterEnv } from "./save.ts";
import { recordWorkerStart } from "./worker.ts";

export { default } from "./worker.ts";

export class ClientWebsiteAccess extends WorkerEntrypoint<
	WriterEnv["Bindings"]
> {
	verifyPassword(slug: string, password: string) {
		return this.#access((connection) =>
			verifyWebsitePassword(connection, slug, password),
		);
	}

	redeemGrant(slug: string, grant: string) {
		return this.#access((connection) =>
			redeemWebsiteGrant(connection, slug, grant),
		);
	}

	async #access(check: (connection: string) => Promise<boolean>) {
		recordWorkerStart();
		const writer = this.env.DATABASE_WRITER;
		if (!writer) throw new Error("Client website database unavailable");
		try {
			return await check(writer.connectionString);
		} catch (error) {
			console.warn("client website access failed:", failureKind(error));
			throw new Error("Client website database unavailable");
		}
	}
}
