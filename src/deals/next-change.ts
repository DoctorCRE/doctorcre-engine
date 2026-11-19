import { Hono } from "hono";
import { sql, type Transaction, type Updateable } from "kysely";
import { Refusal, refuse } from "../answer.ts";
import { isCalendarDate } from "../calendar-date.ts";
import type { JsonObject } from "../database.d.ts";
import { failureKind } from "../failure.ts";
import { nextTransaction } from "../next-connection.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { stampNextSave, userId } from "../next-save.ts";
import { lockLead, requireProspect } from "../prospects/membership.ts";
import {
	clearable,
	type Fitted,
	fit,
	fitting,
	isAmount,
	isBoolean,
	isChangeId,
	isStoredText,
	isText,
	isUuid,
	optional,
	orNull,
} from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";
import { latestChange, seenAnswer, unseenChanges } from "../seen-change.ts";
import { UUID } from "../uuid.ts";
import {
	checkMarketDealName,
	linkMarketAgent,
	marketClient,
} from "./national-market.ts";
import { ENDED_PHASES, isLostDeal } from "./shared.ts";

// The database checks each value against its own rules, such as a known kind.
const DEAL_FIELDS = {
	name: optional(isText),
	kind: clearable(isText),
	reason: clearable(isText),
	owner: optional(isText),
	market_id: clearable(isUuid),
	closed_value: clearable(isAmount),
	parking_reason: clearable(isText),
	parking_note: clearable(isText),
	needs_attention: optional(isBoolean),
};

// `from` is the phase the caller saw, none for a deal with no phase yet.
const PHASE_MOVE = {
	from: orNull(isText),
	to: isText,
	on: clearable(isCalendarDate),
	reason: clearable(isText),
};

const DEAL_CHANGES = {
	idempotency_key: isUuid,
	seen_change_id: isChangeId,
	fields: optional(fitting(DEAL_FIELDS)),
	phase: optional(fitting(PHASE_MOVE)),
};

const DEAL_OPENING = {
	idempotency_key: isUuid,
	name: isText,
	owner: isText,
	phase: isText,
	kind: DEAL_FIELDS.kind,
	reason: DEAL_FIELDS.reason,
	market_id: DEAL_FIELDS.market_id,
	renews_lease_id: clearable(isUuid),
};

const NEW_DEAL = { ...DEAL_OPENING, client_id: isUuid };
const isPartyKind = (value: unknown): value is "person" | "company" =>
	value === "person" || value === "company";
const CONVERT_PROSPECT = {
	...DEAL_OPENING,
	prospect_id: isUuid,
	client_id: optional(isUuid),
	client: optional(
		fitting({ name: isStoredText, kind: isPartyKind, how_found: isStoredText }),
	),
};
const NEW_MARKET_DEAL = {
	...DEAL_OPENING,
	national_account_id: isUuid,
	market_id: isUuid,
	client_id: optional(isUuid),
	new_location: optional(fitting({ name: isText, kind: isPartyKind })),
	market_agent_id: optional(isUuid),
};

type DealFields = Partial<Fitted<typeof DEAL_FIELDS>>;
type PhaseMove = NonNullable<DealChanges["phase"]>;
type DealChanges = Exclude<ReturnType<typeof parseDealChanges>, Refusal>;

function parseDealChanges(deal_id: string, body: JsonObject) {
	if (!UUID.test(deal_id)) return new Refusal(404, "not_found");
	const request = fit(
		body,
		DEAL_CHANGES,
		["idempotency_key", "seen_change_id"],
		["fields", "phase"],
	);
	if (request instanceof Refusal) return request;
	const { idempotency_key, seen_change_id, phase } = request;
	if (phase && (phase.to === "closed" || phase.to === "dead") && !phase.on)
		return new Refusal(400, "missing_required", { fields: ["phase.on"] });
	const fields: DealFields = request.fields ?? {};
	return {
		idempotency_key,
		deal_id,
		seen_change_id,
		fields,
		phase: phase
			? {
					from: phase.from,
					to: phase.to,
					on: phase.on ?? null,
					reason: phase.reason ?? null,
				}
			: null,
	};
}

