import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { Refusal } from "../answer.ts";
import type { JsonObject } from "../database.d.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { ACTING_USER } from "../next-save.ts";
import {
	type Check,
	fit,
	isOneOf,
	isStoredText,
	isUuid,
	optional,
	orNull,
	type Shape,
} from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";
import { changing, edit, trimmed, unchangedSince } from "./edit.ts";

const STATUSES = ["roster", "cold", "engaged", "paused"] as const;
const CLIENT = {
	status: (value: unknown) => isOneOf(STATUSES, value),
	client_type: isStoredText,
	how_found: isStoredText,
	vertical: isStoredText,
	subtype: isStoredText,
};
const CLIENT_FIELDS = Object.keys(CLIENT) as (keyof typeof CLIENT)[];

type Values<S extends Shape> = {
	[K in keyof S]: S[K] extends Check<infer T> ? T : never;
};

const optionalAll = <S extends Shape>(shape: S) =>
	Object.fromEntries(
		Object.entries(shape).map(([field, check]) => [field, optional(check)]),
	) as { [K in keyof S]: Check<Values<S>[K] | undefined> };
const editAll = <S extends Shape>(shape: S) =>
	Object.fromEntries(
		Object.entries(shape).map(([field, check]) => [field, edit(orNull(check))]),
	) as { [K in keyof S]: ReturnType<typeof edit<Values<S>[K] | null>> };

export const clientRead = (tx: Transaction<DB>, party_id: string) =>
	tx
		.selectFrom("client as c")
		.innerJoin("party as p", "p.id", "c.party_id")
		.leftJoin("client_vertical as v", "v.party_id", "c.party_id")
		.leftJoin("app_user as owner", "owner.id", "c.owner_user_id")
		.select([
			"c.party_id",
			"c.status",
			"c.client_type",
			"p.how_found",
			"v.vertical",
			"v.subtype",
			"owner.slug as owner",
		])
		.where("c.party_id", "=", party_id)
		.executeTakeFirst();

// The client a save has just written or locked.
async function savedClient(tx: Transaction<DB>, party_id: string) {
	const client = await clientRead(tx, party_id);
	if (!client) throw new Error(`client ${party_id} is missing after its save`);
	return client;
}

const invalid = (fields: string[]) =>
	new SaveRefusal(new Refusal(400, "invalid_field_value", { fields }));

// Choices come from their lists, so a mistyped one is named back rather than refused by a key.
async function refuseUnknown(
	tx: Transaction<DB>,
	request: {
		client_type?: string | null | undefined;
		how_found?: string | null | undefined;
	},
) {
	const { rows } = await sql<{ field: string }>`
		select field from (values
			('client_type', ${request.client_type ?? null}::text is null
				or exists (select from client_type where slug = ${request.client_type ?? null})),
			-- Not recorded marks a copied record a partner has yet to ask about, so a partner never sends it.
			('how_found', ${request.how_found ?? null}::text is null
				or ${request.how_found ?? null} <> 'not_recorded'
				and exists (select from how_found where slug = ${request.how_found ?? null}))
		) known (field, ok) where not ok`.execute(tx);
	if (rows.length) throw invalid(rows.map(({ field }) => field));
}

async function lockParty(tx: Transaction<DB>, party_id: string) {
	const party = await tx
		.selectFrom("party")
		.select("how_found")
		.where("id", "=", party_id)
		.forUpdate()
		.executeTakeFirst();
	if (!party) throw new SaveRefusal(new Refusal(404, "not_found"));
	return party;
}

type Practice = { vertical: string | null; subtype: string | null };

// A subtype names a kind of practice type, so it needs one.
function practiceOf(
	vertical: string | null | undefined,
	subtype: string | null | undefined,
): Practice {
	const practice = { vertical: trimmed(vertical), subtype: trimmed(subtype) };
	if (practice.subtype && !practice.vertical) throw invalid(["subtype"]);
	return practice;
}

async function setPractice(
	tx: Transaction<DB>,
	party_id: string,
	{ vertical, subtype }: Practice,
) {
	await tx
		.deleteFrom("client_vertical")
		.where("party_id", "=", party_id)
		.execute();
	if (vertical)
		await tx
			.insertInto("client_vertical")
			.values({ party_id, vertical, subtype, changed_at: sql<string>`now()` })
			.execute();
}

function parseNew<S extends Shape>(shape: S, body: JsonObject) {
	return fit(
		body,
		{ idempotency_key: isUuid, party_id: isUuid, ...optionalAll(shape) },
		["idempotency_key", "party_id"],
	);
}
type NewClient = Exclude<ReturnType<typeof parseNew<typeof CLIENT>>, Refusal>;

