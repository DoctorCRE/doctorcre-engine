import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { docLinkOwnerTransaction, issueDocLink } from "./doc-link.ts";
import { type DocClaimState, validateDocAnswer } from "./doc-tools.ts";
import { copyTest } from "./test-copy.ts";
import worker from "./worker.ts";

const { db, setup, cleanup, connectionString } = copyTest();
const owner = randomUUID();
const other = randomUUID();
const deal = randomUUID();
const lead = randomUUID();
const duplicate = randomUUID();
const copiedLead = randomUUID();
const client = randomUUID();
const route = "/api/engine/doc/mcp";
const binding = { connectionString };
const env = { DATABASE: binding, DATABASE_WRITER: binding };

before(async () => {
	await setup();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into how_found values ('referral', 'Referral');
		insert into party (id, kind, name, city, how_found) values
			('${owner}', 'person', 'Example One', null, null), ('${other}', 'person', 'Example Two', null, null),
			('${lead}', 'person', 'Example Juniper', 'Sample North', 'referral'),
			('${duplicate}', 'person', 'Example Juniper', 'Sample South', 'referral'),
			('${client}', 'company', 'Example Elm Clinic', null, 'referral');
		insert into app_user (id, slug) values ('${owner}', 'joe'), ('${other}', 'dell');
		insert into phase values ('pending', 'Pending');
		insert into role values ('lead', 'Lead'), ('client', 'Client');
		insert into stage (role, slug, label) values ('lead', 'qualified', 'Qualified');
		insert into party_role (party_id, role, stage, owner_user_id) values
			('${lead}', 'lead', 'qualified', '${owner}'),
			('${duplicate}', 'lead', 'qualified', '${other}'),
			('${client}', 'client', null, null);
		insert into client (party_id, owner_user_id) values ('${client}', '${other}');
		insert into outside_id (source, value, party_id) values ('old_system_lead', '${copiedLead}', '${lead}');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Cedar Lease', '${owner}');
		insert into deal_phase_change (deal_id, happened_at, phase) values ('${deal}', '2026-01-01', 'pending');
		insert into next_step (deal_id, what, owner_party_id, due_on)
			values ('${deal}', 'Review the floor plan', '${owner}', '2026-12-14');
		with a as (insert into activity (kind, happened_at, summary)
			values ('note', '2026-01-02', 'The west entrance needs a ramp.') returning id)
		insert into activity_about (activity_id, deal_id) select id, '${deal}' from a;
		with a as (insert into activity (kind, happened_at, summary)
			values ('email', '2026-01-03', 'Private synthetic mail summary.') returning id),
		mail as (insert into email (activity_id, message_id, sender, subject, body)
			select id, 'doc-test@example.test', 'sender@example.test', 'Synthetic mail', 'Private synthetic mail body.'
			from a returning activity_id)
		insert into activity_about (activity_id, deal_id) select activity_id, '${deal}' from mail;
		commit;`);
});
after(cleanup);

const issue = (user: string) =>
	docLinkOwnerTransaction(connectionString, user, (tx) =>
		issueDocLink(tx, user),
	);

async function claim(user: string) {
	const id = randomUUID();
	await db.query(
		`with chat as (insert into doc_conversation (owner_user_id) values ($1) returning id)
		insert into doc_turn (conversation_id, owner_user_id, position, idempotency_key, request_hash,
			question, state, claim_id, claim_until, claim_state)
		select id, $1, 1, gen_random_uuid(), 'example', 'Sample', 'working', $2,
			clock_timestamp() + interval '60 seconds', '{"reads":0,"sources":{}}' from chat`,
		[user, id],
	);
	return id;
}

function send(credential: string, id: string, extra?: Record<string, string>) {
	return (method: string, params?: object, rpcId: number | null = 7) =>
		worker.request(
			route,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${credential}`,
					"Doc-Claim-Id": id,
					"Content-Type": "application/json",
					Accept: "application/json, text/event-stream",
					...extra,
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					method,
					params,
					...(rpcId !== null && { id: rpcId }),
				}),
			},
			env,
		);
}

type ToolResult = { isError?: boolean; content: { text: string }[] };