function parseNewDeal(body: JsonObject, signedIn: boolean) {
	const request =
		signedIn && body.prospect_id !== undefined
			? parseProspectConversion(body)
			: signedIn && body.national_account_id !== undefined
				? parseMarketDeal(body)
				: fit(body, NEW_DEAL, [
						"idempotency_key",
						"name",
						"client_id",
						"owner",
						"phase",
					]);
	if (request instanceof Refusal) return request;
	if (ENDED_PHASES.includes(request.phase))
		return new Refusal(400, "invalid_field_value", { fields: ["phase"] });
	return request;
}

function parseProspectConversion(body: JsonObject) {
	const clientFields = ["client_id", "client"] as const;
	const request = fit(
		body,
		CONVERT_PROSPECT,
		["idempotency_key", "name", "owner", "phase", "prospect_id"],
		clientFields,
	);
	if (request instanceof Refusal) return request;
	const { client_id, client, ...deal } = request;
	if (client_id && client)
		return new Refusal(400, "invalid_field_value", {
			fields: [...clientFields],
		});
	if (client) return { ...deal, client };
	if (client_id) return { ...deal, client_id };
	return new Refusal(400, "missing_required", { fields: [...clientFields] });
}

function parseMarketDeal(body: JsonObject) {
	const request = fit(
		body,
		NEW_MARKET_DEAL,
		[
			"idempotency_key",
			"name",
			"owner",
			"phase",
			"national_account_id",
			"market_id",
		],
		["client_id", "new_location"],
	);
	if (request instanceof Refusal) return request;
	const { client_id, new_location, name, ...fields } = request;
	if (client_id && new_location)
		return new Refusal(400, "invalid_field_value", {
			fields: ["client_id", "new_location"],
		});
	const deal = { ...fields, name: name.trim() };
	if (client_id) return { ...deal, client_id };
	if (new_location)
		return {
			...deal,
			new_location: { ...new_location, name: new_location.name.trim() },
		};
	return new Refusal(400, "missing_required", {
		fields: ["client_id", "new_location"],
	});
}

async function saveNewDeal(
	tx: Transaction<DB>,
	request: Exclude<ReturnType<typeof parseNewDeal>, Refusal>,
) {
	if ("prospect_id" in request) return convertProspect(tx, request);
	if (!("national_account_id" in request)) return addDeal(tx, request);

	await checkMarketDealName(tx, request.name);
	const client_id = await marketClient(
		tx,
		request.national_account_id,
		request,
	);
	const added = await addDeal(tx, { ...request, client_id });
	if (request.market_agent_id)
		await linkMarketAgent(tx, added.deal_id, request.market_agent_id);
	return added;
}

async function convertProspect(
	tx: Transaction<DB>,
	request: Exclude<ReturnType<typeof parseProspectConversion>, Refusal>,
) {
	const { prospect_id } = request;
	const existingClient = "client_id" in request ? request.client_id : undefined;
	const lead = await lockLead(tx, prospect_id, existingClient);
	await requireProspect(tx, prospect_id, lead?.stage);

	const client_id =
		"client" in request
			? (
					await tx
						.insertInto("party")
						.values({
							...request.client,
							name: request.client.name.trim(),
							changed_at: sql<string>`now()`,
						})
						.returning("id")
						.executeTakeFirstOrThrow()
				).id
			: request.client_id;
	await tx
		.insertInto("party_role")
		.values({
			party_id: client_id,
			role: "client",
			changed_at: sql<string>`now()`,
		})
		.onConflict((conflict) =>
			conflict.columns(["party_id", "role"]).doNothing(),
		)
		.execute();

	const added = await addDeal(tx, { ...request, client_id });
	if (client_id.toLowerCase() !== prospect_id.toLowerCase())
		await tx
			.insertInto("deal_party")
			.values({
				deal_id: added.deal_id,
				party_id: prospect_id,
				role: "client_contact",
				changed_at: sql<string>`now()`,
			})
			.execute();
	await sql`select carry_weekly_review(${prospect_id}::uuid, ${added.deal_id}::uuid)`.execute(
		tx,
	);
	return added;
}

