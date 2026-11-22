import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { sql } from "kysely";
import { askDocBackup } from "./doc-backup-client.ts";
import { docLinkOwnerTransaction } from "./doc-link.ts";
import { docPrompt } from "./doc-prompt.ts";
import { claimDocWork, finishDocTurn } from "./doc-queue.ts";
import { withDocTools } from "./doc-tool-session.ts";
import { failureKind } from "./failure.ts";
import { nextTransaction } from "./next-connection.ts";
import type { WriterEnv } from "./save.ts";

export type DocBackupBindings = Pick<
	WriterEnv["Bindings"],
	"DATABASE" | "DATABASE_WRITER"
> & {
	DOC_BACKUP?: string;
	DOC_BACKUP_API_KEY?: string;
	DOC_BACKUP_MODEL?: string;
};

type TurnClaim = Extract<
	Awaited<ReturnType<typeof claimDocWork>>,
	{ kind: "turn" }
>;

type BackupConfig = {
	apiKey: string;
	model: string;
	reader: string;
	writer: string;
};
const backupPrompt = docPrompt.replace("The JSON on stdin", "The input JSON");
const backupLockTimeout = sql`set local lock_timeout = '1s'`;

function backupOwnerTransaction<T>(
	writer: string,
	owner: string,
	run: Parameters<typeof docLinkOwnerTransaction<T>>[2],
) {
	return docLinkOwnerTransaction(writer, owner, async (tx) => {
		await backupLockTimeout.execute(tx);
		return run(tx);
	});
}

async function answerTurn(
	{ apiKey, model, reader, writer }: BackupConfig,
	owner: string,
	{ claim_id, turn, history }: TurnClaim,
) {
	const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
	const { InMemoryTransport } = await import(
		"@modelcontextprotocol/sdk/inMemory.js"
	);
	const { CallToolResultSchema } = await import(
		"@modelcontextprotocol/sdk/types.js"
	);
	const toolSession = <T>(
		run: (client: Client, timeout: number) => Promise<T>,
	) =>
		backupOwnerTransaction(writer, owner, (tx) =>
			withDocTools(tx, owner, claim_id, reader, async (server, timeout) => {
				const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
				const client = new Client({ name: "doc-backup", version: "1.0.0" });
				await server.connect(serverSide);
				await client.connect(clientSide);
				return run(client, timeout);
			}),
		);
	const start = performance.now();
	const session = await toolSession(async (client, timeout) => ({
		tools: (await client.listTools()).tools,
		timeout,
	}));
	const result =
		session &&
		(await askDocBackup({
			apiKey,
			model,
			system: backupPrompt,
			messages: [{ role: "user", content: JSON.stringify({ turn, history }) }],
			tools: session.tools,
			timeoutMs: session.timeout - (performance.now() - start),
			async runTool({ name, arguments: args }, signal) {
				signal.throwIfAborted();
				const reply = await toolSession((client) =>
					client.callTool({ name, arguments: args }, undefined, { signal }),
				);
				if (!reply) throw new Error("Doc claim expired");
				return CallToolResultSchema.parse(reply);
			},
		}));
	const creditsExhausted = result?.kind === "credits_exhausted";
	await backupOwnerTransaction(writer, owner, async (tx) => {
		if (result?.kind === "answer") {
			let answer: unknown = null;
			try {
				answer = JSON.parse(result.text);
			} catch {
				// Let the shared answer validator handle an invalid model response.
			}
			const status = await finishDocTurn(tx, owner, {
				claim_id,
				kind: "answered",
				answer,
				answered_by: "backup",
			});
			if (status !== 422) return;
		}
		await finishDocTurn(tx, owner, {
			claim_id,
			kind: creditsExhausted ? "queued" : "failed",
		});
	}).catch((error: unknown) => {
		console.warn("Doc backup completion failed:", failureKind(error));
	});
	return creditsExhausted;
}

export async function dispatchDocBackup(env: DocBackupBindings) {
	const {
		DOC_BACKUP_API_KEY: apiKey,
		DOC_BACKUP_MODEL: model,
		DATABASE,
		DATABASE_WRITER,
	} = env;
	if (
		env.DOC_BACKUP !== "true" ||
		!apiKey?.trim() ||
		!model?.trim() ||
		!DATABASE ||
		!DATABASE_WRITER
	)
		return;
	const writer = DATABASE_WRITER.connectionString;
	const config = { apiKey, model, writer, reader: DATABASE.connectionString };
	const owners = await nextTransaction(writer, "save", async (tx) => {
		await backupLockTimeout.execute(tx);
		return tx
			.selectFrom("app_user")
			.select("id")
			.where("is_account_partner", "=", true)
			.orderBy("id")
			.execute();
	});
	for (const { id: owner } of owners) {
		try {
			const claim = await backupOwnerTransaction(writer, owner, (tx) =>
				claimDocWork(tx, owner, "backup"),
			);
			if (claim?.kind === "turn" && (await answerTurn(config, owner, claim)))
				return;
		} catch (error) {
			console.warn("Doc backup turn failed:", failureKind(error));
		}
	}
}
