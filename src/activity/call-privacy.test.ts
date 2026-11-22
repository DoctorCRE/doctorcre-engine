import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocTools } from "../doc-tools.ts";
import { nextTransaction } from "../next-connection.ts";
import { doorTest } from "../test-door.ts";

const door = doorTest();
const joe = randomUUID();
const dell = randomUUID();
const deal = randomUUID();
const party = randomUUID();
const clientParty = randomUUID();
const shared = randomUUID();
const privateCall = randomUUID();
const deletedCall = randomUUID();
const privateStepText = "Review the private plan";
const assignedText = "Send the brochure";
const completedText = "Reviewed private notes";
const sharedText = "Example shared call";
const privateText = "Example private call";

before(async () => {
	await door.setup();
	await door.db.query(`
		set local engine.job = 'old_system';
		insert into party (id, kind, name) values
			('${joe}', 'person', 'Example One'), ('${dell}', 'person', 'Example Two'),
			('${party}', 'company', 'Example Practice'),
			('${clientParty}', 'company', 'Example Client');
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell');
		insert into role (slug, label) values ('lead', 'Lead'), ('vendor', 'Vendor'), ('client', 'Client');
		insert into stage (role, slug, label) values ('lead', 'qualified', 'Qualified');
		insert into how_found (slug, label) values ('referral', 'Referral');
		update party set how_found = 'referral' where id in ('${party}', '${clientParty}');
		insert into party_role (party_id, role, stage, owner_user_id) values
			('${party}', 'lead', 'qualified', '${joe}'), ('${party}', 'vendor', null, '${joe}'),
			('${clientParty}', 'client', null, null);
		insert into client (party_id) values ('${clientParty}');
		insert into phase (slug, label) values ('negotiation', 'Negotiation');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Lease', '${joe}');
		insert into deal_party (deal_id, party_id, role) values ('${deal}', '${clientParty}', 'client');
		insert into deal_phase_change (deal_id, happened_at, phase)
			values ('${deal}', '2025-01-01', 'negotiation');
		insert into activity (id, kind, happened_at, summary) values
			('${shared}', 'call', '2025-01-02', '${sharedText}');
		set local engine.job = 'agent';
		set local engine.user_id = '${joe}';
		insert into activity (id, kind, happened_at, summary) values
			('${privateCall}', 'call', '2025-01-03', '${privateText}'),
			('${deletedCall}', 'call', '2025-01-04', 'Example deleted call');
		delete from activity where id = '${deletedCall}';
		insert into activity_about (activity_id, deal_id)
			values ('${shared}', '${deal}'), ('${privateCall}', '${deal}');
		insert into activity_about (activity_id, party_id)
			values ('${shared}', '${party}'), ('${privateCall}', '${party}');
		insert into next_step (deal_id, owner_party_id, what, due_on, call_activity_id, call_evidence_quote) values
			('${deal}', '${joe}', '${privateStepText}', '2025-01-04', '${privateCall}', '${privateText}'),
			('${deal}', '${dell}', '${assignedText}', '2025-01-04', '${privateCall}', '${privateText}');
		insert into next_step (deal_id, owner_party_id, what, resolution, done_at, call_activity_id, call_evidence_quote)
			values ('${deal}', '${joe}', '${completedText}', 'done', '2025-01-05', '${privateCall}', '${privateText}');
		set local engine.job = 'old_system';
		set local engine.user_id = '';
		insert into imported_change (id, table_name, record, field, source_event, old_value_absent, new_value_absent)
		select id, 'activity', jsonb_build_object('id', activity_id), 'summary', jsonb_build_object(
			'id', id, 'verb', 'add-deal-note', 'cause', 'human_stated', 'actor_id', '${joe}',
			'subject_id', '${deal}', 'new_value', jsonb_build_object('note', summary)), true, false
		from (select gen_random_uuid() as id, a.id as activity_id, summary from activity a) entries;
	`);
});
after(() => door.cleanup());

type Partner = "joe" | "dell";
const partners = ["joe", "dell"] as const;
const expected = (user: Partner) =>
	user === "joe" ? [privateText, sharedText] : [sharedText];

async function read<T>(user: Partner, path: string) {
	const response = await door.request(
		{ user },
		path,
		{ method: "GET" },
		{
			DEALS_READ_SCHEMA: "next",
			LEADS_READ_SCHEMA: "next",
			DIRECTORY_READ_SCHEMA: "next",
			ACTIVITY_READ_SCHEMA: "next",
		},
	);
	assert.equal(response.status, 200);
	return response.json<T>();
}

type Summary = { summary: string };
const summaries = (entries: Summary[]) => entries.map(({ summary }) => summary);

function assertSteps(result: unknown, user: Partner) {
	const text = JSON.stringify(result);
	assert.ok(text.includes(assignedText));
	assert.equal(text.includes(privateStepText), user === "joe");
}