async function addDeal(
	tx: Transaction<DB>,
	{
		client_id,
		phase,
		owner,
		name,
		kind,
		reason,
		market_id,
		renews_lease_id,
	}: Fitted<typeof NEW_DEAL>,
) {
	const owner_id = await userId(tx, owner);
	const {
		rows: [added],
	} = await sql<{ deal_id: string }>`
		with added as (
			insert into deal (name, kind, reason, market_id, renews_lease_id, owner_user_id)
			values (${name}, ${kind ?? null}, ${reason ?? null}, ${market_id ?? null}, ${renews_lease_id ?? null}, ${owner_id})
			returning id
		)
		insert into deal_party (deal_id, party_id, role)
		select id, ${client_id}::uuid, 'client' from added
		returning deal_id`.execute(tx);
	if (!added) throw new Error("Deal insert returned no id");
	const { deal_id } = added;
	const phase_changed_at = await movePhase(tx, deal_id, {
		from: null,
		to: phase,
		on: null,
		reason: null,
	});
	return {
		deal_id,
		change_id: (await latestChange(tx, "deal", deal_id)) ?? 0,
		phase_changed_at,
	};
}

async function saveDealChanges(
	tx: Transaction<DB>,
	{ deal_id, seen_change_id, fields, phase }: DealChanges,
): Promise<JsonObject> {
	const { owner, ...rest } = fields;
	const changes = owner
		? { ...rest, owner_user_id: await userId(tx, owner) }
		: rest;
	const answer = await changeDeal(tx, deal_id, seen_change_id, changes);
	return phase
		? { ...answer, phase_changed_at: await movePhase(tx, deal_id, phase) }
		: answer;
}

// Changes a deal's fields unless another save changed one of them after `seen`, the
// deal's latest change the partner's answer showed (0 for none). Other fields' changes
// stand, so two partners editing different fields both keep theirs.
export async function changeDeal(
	tx: Transaction<DB>,
	deal_id: string,
	seen: number,
	fields: Updateable<DB["deal"]>,
) {
	const keys = Object.keys(fields);
	await lockDeal(tx, deal_id);
	const unseen = await unseenChanges(tx, "deal", deal_id, seen, keys);
	if (keys.length)
		await tx
			.updateTable("deal")
			.set(fields)
			.where("id", "=", deal_id)
			.execute();
	return { deal_id, ...(await seenAnswer(tx, "deal", deal_id, seen, unseen)) };
}

async function lockDeal(tx: Transaction<DB>, deal_id: string) {
	// The row lock queues crossed saves, so the later one sees the earlier one's change.
	const deal = await tx
		.selectFrom("deal")
		.select("id")
		.where("id", "=", deal_id)
		.forUpdate()
		.executeTakeFirst();
	if (!deal) throw new SaveRefusal(new Refusal(404, "not_found"));
}

const latestDealPhase = (tx: Transaction<DB>, deal_id: string) =>
	tx
		.selectFrom("deal_phase_change")
		.select(["phase", "happened_at"])
		.where("deal_id", "=", deal_id)
		.orderBy("happened_at", "desc")
		.limit(1);

// Called under the deal row lock, so two moves from one phase cannot both pass.
// A move lands after the deal's latest, on its day in Central time, never before that day or after today.
async function movePhase(
	tx: Transaction<DB>,
	deal_id: string,
	{ from, to, on, reason }: PhaseMove,
): Promise<string> {
	const latest = await latestDealPhase(tx, deal_id).executeTakeFirst();
	const current = latest?.phase ?? null;
	if (current !== from)
		throw new SaveRefusal(
			new Refusal(409, "version_conflict", { current_phase: current }),
		);
	const after = latest?.happened_at ?? null;
	const { rows } = await sql<{ happened_at: string }>`
		insert into deal_phase_change (deal_id, happened_at, phase, reason)
		select ${deal_id}::uuid, greatest(${after}::timestamptz + interval '1 microsecond',
			case when day is null or day = today then clock_timestamp() else day::timestamp at time zone 'America/Chicago' end),
			${to}::text, ${reason}::text
		from (select ${on}::date as day, (now() at time zone 'America/Chicago')::date as today) days
		where day is null or day between coalesce((${after}::timestamptz at time zone 'America/Chicago')::date, day) and today
		returning to_jsonb(happened_at) #>> '{}' as happened_at`.execute(tx);
	const moved = rows[0];
	if (!moved)
		throw new SaveRefusal(
			new Refusal(400, "invalid_field_value", { fields: ["phase"] }),
		);
	return moved.happened_at;
}

const UNDO_PHASE_MOVE = {
	idempotency_key: isUuid,
	event_id: isUuid,
	base_version: isChangeId,
};