async function tool(
	request: ReturnType<typeof send>,
	name: string,
	args: object,
	error = false,
) {
	const response = await request("tools/call", { name, arguments: args });
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("cache-control"), "no-store");
	const { id, result } = await response.json<{
		id: number;
		result: ToolResult;
	}>();
	assert.equal(id, 7);
	assert.equal(Boolean(result?.isError), error, JSON.stringify(result));
	return error
		? result.content[0]?.text
		: JSON.parse(result.content[0]?.text ?? "null");
}

test("the engine speaks MCP only to the link credential and its current private claim", async () => {
	const { credential } = await issue(owner);
	const otherLink = await issue(other);
	const fakeClaim = randomUUID();
	assert.equal((await send("", fakeClaim)("tools/list")).status, 401);
	assert.equal((await send(credential, fakeClaim)("tools/list")).status, 404);
	const id = await claim(owner);
	assert.equal(
		(await send(otherLink.credential, id)("tools/list")).status,
		404,
	);
	assert.equal(
		(await send(credential, id, { Cookie: "example=none" })("tools/list"))
			.status,
		401,
	);
	assert.equal(
		(
			await send(credential, id, { Origin: "https://example.test" })(
				"tools/list",
			)
		).status,
		403,
	);
	const request = send(credential, id);
	const initialized = await request("initialize", {
		protocolVersion: "2025-11-25",
		capabilities: {},
		clientInfo: { name: "Example Mac", version: "1.0.0" },
	});
	assert.equal(initialized.status, 200);
	const { result } = await initialized.json<{
		result: { protocolVersion: string };
	}>();
	assert.equal(result.protocolVersion, "2025-11-25");
	assert.equal(
		(await request("notifications/initialized", undefined, null)).status,
		202,
	);
	const listed = await request("tools/list");
	const {
		result: { tools },
	} = await listed.json<{ result: { tools: { name: string }[] } }>();
	assert.deepEqual(
		tools.map(({ name }) => name),
		["find", "read", "propose_save", "validate_answer"],
	);
	await tool(request, "confirm", {}, true);
	await db.query(
		"update doc_turn set claim_until = clock_timestamp() + interval '14 seconds' where claim_id = $1",
		[id],
	);
	assert.equal((await request("tools/list")).status, 404);
	const current = await claim(owner);
	await issue(owner);
	assert.equal((await send(credential, current)("tools/list")).status, 401);
});

test("Doc reads shared records, validates citations and proposes a save without business writes", async () => {
	const { credential } = await issue(owner);
	const id = await claim(owner);
	const request = send(credential, id);
	const source = `deal:${deal}`;
	await tool(
		request,
		"find",
		{ query: "Example Cedar", kind: "deal", extra: true },
		true,
	);
	await tool(
		request,
		"propose_save",
		{ kind: "note", source, text: "Add a ramp." },
		true,
	);
	const found = await tool(request, "find", { query: deal, kind: "deal" });
	assert.deepEqual(found, [
		{
			ref: { kind: "deal", id: deal },
			label: "Example Cedar Lease",
			href: `/deals?deal=${deal}`,
			city: null,
			source,
		},
	]);
	const facts = await tool(request, "read", { source });
	assert.equal(facts.phase, "pending");
	assert.equal(facts.next_steps[0].what, "Review the floor plan");
	assert.equal(facts.activity[0].summary, "The west entrance needs a ramp.");
	assert.equal(facts.activity.length, 1);
	const [sharedClient] = await tool(request, "find", {
		query: client,
		kind: "client",
	});
	assert.equal(
		(await tool(request, "read", { source: sharedClient.source })).owner,
		"Example Two",
	);
	const proposal = await tool(request, "propose_save", {
		kind: "note",
		source,
		text: " Add a ramp. ",
	});
	assert.deepEqual(proposal, {
		kind: "note",
		target: {
			ref: { kind: "deal", id: deal },
			label: "Example Cedar Lease",
			href: `/deals?deal=${deal}`,
		},
		text: "Add a ramp.",
	});
	await tool(
		request,
		"propose_save",
		{ kind: "next_step", source, what: "Review", due_on: "2026-02-30" },
		true,
	);
	assert.equal(
		(
			await tool(request, "propose_save", {
				kind: "next_step",
				source,
				what: "Review",
				due_on: null,
			})
		).due_on,
		null,
	);
	await tool(
		request,
		"validate_answer",
		{ kind: "answer", text: "Ready.", sources: [`deal:${randomUUID()}`] },
		true,
	);
	await tool(
		request,
		"validate_answer",
		{ kind: "answer", text: "Ready.", sources: [] },
		true,
	);
	const answer = await tool(request, "validate_answer", {
		kind: "answer",
		text: "Ready.",
		sources: [{ ...proposal.target, href: "https://example.test" }, source],
		proposal: { ...proposal, target: { ...proposal.target, label: "Made up" } },
	});
	const {
		rows: [current],
	} = await db.query<{ claim_state: DocClaimState }>(
		"select claim_state from doc_turn where claim_id = $1",
		[id],
	);
	assert.ok(current);
	assert.deepEqual(validateDocAnswer(answer, current.claim_state), answer);
	assert.deepEqual(answer, {
		kind: "answer",
		text: "Ready.",
		sources: [proposal.target],
		proposal,
	});
	assert.deepEqual(
		(await db.query("select kind, summary from activity order by happened_at"))
			.rows,
		[
			{ kind: "note", summary: "The west entrance needs a ramp." },
			{ kind: "email", summary: "Private synthetic mail summary." },
		],
	);
	assert.deepEqual((await db.query("select what from next_step")).rows, [
		{ what: "Review the floor plan" },
	]);
	assert.equal(
		(await db.query("select idempotency_key from save_receipt")).rowCount,
		0,
	);
});

