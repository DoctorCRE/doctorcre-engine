import { askDocBackup } from "../doc-backup-client.ts";

export default {
	async fetch(incoming: Request) {
		let requests = 0;
		const result = await askDocBackup({
			apiKey: "fake-key",
			model: "claude-sonnet-5-5",
			system: "You are Doc.",
			messages: [{ role: "user", content: "Try the backup." }],
			tools: [],
			timeoutMs: 30_000,
			runTool: () => {
				throw new Error("Unexpected tool call");
			},
			fetch: async (input, init) => {
				const outgoing = new Request(input, init);
				requests++;
				if (outgoing.redirect !== "manual") {
					throw new Error("Messages request must stop at redirects");
				}
				if (new URL(incoming.url).pathname === "/redirect") {
					return Response.redirect("https://example.invalid/", 302);
				}
				return Response.json({
					type: "message",
					role: "assistant",
					stop_reason: "end_turn",
					content: [{ type: "text", text: "Backup answered." }],
					usage: { output_tokens: 10 },
				});
			},
		});
		return Response.json({ result, requests });
	},
};
