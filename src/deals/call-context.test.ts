import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readSchema } from "../test-copy.ts";
import { type Caller, doorTest } from "../test-door.ts";
import worker from "../worker.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const { db, setup, cleanup, request } = doorTest();
const callCapture = { job: "call_capture", for_user: "joe" };

before(async () => {
	await setup();
	await db.query(`
		insert into public.actor (id, slug, kind, display_name) values
			('${id(1)}', 'joe', 'human', 'Example First Partner'),
			('${id(2)}', 'dell', 'human', 'Example Second Partner'),
			('${id(3)}', 'example-observer', 'human', 'Example Observer');
		insert into public.contact_state (slug, label, contactable, sort)
			values ('active', 'Active', true, 1);
		insert into public.party (id, kind, name, ref, email, created_by, updated_by) values
			('${id(4)}', 'person', 'Example Broker', 'P-101', 'broker@example.test', '${id(1)}', '${id(1)}'),
			('${id(5)}', 'person', 'Example Former Broker', 'P-102', null, '${id(1)}', '${id(1)}'),
			('${id(6)}', 'org', 'Example Practice', 'P-103', null, '${id(1)}', '${id(1)}');
		insert into public.client_status (slug, label) values ('engaged', 'Engaged');
		insert into public.client (id, party_id, status, created_by, updated_by)
			values ('${id(7)}', '${id(6)}', 'engaged', '${id(1)}', '${id(1)}');
		insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Lease', 1);
		insert into public.deal_phase (slug, label) values ('touring', 'Touring'), ('closed', 'Closed');
		insert into public.participant_role (slug, label) values ('support', 'Support'), ('listing_side', 'Listing side');
		insert into public.deal (id, client_id, name, deal_type, phase, owner, created_by, updated_by, created_at)
			values ('${id(10)}', '${id(7)}', 'Example copied deal', 'lease', 'touring', 'joe', '${id(1)}', '${id(1)}', '2025-01-01');
		insert into public.deal_participant (deal_id, actor_id, party_id, role, from_at, to_at, set_by) values
			('${id(10)}', null, '${id(4)}', 'listing_side', '2025-01-01', null, '${id(1)}'),
			('${id(10)}', null, '${id(5)}', 'listing_side', '2025-01-01', '2025-01-02', '${id(1)}'),
			('${id(10)}', '${id(2)}', null, 'support', '2025-01-01', null, '${id(1)}');
	`);
	for (const file of [
		"copy-parties.sql",
		"copy-leads-clients.sql",
		"copy-deals.sql",
	])
		await db.query(`begin; ${await readSchema(file)} commit;`);
	await db.query(`begin;
		select set_config('engine.user_id', '${id(2)}', true);
		insert into job values ('call_capture', 'Example call capture');
		insert into party (id, kind, name) values ('${id(8)}', 'person', 'Example New Broker');
		insert into party_email (party_id, address, label, is_primary)
			values ('${id(8)}', 'new-broker@example.test', 'work', true),
				('${id(8)}', 'other@example.test', 'personal', false);
		insert into deal (id, name, owner_user_id) values
			('${id(11)}', 'Example new deal', '${id(2)}'),
			('${id(12)}', 'Example parked deal', '${id(2)}'),
			('${id(13)}', 'Example closed deal', '${id(2)}'),
			('${id(14)}', 'Example deal without participants', '${id(2)}');
		update deal set parking_reason = 'client_paused' where id = '${id(12)}';
		insert into deal_phase_change (deal_id, phase, happened_at)
			values ('${id(13)}', 'closed', '2025-01-03');
		insert into deal_party (deal_id, party_id, role) values
			('${id(11)}', '${id(8)}', 'listing_agent'), ('${id(11)}', '${id(8)}', 'market_agent');
		commit;
	`);
});
after(cleanup);

function get(
	ids: string[],
	caller: Caller = { user: "joe" },
	headers: Record<string, string> = {},
) {
	const params = new URLSearchParams();
	for (const dealId of ids) params.append("deal_id", dealId);
	return request(caller, `call-context?${params}`, { headers });
}

