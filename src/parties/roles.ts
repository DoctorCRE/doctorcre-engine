import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { Refusal } from "../answer.ts";
import type { JsonObject } from "../database.d.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { ACTING_USER, userId } from "../next-save.ts";
import {
	type Check,
	fit,
	isBoolean,
	isStoredText,
	isUuid,
	optional,
	type Shape,
} from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";
import { changing, edit, unchangedSince } from "./edit.ts";

const oneOf =
	<T extends string | number>(...allowed: T[]): Check<T> =>
	(value): value is T =>
		allowed.includes(value as T);
const isSlugs: Check<string[]> = (value): value is string[] =>
	Array.isArray(value) && value.every(isStoredText);

const CLIENT = {
	status: oneOf("roster", "cold", "engaged", "paused"),
	client_type: isStoredText,
	how_found: isStoredText,
	vertical: isStoredText,
	subtype: isStoredText,
};
const VENDOR = {
	categories: isSlugs,
	stage: isStoredText,
	relationship_level: oneOf(0, 1, 2, 3),
	owner: oneOf("joe", "dell"),
	offers: isStoredText,
	seeking: isStoredText,
	is_target: isBoolean,
	disposition: oneOf("parked", "avoid"),
	disposition_reason: isStoredText,
};
const CLIENT_FIELDS = Object.keys(CLIENT) as (keyof typeof CLIENT)[];
const VENDOR_FIELDS = Object.keys(VENDOR) as (keyof typeof VENDOR)[];

type Values<S extends Shape> = {
	[K in keyof S]: S[K] extends Check<infer T> ? T : never;
};
type Changes<S extends Shape> = { [K in keyof S]?: Values<S>[K] | null };

const optionalAll = <S extends Shape>(shape: S) =>
	Object.fromEntries(
		Object.entries(shape).map(([field, check]) => [field, optional(check)]),
	) as { [K in keyof S]: Check<Values<S>[K] | undefined> };
const editAll = <S extends Shape>(shape: S) =>
	Object.fromEntries(
		Object.entries(shape).map(([field, check]) => [field, edit(check)]),
	) as { [K in keyof S]: ReturnType<typeof edit> };

const clientRead = (tx: Transaction<DB>, party_id: string) =>
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

const vendorRead = (tx: Transaction<DB>, party_id: string) =>
	tx
		.selectFrom("party_role as v")
		.leftJoin("app_user as owner", "owner.id", "v.owner_user_id")
		.select([
			"v.party_id",
			"v.stage",
			"v.relationship_level",
			"owner.slug as owner",
			"v.offers",
			"v.seeking",
			"v.is_target",
			"v.disposition",
			"v.disposition_reason",
		])
		.select((eb) =>
			eb.fn
				.coalesce(
					eb
						.selectFrom("party_role as c")
						.innerJoin("role", "role.slug", "c.role")
						.select(sql<string[]>`array_agg(c.role order by c.role)`.as("r"))
						.whereRef("c.party_id", "=", "v.party_id")
						.where("role.category_of", "=", "vendor"),
					sql<string[]>`'{}'`,
				)
				.as("categories"),
		)
		.where("v.party_id", "=", party_id)
		.where("v.role", "=", "vendor")
		.executeTakeFirst();

const invalid = (fields: string[]) =>
	new SaveRefusal(new Refusal(400, "invalid_field_value", { fields }));

