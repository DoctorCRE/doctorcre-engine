import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type {
	CallToolRequestParams,
	CallToolResult,
	Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const maxToolRounds = 4;
const maxOutputTokens = 4096;
const maxTimeoutMs = 45_000;

type ToolCall = Required<Pick<CallToolRequestParams, "name" | "arguments">> & {
	id: string;
};

type ToolRunner = (
	call: ToolCall,
	signal: AbortSignal,
) => CallToolResult | Promise<CallToolResult>;

type BackupRequest = {
	apiKey: string;
	model: string;
	system: string;
	messages: readonly Anthropic.MessageParam[];
	tools: readonly Tool[];
	timeoutMs: number;
	runTool: ToolRunner;
	fetch?: typeof globalThis.fetch;
};

type BackupResult =
	| { kind: "answer"; text: string; toolCalls: ToolCall[] }
	| { kind: "credits_exhausted" }
	| { kind: "failed"; reason: string };

const textBlock = z.object({ type: z.literal("text"), text: z.string() });
const thinkingBlock = z.looseObject({
	type: z.literal("thinking"),
	thinking: z.string(),
	signature: z.string(),
});
const toolBlock = z.object({
	type: z.literal("tool_use"),
	id: z.string().min(1),
	name: z.string().min(1),
	input: z.record(z.string(), z.unknown()),
});
const responseSchema = z.object({
	type: z.literal("message"),
	role: z.literal("assistant"),
	stop_reason: z.string(),
	content: z.array(
		z.discriminatedUnion("type", [textBlock, thinkingBlock, toolBlock]),
	),
	usage: z.object({ output_tokens: z.int().nonnegative() }),
});
const depletedCreditMessage =
	"Your credit balance is too low to access the Anthropic API.";
const creditErrorSchema = z.object({
	error: z.object({
		type: z.literal("invalid_request_error"),
		message: z
			.string()
			.refine((message) => message.startsWith(depletedCreditMessage)),
	}),
});

function failed(reason: string): BackupResult {
	return { kind: "failed", reason };
}

async function exchange(
	request: BackupRequest,
	signal: AbortSignal,
): Promise<BackupResult> {
	const client = new Anthropic({
		apiKey: request.apiKey,
		authToken: null,
		baseURL: "https://api.anthropic.com",
		fetch: request.fetch,
		fetchOptions: { redirect: "manual" },
		defaultHeaders: {
			Authorization: `Bearer ${request.apiKey}`,
			"x-api-key": null,
		},
		maxRetries: 0,
		logLevel: "off",
		openTelemetry: false,
	});
	const tools = request.tools.map(
		({
			name,
			description,
			inputSchema: { properties, required, ...schema },
		}): Anthropic.Tool => ({
			name,
			...(description === undefined ? {} : { description }),
			input_schema: {
				...schema,
				...(properties === undefined ? {} : { properties }),
				...(required === undefined ? {} : { required }),
			},
		}),
	);
	const messages = [...request.messages];
	const toolCalls: ToolCall[] = [];
	let remainingTokens = maxOutputTokens;

	for (let round = 0; round <= maxToolRounds; round++) {
		signal.throwIfAborted();
		let raw: unknown;
		try {
			raw = await client.messages.create(
				{
					model: request.model,
					system: request.system,
					messages,
					tools,
					max_tokens: remainingTokens,
				},
				{ signal },
			);
		} catch (error) {
			signal.throwIfAborted();
			if (error instanceof APIError && error.status !== undefined) {
				// Anthropic reports depleted credits as a generic 400 with this message.
				if (
					error.status === 400 &&
					creditErrorSchema.safeParse(error.error).success
				) {
					return { kind: "credits_exhausted" };
				}
				return failed(`Claude returned HTTP ${error.status}`);
			}
			if (error instanceof SyntaxError)
				return failed("Malformed Claude response");
			return failed("Claude request failed");
		}
		const parsed = responseSchema.safeParse(raw);
		if (!parsed.success) return failed("Malformed Claude response");
		const { content, stop_reason, usage } = parsed.data;
		remainingTokens -= usage.output_tokens;
		if (remainingTokens < 0 || stop_reason === "max_tokens") {
			return failed("Output token limit reached");
		}
		const calls = content.filter((block) => block.type === "tool_use");
		if (stop_reason === "end_turn" && calls.length === 0) {
			const text = content
				.map((block) => (block.type === "text" ? block.text : ""))
				.join("");
			return text.trim()
				? { kind: "answer", text, toolCalls }
				: failed("Claude returned no answer");
		}
		if (stop_reason !== "tool_use" || calls.length === 0) {
			return failed("Claude did not complete the answer");
		}
		if (round === maxToolRounds) return failed("Tool round limit reached");
		if (remainingTokens === 0) return failed("Output token limit reached");
		if (calls.some(({ name }) => !tools.some((tool) => tool.name === name))) {
			return failed("Claude requested an unlisted tool");
		}

		const results: Anthropic.ToolResultBlockParam[] = [];
		for (const { id, name, input } of calls) {
			signal.throwIfAborted();
			const call = { id, name, arguments: input };
			const result = await request.runTool(call, signal);
			if (!result.content.every((block) => block.type === "text")) {
				return failed("Doc tool returned non-text content");
			}
			toolCalls.push(call);
			results.push({
				type: "tool_result",
				tool_use_id: id,
				content: result.content.map(({ type, text }) => ({ type, text })),
				...(result.isError === undefined ? {} : { is_error: result.isError }),
			});
		}
		messages.push(
			{ role: "assistant", content },
			{ role: "user", content: results },
		);
	}
	return failed("Tool round limit reached");
}

export async function askDocBackup(
	request: BackupRequest,
): Promise<BackupResult> {
	if (!request.apiKey.trim() || !request.model.trim()) {
		return failed("Claude key or model is missing");
	}
	const timeoutMs = Math.min(request.timeoutMs, maxTimeoutMs);
	if (!(timeoutMs > 0)) return failed("Claude request timed out");

	const controller = new AbortController();
	const deadline = Promise.withResolvers<never>();
	const timeout = setTimeout(() => {
		controller.abort();
		deadline.reject(controller.signal.reason);
	}, timeoutMs);

	try {
		return await Promise.race([
			exchange(request, controller.signal),
			deadline.promise,
		]);
	} catch {
		if (controller.signal.aborted) return failed("Claude request timed out");
		return failed("Doc backup exchange failed");
	} finally {
		clearTimeout(timeout);
	}
}