test("either partner can read exact context and current participants for copied and new deals", async () => {
	const newId = id(11).toUpperCase();
	const broker = {
		party_id: id(8),
		ref: id(8),
		name: "Example New Broker",
		email: "new-broker@example.test",
	};
	for (const partner of ["joe", "dell"]) {
		const response = await get([newId, id(10)], { user: partner });
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), {
			deals: [
				{
					id: newId,
					name: "Example new deal",
					owner: "dell",
					operating_state: "active",
					participants: [
						{ ...broker, role: "listing_agent" },
						{ ...broker, role: "market_agent" },
					],
				},
				{
					id: id(10),
					name: "Example copied deal",
					owner: "joe",
					operating_state: "active",
					participants: [
						{
							party_id: id(6),
							ref: "P-103",
							name: "Example Practice",
							email: null,
							role: "client",
						},
						{
							party_id: id(4),
							ref: "P-101",
							name: "Example Broker",
							email: "broker@example.test",
							role: "listing_agent",
						},
					],
				},
			],
			unavailable_deal_ids: [],
		});
	}
});

test("missing, parked and closed deals leave the rest of the batch available", async () => {
	const response = await get([id(99), id(14), id(12), id(13)]);
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), {
		deals: [
			{
				id: id(14),
				name: "Example deal without participants",
				owner: "dell",
				operating_state: "active",
				participants: [],
			},
		],
		unavailable_deal_ids: [id(99), id(12), id(13)],
	});
});

for (const caller of [{ user: "joe" }, callCapture]) {
	test(`${"job" in caller ? "Jobs" : "Signed-in"} call context accepts 50 distinct deal IDs and refuses invalid batches`, async () => {
		const max = Array.from({ length: 50 }, (_, index) => id(index + 100));
		const response = await get(max, caller);
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), {
			deals: [],
			unavailable_deal_ids: max,
		});
		for (const ids of [
			[],
			["not-a-uuid"],
			[id(11), id(11).toUpperCase()],
			[...max, id(300)],
		]) {
			const refused = await get(ids, caller);
			assert.equal(refused.status, 400);
			assert.partialDeepStrictEqual(await refused.json(), {
				error: "invalid_field_value",
				fields: ["deal_id"],
			});
		}
	});
}

test("call context requires a signed-in partner", async () => {
	const anonymous = await worker.request(
		`https://app.example.test/api/engine/call-context?deal_id=${id(10)}`,
	);
	assert.equal(anonymous.status, 401);
	assert.equal((await get([id(10)], { user: "example-observer" })).status, 403);
});

test("Studio receives the same call context bytes as a signed-in partner", async () => {
	const ids = [id(11).toUpperCase(), id(99), id(10), id(12), id(13)];
	const signedIn = await get(ids);
	const studio = await get(ids, callCapture);
	assert.equal(signedIn.status, 200);
	assert.equal(studio.status, 200);
	assert.equal(await studio.text(), await signedIn.text());
});

test("Studio call context refuses a missing Jobs token", async () => {
	const response = await get([id(10)], callCapture, {
		"Cf-Access-Jwt-Assertion": "",
	});
	assert.equal(response.status, 401);
});

test("Studio call context requires the call capture job and a provisioned partner", async () => {
	for (const [caller, status, error] of [
		[{ ...callCapture, job: "old_system" }, 403, "AUTHORIZATION_REFUSED"],
		[{ job: "call_capture" }, 403, "AUTHORIZATION_REFUSED"],
		[
			{ ...callCapture, for_user: "example-observer" },
			403,
			"AUTHORIZATION_REFUSED",
		],
		[
			{ ...callCapture, for_user: "example-unknown" },
			422,
			"actor_not_provisioned",
		],
	] as const) {
		const response = await get([id(10)], caller);
		assert.equal(response.status, status);
		assert.partialDeepStrictEqual(await response.json(), { error });
	}
});