// Choices come from their lists, so a mistyped one is named back rather than refused by a key.
async function refuseUnknown(
	tx: Transaction<DB>,
	request: {
		client_type?: string | null | undefined;
		how_found?: string | null | undefined;
		stage?: string | null | undefined;
		categories?: string[] | null | undefined;
	},
) {
	const { rows } = await sql<{ field: string }>`
		select field from (values
			('client_type', ${request.client_type ?? null}::text is null
				or exists (select from client_type where slug = ${request.client_type ?? null})),
			('how_found', ${request.how_found ?? null}::text is null
				or exists (select from how_found where slug = ${request.how_found ?? null})),
			('stage', ${request.stage ?? null}::text is null
				or exists (select from stage where role = 'vendor' and slug = ${request.stage ?? null})),
			('categories', (select count(*) from role where category_of = 'vendor'
				and slug = any(${request.categories ?? []}::text[]))
				= cardinality(array(select distinct unnest(${request.categories ?? []}::text[]))))
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

async function setVertical(
	tx: Transaction<DB>,
	party_id: string,
	vertical: string | null | undefined,
	subtype: string | null | undefined,
) {
	await tx
		.deleteFrom("client_vertical")
		.where("party_id", "=", party_id)
		.execute();
	if (vertical)
		await tx
			.insertInto("client_vertical")
			.values({
				party_id,
				vertical: vertical.trim(),
				subtype: subtype?.trim() || null,
				changed_at: sql<string>`now()`,
			})
			.execute();
	else if (subtype) throw invalid(["subtype"]);
}

async function setCategories(
	tx: Transaction<DB>,
	party_id: string,
	categories: string[],
) {
	await tx
		.deleteFrom("party_role")
		.where("party_id", "=", party_id)
		.where("role", "in", (eb) =>
			eb.selectFrom("role").select("slug").where("category_of", "=", "vendor"),
		)
		.where("role", "not in", [...categories, ""])
		.execute();
	if (categories.length)
		await tx
			.insertInto("party_role")
			.values(
				categories.map((role) => ({
					party_id,
					role,
					changed_at: sql<string>`now()`,
				})),
			)
			.onConflict((conflict) =>
				conflict.columns(["party_id", "role"]).doNothing(),
			)
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
type NewVendor = Exclude<ReturnType<typeof parseNew<typeof VENDOR>>, Refusal>;

async function addClient(tx: Transaction<DB>, request: NewClient) {
	const { party_id } = request;
	const party = await lockParty(tx, party_id);
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
	await tx
		.insertInto("party_role")
		.values({ party_id, role: "client", changed_at: sql<string>`now()` })
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
	await setVertical(tx, party_id, request.vertical, request.subtype);
	return { ...(await clientRead(tx, party_id)) };
}

async function addVendor(tx: Transaction<DB>, request: NewVendor) {
	const { party_id } = request;
	await lockParty(tx, party_id);
	if (await vendorRead(tx, party_id))
		throw new SaveRefusal(new Refusal(409, "already_vendor", { party_id }));
	await refuseUnknown(tx, request);
	const { categories = [], owner, ...role } = request;
	await tx
		.insertInto("party_role")
		.values({
			party_id,
			role: "vendor",
			stage: role.stage ?? null,
			relationship_level: role.relationship_level ?? null,
			owner_user_id: owner ? await userId(tx, owner) : ACTING_USER,
			offers: role.offers?.trim() ?? null,
			seeking: role.seeking?.trim() ?? null,
			is_target: role.is_target ?? false,
			disposition: role.disposition ?? null,
			disposition_reason: role.disposition_reason?.trim() ?? null,
			changed_at: sql<string>`now()`,
		})
		.execute();
	await setCategories(tx, party_id, categories);
	return { ...(await vendorRead(tx, party_id)) };
}

function parseEdit<S extends Shape>(
	shape: S,
	fields: readonly (keyof S & string)[],
	party_id: string,
	body: JsonObject,
) {
	if (!isUuid(party_id)) return new Refusal(404, "not_found");
	const refused = fit(body, { idempotency_key: isUuid, ...editAll(shape) }, [
		"idempotency_key",
	]);
	if (refused instanceof Refusal) return refused;
	// Each field fitted { from, to } above.
	const seen = body as { idempotency_key: string } & JsonObject &
		Partial<Record<keyof S & string, { from: unknown; to: unknown }>>;
	const changed = changing(seen, fields);
	if (!changed.length)
		return new Refusal(400, "missing_required", { fields: [...fields] });
	const to = Object.fromEntries(
		changed.map((field) => [field, seen[field]?.to]),
	) as Changes<S>;
	return {
		idempotency_key: seen.idempotency_key,
		party_id,
		changed,
		request: seen,
		to,
	};
}
type ClientEdit = Exclude<ReturnType<typeof parseEdit<typeof CLIENT>>, Refusal>;
type VendorEdit = Exclude<ReturnType<typeof parseEdit<typeof VENDOR>>, Refusal>;

async function editClient(
	tx: Transaction<DB>,
	{ party_id, changed, request, to }: ClientEdit,
) {
	await lockParty(tx, party_id);
	const current = await clientRead(tx, party_id);
	if (!current) throw new SaveRefusal(new Refusal(404, "not_found"));
	unchangedSince(request, changed, current);
	if (to.status === null || to.how_found === null)
		throw invalid(
			changed.filter((field) => field === "status" || field === "how_found"),
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
	if ("vertical" in to || "subtype" in to)
		await setVertical(
			tx,
			party_id,
			"vertical" in to ? to.vertical : current.vertical,
			"subtype" in to ? to.subtype : current.subtype,
		);
	return { ...(await clientRead(tx, party_id)) };
}

async function editVendor(
	tx: Transaction<DB>,
	{ party_id, changed, request, to }: VendorEdit,
) {
	await lockParty(tx, party_id);
	const current = await vendorRead(tx, party_id);
	if (!current) throw new SaveRefusal(new Refusal(404, "not_found"));
	unchangedSince(request, changed, current);
	await refuseUnknown(tx, to);
	const { categories, owner, is_target, ...role } = to;
	if (is_target === null) throw invalid(["is_target"]);
	const columns = {
		...role,
		...(is_target !== undefined && { is_target }),
		...(role.offers !== undefined && { offers: role.offers?.trim() || null }),
		...(role.seeking !== undefined && {
			seeking: role.seeking?.trim() || null,
		}),
		...(role.disposition_reason !== undefined && {
			disposition_reason: role.disposition_reason?.trim() || null,
		}),
		...(owner !== undefined && {
			owner_user_id: owner ? await userId(tx, owner) : null,
		}),
	};
	if (Object.keys(columns).length)
		await tx
			.updateTable("party_role")
			.set(columns)
			.where("party_id", "=", party_id)
			.where("role", "=", "vendor")
			.execute();
	if (categories !== undefined)
		await setCategories(tx, party_id, categories ?? []);
	return { ...(await vendorRead(tx, party_id)) };
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
			(body) => parseEdit(CLIENT, CLIENT_FIELDS, c.req.param("party"), body),
			editClient,
		),
	)
	.post("/vendors", (c) =>
		answerNextSave(
			c,
			"add-vendor",
			(body) => parseNew(VENDOR, body),
			addVendor,
			201,
		),
	)
	.post(`/vendors/:party{${PARTY_ID}}`, (c) =>
		answerNextSave(
			c,
			"edit-vendor",
			(body) => parseEdit(VENDOR, VENDOR_FIELDS, c.req.param("party"), body),
			editVendor,
		),
	);