test("each partner's deal timeline shows their visible calls, history and steps", async () => {
	for (const user of partners) {
		const { activities, events, next_actions } = await read<{
			activities: Summary[];
			events: { activity_id: string }[];
			next_actions: { description: string }[];
		}>(user, `deals/${deal}`);
		assert.deepEqual(summaries(activities), expected(user));
		assert.equal(
			events.some(({ activity_id }) => activity_id === privateCall),
			user === "joe",
		);
		assert.ok(events.some(({ activity_id }) => activity_id === shared));
		assertSteps(next_actions, user);
	}
});

test("the Deals board picks the newest visible call or completed step", async () => {
	for (const user of partners) {
		const { deals } = await read<{
			deals: {
				id: string;
				last_step: Summary;
				next_step: string;
				open_actions: unknown;
			}[];
		}>(user, "deals");
		const row = deals.find(({ id }) => id === deal);
		assert.ok(row);
		assert.equal(
			row.last_step.summary,
			user === "joe" ? completedText : sharedText,
		);
		assertSteps(row.open_actions, user);
		if (user === "dell") assert.equal(row.next_step, assignedText);
	}
});

test("lead correspondence includes only visible calls", async () => {
	for (const user of partners) {
		const { detail } = await read<{ detail: { correspondence: Summary[] } }>(
			user,
			`leads?lead_id=${party}`,
		);
		assert.deepEqual(summaries(detail.correspondence), expected(user));
	}
});

test("vendor last contact and recent entries include only visible calls", async () => {
	for (const user of partners) {
		const {
			record: { relationship },
		} = await read<{
			record: {
				relationship: {
					last_contact_note: string;
					recent_entries: Summary[];
				};
			};
		}>(user, `vendors/${party}?contract=vendor-directory.v2`);
		assert.equal(relationship.last_contact_note, expected(user)[0]);
		assert.deepEqual(summaries(relationship.recent_entries), expected(user));
	}
});

test("Doc's record tool reads calls for the partner whose turn it is", async () => {
	for (const user of partners) {
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();
		const client = new Client({ name: "test", version: "1" });
		const server = new McpServer({ name: "Doc", version: "1" });
		const source = `deal:${deal}`;
		registerDocTools(server, {
			readConnection: door.readerUrl,
			partner: user,
			partnerId: user === "joe" ? joe : dell,
			draft: undefined,
			state: { reads: 0, sources: {} },
			timeout: 5000,
		});
		try {
			await server.connect(serverTransport);
			await client.connect(clientTransport);
			await client.callTool({
				name: "find",
				arguments: { query: deal, kind: "deal" },
			});
			const answer = await client.callTool({
				name: "read",
				arguments: { source },
			});
			assert.ok(Array.isArray(answer.content));
			const [content] = answer.content;
			assert.equal(content?.type, "text");
			const result = JSON.parse(content.text);
			assert.deepEqual(summaries(result.activity), expected(user));
			assertSteps(result.next_steps, user);
		} finally {
			await client.close();
			await server.close();
		}
	}
});

test("Recent Activity still includes shared calls and hides the other partner's call", async () => {
	for (const user of partners) {
		const { catch_up } = await read<{
			catch_up: { timeline: (Summary & { verb: string })[] };
		}>(user, `recent-activity?query=${deal}`);
		assert.deepEqual(
			summaries(catch_up.timeline.filter(({ verb }) => verb === "call")),
			expected(user),
		);
		assertSteps(catch_up.timeline, user);
	}
});

test("Calendar shows private follow-ups to their call's partner and their assignee", async () => {
	for (const user of partners) {
		const body = await read(user, "calendar/critical-dates");
		assertSteps(body, user);
		assert.ok(!JSON.stringify(body).includes(privateText));
	}
});

test("Updates history filters private call step wording", async () => {
	for (const user of partners) {
		assertSteps(await read(user, "updates/changes"), user);
	}
});

test("direct reads without a viewer expose neither private calls nor their audit text", async () => {
	await nextTransaction(door.readerUrl, "read", async (tx) => {
		assert.deepEqual(
			await tx.selectFrom("activity").select("summary").execute(),
			[{ summary: sharedText }],
		);
		const changes = await tx
			.selectFrom("change")
			.select(["old_value", "new_value"])
			.where("table_name", "=", "activity")
			.execute();
		assert.doesNotMatch(
			JSON.stringify(changes),
			/Example (private|deleted) call/,
		);
		const imported = await tx
			.selectFrom("imported_change")
			.select("source_event")
			.execute();
		assert.match(JSON.stringify(imported), /Example shared call/);
		assert.doesNotMatch(JSON.stringify(imported), /Example private call/);
	});
});
