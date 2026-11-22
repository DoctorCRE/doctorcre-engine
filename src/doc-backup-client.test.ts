import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { createTestHarness } from "wrangler";
import { askDocBackup } from "./doc-backup-client.ts";

const inputSchema = { type: "object" as const };
const request = {
	apiKey: "fake-key",
	model: "claude-sonnet-5-5",
	system: "You are Doc.",
	messages: [{ role: "user", content: "Find the record." }] as const,
	tools: [{ name: "find", inputSchema }],
	timeoutMs: 30_000,
	runTool: () => {
		throw new Error("Unexpected tool call");
	},
};
const answer = { type: "text", text: "I found it." };
const answered = { kind: "answer", text: answer.text, toolCalls: [] };
const thinking = {
	type: "thinking",
	thinking: "I should check the records.",
	signature: "synthetic-opaque-signature",
};
const use = {
	type: "tool_use",
	id: "toolu_find",
	name: "find",
	input: { query: "Example" },
};
const failure = (reason: string) => ({ kind: "failed", reason });

function message(content: unknown[], stop_reason = "end_turn", tokens = 20) {
	return Response.json({
		type: "message",
		role: "assistant",
		stop_reason,
		content,
		usage: { output_tokens: tokens },
	});
}

function endpoint(...responses: Response[]) {
	const requests: unknown[] = [];
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const outgoing = new Request(input, init);
		assert.equal(outgoing.url, "https://api.anthropic.com/v1/messages");
		assert.equal(outgoing.method, "POST");
		assert.equal(
			outgoing.headers.get("authorization"),
			`Bearer ${request.apiKey}`,
		);
		requests.push(await outgoing.json());
		const response = responses.shift();
		assert.ok(response, "Unexpected API request");
		return response;
	};
	return {
		requests,
		ask: (
			runTool: Parameters<typeof askDocBackup>[0]["runTool"] = request.runTool,
		) => askDocBackup({ ...request, fetch, runTool }),
	};
}

test("returns final text from one Messages request", async () => {
	const { requests, ask } = endpoint(message([answer]));
	assert.deepEqual(await ask(), answered);
	const [payload] = requests;
	assert.equal(requests.length, 1);
	assert.deepEqual(payload, {
		model: request.model,
		system: request.system,
		messages: request.messages,
		max_tokens: 4096,
		tools: [{ name: "find", input_schema: inputSchema }],
	});
});

test("continues with the assistant tool call and its MCP result", async () => {
	const { requests, ask } = endpoint(
		message([use], "tool_use", 100),
		message([answer]),
	);
	const call = { id: use.id, name: use.name, arguments: use.input };
	const content = [{ type: "text" as const, text: "No matching record" }];
	const result = await ask((received) => {
		assert.deepEqual(received, call);
		return { content, isError: true };
	});
	assert.deepEqual(result, { ...answered, toolCalls: [call] });
	const tool_result = {
		type: "tool_result",
		tool_use_id: use.id,
		content,
		is_error: true,
	};
	assert.partialDeepStrictEqual(requests[1], {
		max_tokens: 3996,
		messages: [
			...request.messages,
			{ role: "assistant", content: [use] },
			{ role: "user", content: [tool_result] },
		],
	});
});

test("returns only answer text after signed thinking", async () => {
	const { ask } = endpoint(message([thinking, answer]));
	assert.deepEqual(await ask(), answered);
});

test("replays signed thinking unchanged before the tool call", async () => {
	const { requests, ask } = endpoint(
		message([thinking, use], "tool_use"),
		message([answer]),
	);
	const call = { id: use.id, name: use.name, arguments: use.input };
	assert.deepEqual(await ask(() => ({ content: [] })), {
		...answered,
		toolCalls: [call],
	});
	const payload = requests[1];
	assert.ok(payload && typeof payload === "object" && "messages" in payload);
	assert.deepEqual(payload.messages, [
		...request.messages,
		{ role: "assistant", content: [thinking, use] },
		{
			role: "user",
			content: [{ type: "tool_result", tool_use_id: use.id, content: [] }],
		},
	]);
});

test("stops at the round cap before running another tool", async () => {
	const { requests, ask } = endpoint(
		...Array.from({ length: 5 }, (_, round) =>
			message([{ ...use, id: `toolu_${round}` }], "tool_use"),
		),
	);
	let calls = 0;
	const result = await ask(() => {
		calls++;
		return { content: [] };
	});
	assert.deepEqual(result, failure("Tool round limit reached"));
	assert.equal(requests.length, 5);
	assert.equal(calls, 4);
});