test("Doc finds a lead by the copied ID from its link in a new claim", async () => {
	const { credential } = await issue(owner);
	const first = await tool(send(credential, await claim(owner)), "find", {
		query: lead,
		kind: "lead",
	});
	const [match] = first;
	const linkId = new URL(match.href, "https://example.test").searchParams.get(
		"lead",
	);
	assert.equal(linkId, copiedLead);
	const next = await tool(send(credential, await claim(owner)), "find", {
		query: linkId,
		kind: "lead",
	});
	assert.deepEqual(next, first);
});

test("Doc limits concurrent reads as a group and asks which lead when names collide", async () => {
	const { credential } = await issue(owner);
	const request = send(credential, await claim(owner));
	const source = `lead:${lead}`;
	assert.equal(await tool(request, "read", { source }), null);
	const [match] = await tool(request, "find", { query: lead, kind: "lead" });
	assert.equal(match.href, `/leads?lead=${copiedLead}`);
	assert.equal((await tool(request, "read", { source })).stage, "Qualified");
	const last = await Promise.all([
		request("tools/call", {
			name: "find",
			arguments: { query: client, kind: "client" },
		}),
		request("tools/call", {
			name: "find",
			arguments: { query: client, kind: "client" },
		}),
	]);
	const outcomes = await Promise.all(
		last.map(
			async (response) =>
				(await response.json<{ result: ToolResult }>()).result,
		),
	);
	assert.deepEqual(outcomes.map((result) => Boolean(result.isError)).sort(), [
		false,
		true,
	]);
	const found = outcomes.find((result) => !result.isError)?.content[0]?.text;
	assert.ok(found);
	assert.equal(JSON.parse(found)[0].href, `/clients?record=${client}`);

	const next = send(credential, await claim(owner));
	await tool(
		next,
		"validate_answer",
		{ kind: "answer", text: "Ready.", sources: [source] },
		true,
	);
	const clarification = await tool(next, "find", {
		query: "Example Juniper",
		kind: "lead",
	});
	assert.equal(clarification.kind, "clarification");
	assert.deepEqual(
		clarification.sources.map(({ href }: { href: string }) => href).sort(),
		[`/leads?lead=${copiedLead}`, `/leads?lead=${duplicate}`].sort(),
	);
	await tool(
		next,
		"propose_save",
		{ kind: "note", source, text: "Add a ramp." },
		true,
	);
	assert.deepEqual(
		await tool(next, "validate_answer", {
			kind: "answer",
			text: "Guessed.",
			sources: [source],
		}),
		clarification,
	);
});