async function undoAutomaticPhaseMove(
	tx: Transaction<DB>,
	{
		deal_id,
		event_id,
		base_version,
	}: Fitted<typeof UNDO_PHASE_MOVE> & {
		deal_id: string;
	},
): Promise<JsonObject> {
	await lockDeal(tx, deal_id);
	const current_version = (await latestChange(tx, "deal", deal_id)) ?? 0;
	const current = await tx
		.selectFrom(latestDealPhase(tx, deal_id).as("latest"))
		.innerJoin("imported_automatic_phase_move as receipt", (join) =>
			join
				.on("receipt.deal_id", "=", deal_id)
				.onRef("receipt.happened_at", "=", "latest.happened_at")
				.on("receipt.source_event_id", "=", event_id),
		)
		.leftJoin("imported_deal_board as imported", (join) =>
			join.on("imported.deal_id", "=", deal_id),
		)
		.select(["latest.phase", "receipt.prior_phase"])
		.where((eb) =>
			eb.not(isLostDeal(eb.ref("latest.phase"), eb.ref("latest.happened_at"))),
		)
		.executeTakeFirst();
	if (!current || current_version !== base_version)
		throw new SaveRefusal(
			new Refusal(409, "version_conflict", { current_version }),
		);
	if (ENDED_PHASES.includes(current.prior_phase))
		throw new SaveRefusal(
			new Refusal(409, "version_conflict", {
				current_version,
				hint: "Undo would return this deal to Closed deals or Lost deals.",
			}),
		);
	const phase_changed_at = await movePhase(tx, deal_id, {
		from: current.phase,
		to: current.prior_phase,
		on: null,
		reason: null,
	});
	return { deal_id, phase: current.prior_phase, phase_changed_at };
}

export const automaticPhaseUndo = new Hono<NextSaveEnv>().post(
	"/deals/:deal/phase/undo",
	(c) =>
		answerNextSave(
			c,
			"undo-automatic-phase-move",
			(body) => {
				const deal_id = c.req.param("deal");
				if (!isUuid(deal_id)) return new Refusal(404, "not_found");
				const undo = fit(body, UNDO_PHASE_MOVE, [
					"idempotency_key",
					"event_id",
					"base_version",
				]);
				return undo instanceof Refusal ? undo : { ...undo, deal_id };
			},
			undoAutomaticPhaseMove,
		),
);

export const nextDeals = new Hono<NextSaveEnv>()
	.post("/deals", (c) =>
		answerNextSave(
			c,
			"add-deal",
			(body) => parseNewDeal(body, c.get("stamp").user !== undefined),
			saveNewDeal,
			(result) => (result.replayed ? 200 : 201),
		),
	)
	.post("/deals/:deal/changes", (c) =>
		answerNextSave(
			c,
			"deal-changes",
			(body) => parseDealChanges(c.req.param("deal"), body),
			saveDealChanges,
		),
	);

export const dealJobs = new Hono<NextSaveEnv>().get(
	"/deals/:deal",
	async (c) => {
		const deal_id = c.req.param("deal");
		const database = c.env.DATABASE;
		if (!database) return refuse(c, new Refusal(503, "database_unavailable"));
		try {
			const result = await nextTransaction(
				database.connectionString,
				"read",
				async (tx) => {
					await stampNextSave(tx, c.get("stamp"));
					if (!isUuid(deal_id)) return null;
					const {
						rows: [deal],
					} = await sql<{
						deal_id: string;
						phase: string | null;
						phase_saved_at: string | null;
						next_step: { id: string; due_on: string | null } | null;
					}>`
						select d.id as deal_id, latest.phase,
							to_jsonb(latest.changed_at) #>> '{}' as phase_saved_at,
							(select jsonb_build_object('id', id, 'due_on', due_on) from next_step
								where deal_id = d.id and status = 'open' and item_title is null
								order by created_at desc, id desc limit 1) as next_step
						from deal d left join lateral (
								select phase, changed_at from deal_phase_change
							where deal_id = d.id order by happened_at desc limit 1
						) latest on true
						where d.id = ${deal_id}::uuid`.execute(tx);
					return (
						deal && {
							...deal,
							change_id: (await latestChange(tx, "deal", deal.deal_id)) ?? 0,
						}
					);
				},
			);
			return result ? c.json(result) : refuse(c, new Refusal(404, "not_found"));
		} catch (error) {
			if (error instanceof SaveRefusal) return refuse(c, error.refusal);
			console.warn("deal read failed:", failureKind(error));
			return refuse(c, new Refusal(503, "database_unavailable"));
		}
	},
);