test("stops before running tools when the output budget is spent", async () => {
	const { requests, ask } = endpoint(message([use], "tool_use", 4096));
	assert.deepEqual(await ask(), failure("Output token limit reached"));
	assert.equal(requests.length, 1);
});

test("aborts a stalled response body at the deadline", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const started = Promise.withResolvers<AbortSignal>();
	const result = askDocBackup({
		...request,
		fetch: async (_input, init) => {
			const signal = init?.signal;
			assert.ok(signal);
			const body = new ReadableStream({
				start(controller) {
					signal.onabort = () => controller.error(signal.reason);
				},
			});
			started.resolve(signal);
			return new Response(body, {
				headers: { "content-type": "application/json" },
			});
		},
	});
	const signal = await started.promise;
	t.mock.timers.tick(30_000);
	assert.deepEqual(await result, failure("Claude request timed out"));
	assert.equal(signal.aborted, true);
});

test("accepts a 35-second answer within the caller's model window", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const started = Promise.withResolvers<void>();
	const result = askDocBackup({
		...request,
		timeoutMs: 40_000,
		fetch: () =>
			new Promise((resolve) => {
				setTimeout(() => resolve(message([answer])), 35_000);
				started.resolve();
			}),
	});
	await started.promise;
	t.mock.timers.tick(35_000);
	assert.deepEqual(await result, answered);
});

test("caps the caller's model window at 45 seconds", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const started = Promise.withResolvers<AbortSignal>();
	const result = askDocBackup({
		...request,
		timeoutMs: 60_000,
		fetch: async (_input, init) => {
			const signal = init?.signal;
			assert.ok(signal);
			started.resolve(signal);
			return new Promise((_, reject) => {
				signal.addEventListener("abort", () => reject(signal.reason));
			});
		},
	});
	const signal = await started.promise;
	t.mock.timers.tick(44_999);
	assert.equal(signal.aborted, false);
	t.mock.timers.tick(1);
	assert.equal(signal.aborted, true);
	assert.deepEqual(await result, failure("Claude request timed out"));
});

test("sends no request when the caller has no model time left", async () => {
	let requests = 0;
	const result = await askDocBackup({
		...request,
		timeoutMs: 0,
		fetch: async () => {
			requests++;
			return message([answer]);
		},
	});
	assert.deepEqual(result, failure("Claude request timed out"));
	assert.equal(requests, 0);
});

test("distinguishes depleted credits and never retries HTTP errors", async () => {
	const creditMessage =
		"Your credit balance is too low to access the Anthropic API.";
	for (const [status, type, message, kind] of [
		[400, "invalid_request_error", creditMessage, "credits_exhausted"],
		[400, "invalid_request_error", "Unknown model", "failed"],
		[402, "billing_error", "Payment information unavailable", "failed"],
		[503, "overloaded_error", "Service unavailable", "failed"],
	] as const) {
		const body = { type: "error", error: { type, message } };
		const { ask, requests } = endpoint(Response.json(body, { status }));
		assert.equal((await ask()).kind, kind);
		assert.equal(requests.length, 1);
	}
});

test("rejects malformed success bodies", async () => {
	for (const response of [
		new Response("broken JSON", {
			headers: { "content-type": "application/json" },
		}),
		message([{ type: "text", text: false }]),
	]) {
		const { ask } = endpoint(response);
		assert.deepEqual(await ask(), failure("Malformed Claude response"));
	}
});

test("workerd sends the Messages request and refuses redirects", async (t) => {
	const worker = createTestHarness({
		workers: [
			{
				config: {
					name: "doc-backup-smoke",
					main: fileURLToPath(
						new URL("./fixtures/doc-backup-worker.ts", import.meta.url),
					),
					compatibility_date: "2026-11-11",
					compatibility_flags: ["nodejs_compat"],
					send_metrics: false,
				},
			},
		],
	});
	t.after(() => worker.close());
	await worker.listen();
	assert.deepEqual(await (await worker.fetch("/")).json(), {
		result: { kind: "answer", text: "Backup answered.", toolCalls: [] },
		requests: 1,
	});
	assert.deepEqual(await (await worker.fetch("/redirect")).json(), {
		result: failure("Claude returned HTTP 302"),
		requests: 1,
	});
});
