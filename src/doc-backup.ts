import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { askDocBackup } from "./doc-backup-client.ts";
import { docLinkOwnerTransaction } from "./doc-link.ts";
import { withDocTools } from "./doc-mcp.ts";
import { docPrompt } from "./doc-prompt.ts";
import { claimDocWork, finishDocTurn } from "./doc-queue.ts";
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

async function answerTurn(
	{
		apiKey,
		model,
		reader,
		writer,
		owner,
	}: {
		apiKey: string;
		model: string;
		reader: string;
		writer: string;
		owner: string;
	},
	{ claim_id, turn, history }: TurnClaim,
) {
	const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
	const { InMemoryTransport } = await import(
		"@modelcontextprotocol/sdk/inMemory.js"
	);
	const { CallToolResultSchema } = await import(
		"@modelcontextprotocol/sdk/types.js"
	);
	const forOwner = <T>(run: Parameters<typeof docLinkOwnerTransaction<T>>[2]) =>
		docLinkOwnerTransaction(writer, owner, run);
	const toolSession = <T>(
		run: (client: Client, timeout: number) => Promise<T>,
	) =>
		forOwner((tx) =>
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
	if (!session) return false;
	const result = await askDocBackup({
		apiKey,
		model,
		system: docPrompt,
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
	});
	if (result.kind !== "answer") {
		await forOwner((tx) =>
			finishDocTurn(tx, owner, { claim_id, kind: "queued" }),
		);
		return false;
	}
	let answer: unknown = null;
	try {
		answer = JSON.parse(result.text);
	} catch {
		// Let the shared answer validator handle an invalid model response.
	}
	await forOwner(async (tx) => {
		const status = await finishDocTurn(tx, owner, {
			claim_id,
			kind: "answered",
			answer,
			answered_by: "backup",
		});
		if (status === 422)
			await finishDocTurn(tx, owner, { claim_id, kind: "failed" });
	});
	return true;
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
	const { connectionString: writer } = DATABASE_WRITER;
	const { connectionString: reader } = DATABASE;
	const owners = await nextTransaction(writer, "save", (tx) =>
		tx
			.selectFrom("app_user")
			.select("id")
			.where("is_account_partner", "=", true)
			.orderBy("id")
			.execute(),
	);
	for (const { id: owner } of owners) {
		const claim = await docLinkOwnerTransaction(writer, owner, (tx) =>
			claimDocWork(tx, owner, "backup"),
		);
		if (
			claim?.kind === "turn" &&
			!(await answerTurn({ apiKey, model, reader, writer, owner }, claim))
		)
			return;
	}
}