async function addClient(tx: Transaction<DB>, request: NewClient) {
	const { party_id } = request;
	const party = await lockParty(tx, party_id);
	const practice = practiceOf(request.vertical, request.subtype);
	if (await clientRead(tx, party_id))
		throw new SaveRefusal(new Refusal(409, "already_client", { party_id }));
	const unrecorded =
		party.how_found === null || party.how_found === "not_recorded";
	if (unrecorded && !request.how_found)
		throw new SaveRefusal(
			new Refusal(400, "missing_required", { fields: ["how_found"] }),
		);
	await refuseUnknown(tx, request);
	if (request.how_found)
		await tx
			.updateTable("party")
			.set({ how_found: request.how_found })
			.where("id", "=", party_id)
			.execute();
	// A deal can make a record a client before anyone fills in its profile.
	await tx
		.insertInto("party_role")
		.values({ party_id, role: "client", changed_at: sql<string>`now()` })
		.onConflict((conflict) =>
			conflict.columns(["party_id", "role"]).doNothing(),
		)
		.execute();
	await tx
		.insertInto("client")
		.values({
			party_id,
			status: request.status ?? "roster",
			client_type: request.client_type ?? null,
			owner_user_id: ACTING_USER,
			changed_at: sql<string>`now()`,
		})
		.execute();
	await setPractice(tx, party_id, practice);
	return savedClient(tx, party_id);
}

// What each changed field becomes, from a request fitted to its role's edit shape.
function parseEdit<
	Field extends string,
	Request extends { idempotency_key: string } & {
		[K in Field]?: { to: unknown };
	},
>(party_id: string, request: Request | Refusal, fields: readonly Field[]) {
	if (!isUuid(party_id)) return new Refusal(404, "not_found");
	if (request instanceof Refusal) return request;
	const changed = changing(request, fields);
	if (!changed.length)
		return new Refusal(400, "missing_required", { fields: [...fields] });
	const to = Object.fromEntries(
		changed.map((field) => [field, request[field]?.to]),
	) as { [K in Field]?: NonNullable<Request[K]>["to"] };
	return {
		idempotency_key: request.idempotency_key,
		party_id,
		changed,
		request,
		to,
	};
}

const CLIENT_EDIT = { idempotency_key: isUuid, ...editAll(CLIENT) };
const parseClientEdit = (party_id: string, body: JsonObject) =>
	parseEdit(
		party_id,
		fit(body, CLIENT_EDIT, ["idempotency_key"]),
		CLIENT_FIELDS,
	);
type ClientEdit = Exclude<ReturnType<typeof parseClientEdit>, Refusal>;

async function editClient(
	tx: Transaction<DB>,
	{ party_id, changed, request, to }: ClientEdit,
) {
	await lockParty(tx, party_id);
	const current = await clientRead(tx, party_id);
	if (!current) throw new SaveRefusal(new Refusal(404, "not_found"));
	unchangedSince(request, changed, current);
	const cleared = (["status", "how_found"] as const).filter(
		(field) => to[field] === null,
	);
	if (cleared.length) throw invalid([...cleared]);
	const vertical = "vertical" in to ? trimmed(to.vertical) : current.vertical;
	// A subtype belongs to the practice type it was recorded under.
	const practice = practiceOf(
		vertical,
		"subtype" in to
			? to.subtype
			: vertical === current.vertical
				? current.subtype
				: null,
	);
	await refuseUnknown(tx, to);
	if (to.how_found)
		await tx
			.updateTable("party")
			.set({ how_found: to.how_found })
			.where("id", "=", party_id)
			.execute();
	if (to.status || "client_type" in to)
		await tx
			.updateTable("client")
			.set({
				...(to.status && { status: to.status }),
				...("client_type" in to && { client_type: to.client_type ?? null }),
			})
			.where("party_id", "=", party_id)
			.execute();
	if (
		practice.vertical !== current.vertical ||
		practice.subtype !== current.subtype
	)
		await setPractice(tx, party_id, practice);
	return savedClient(tx, party_id);
}

// Only an id, so the directory's old refs stay with its reads.
const PARTY_ID = "[0-9A-Fa-f-]{36}";

export const partyRoles = new Hono<NextSaveEnv>()
	.post("/clients", (c) =>
		answerNextSave(
			c,
			"add-client",
			(body) => parseNew(CLIENT, body),
			addClient,
			201,
		),
	)
	.post(`/clients/:party{${PARTY_ID}}`, (c) =>
		answerNextSave(
			c,
			"edit-client",
			(body) => parseClientEdit(c.req.param("party"), body),
			editClient,
		),
	);
