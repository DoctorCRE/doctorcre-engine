import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { answerNextRead, checkFields, Refusal, refuse } from "../answer.ts";
import type { JsonObject } from "../database.d.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { partyMatchFields } from "../party-match.ts";
import {
	fit,
	isBoolean,
	isStoredText,
	isUuid,
	optional,
} from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";
import { contactOf, type Phone, phoneNumber } from "./contact.ts";
import { changing, edit, unchangedSince } from "./edit.ts";

const isKind = (value: unknown): value is "person" | "company" =>
	value === "person" || value === "company";

const NEW_PARTY = {
	idempotency_key: isUuid,
	kind: isKind,
	name: isStoredText,
	email: optional(isStoredText),
	phone: optional(isStoredText),
	city: optional(isStoredText),
	company_id: optional(isUuid),
	title: optional(isStoredText),
	force_new: optional(isBoolean),
};

const EDIT_PARTY = {
	idempotency_key: isUuid,
	name: edit(isStoredText),
	city: edit(isStoredText),
	email: edit(isStoredText),
	phone: edit(isStoredText),
};
const EDITABLE = ["name", "city", "email", "phone"] as const;

const trimmed = (value: string | undefined | null) => value?.trim() || null;

// Each contact is stored in one form; the database checks the form, so the door converts first.
function storedContact(fields: {
	email?: string | null | undefined;
	phone?: string | null | undefined;
}) {
	const email = trimmed(fields.email)?.toLowerCase() ?? null;
	const typed = trimmed(fields.phone);
	const phone = typed === null ? null : phoneNumber(typed);
	return phone === undefined
		? new Refusal(400, "invalid_field_value", { fields: ["phone"] })
		: { email, phone };
}

function parseNewParty(body: JsonObject) {
	const request = fit(body, NEW_PARTY, ["idempotency_key", "kind", "name"]);
	if (request instanceof Refusal) return request;
	const misplaced = (["company_id", "title"] as const).filter(
		(field) =>
			request[field] !== undefined &&
			(request.kind === "company" || !request.company_id),
	);
	if (misplaced.length)
		return new Refusal(400, "invalid_field_value", { fields: misplaced });
	const contact = storedContact(request);
	if (contact instanceof Refusal) return contact;
	return {
		...request,
		...contact,
		name: request.name.trim(),
		city: trimmed(request.city),
		title: trimmed(request.title),
	};
}
type NewParty = Exclude<ReturnType<typeof parseNewParty>, Refusal>;

async function refuseMalformed(
	tx: Transaction<DB>,
	{ email, phone }: { email: string | null; phone: Phone | null },
) {
	const { rows } = await sql<{ email: boolean; phone: boolean }>`
		select pg_input_is_valid(coalesce(${email}, 'a@b.c'), 'email_address') as email,
			pg_input_is_valid(coalesce(${phone?.number ?? null}, '+12025550100'), 'phone_number') as phone`.execute(
		tx,
	);
	const fields = (["email", "phone"] as const).filter(
		(field) => !rows[0]?.[field],
	);
	if (fields.length)
		throw new SaveRefusal(new Refusal(400, "invalid_field_value", { fields }));
}

async function addEmail(
	tx: Transaction<DB>,
	party_id: string,
	address: string,
) {
	await tx
		.insertInto("party_email")
		.values({
			party_id,
			address,
			label: "work",
			is_primary: true,
			changed_at: sql<string>`now()`,
		})
		.execute();
}

async function addPhone(
	tx: Transaction<DB>,
	party_id: string,
	{ number, extension }: Phone,
) {
	await tx
		.insertInto("party_phone")
		.values({
			party_id,
			number,
			extension,
			label: "work",
			is_primary: true,
			changed_at: sql<string>`now()`,
		})
		.execute();
}

async function refuseDuplicate(tx: Transaction<DB>, request: NewParty) {
	await sql`select pg_advisory_xact_lock(hashtextextended('party name:' || ${request.kind} || lower(${request.name}), 0))`.execute(
		tx,
	);
	if (request.force_new) return;
	const candidates = await tx
		.selectFrom("party")
		.select(["id", "name", "kind"])
		.select(partyMatchFields)
		.where((eb) =>
			eb.or([
				eb.and([
					eb("kind", "=", request.kind),
					eb(sql`lower(btrim(name))`, "=", sql`lower(${request.name})`),
				]),
				...(request.email
					? [
							eb.exists(
								eb
									.selectFrom("party_email")
									.whereRef("party_email.party_id", "=", "party.id")
									.where("address", "=", request.email),
							),
						]
					: []),
			]),
		)
		.orderBy("name")
		.orderBy("id")
		.limit(10)
		.execute();
	if (candidates.length)
		throw new SaveRefusal(new Refusal(409, "party_exists", { candidates }));
}

async function addParty(tx: Transaction<DB>, request: NewParty) {
	await refuseMalformed(tx, request);
	if (request.company_id) {
		const company = await tx
			.selectFrom("party")
			.select("id")
			.where("id", "=", request.company_id)
			.where("kind", "=", "company")
			.forKeyShare()
			.executeTakeFirst();
		if (!company)
			throw new SaveRefusal(
				new Refusal(400, "invalid_field_value", { fields: ["company_id"] }),
			);
	}
	await refuseDuplicate(tx, request);
	const { id: party_id } = await tx
		.insertInto("party")
		.values({
			kind: request.kind,
			name: request.name,
			city: request.city,
			changed_at: sql<string>`now()`,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	if (request.email) await addEmail(tx, party_id, request.email);
	if (request.phone) await addPhone(tx, party_id, request.phone);
	if (request.company_id)
		await tx
			.insertInto("party_company")
			.values({
				person_id: party_id,
				company_id: request.company_id,
				title: request.title,
				changed_at: sql<string>`now()`,
			})
			.execute();
	return { ...(await contactOf(tx, party_id)) };
}

function parseEdit(party_id: string, body: JsonObject) {
	if (!isUuid(party_id)) return new Refusal(404, "not_found");
	const request = fit(body, EDIT_PARTY, ["idempotency_key"]);
	if (request instanceof Refusal) return request;
	const fields = changing(request, EDITABLE);
	if (!fields.length)
		return new Refusal(400, "missing_required", { fields: [...EDITABLE] });
	if (request.name?.to === null)
		return new Refusal(400, "invalid_field_value", { fields: ["name"] });
	const to = storedContact({
		email: request.email?.to,
		phone: request.phone?.to,
	});
	if (to instanceof Refusal) return to;
	return { ...request, party_id, fields, to };
}
type Edit = Exclude<ReturnType<typeof parseEdit>, Refusal>;

async function editParty(tx: Transaction<DB>, request: Edit) {
	const { party_id, to } = request;
	const locked = await tx
		.selectFrom("party")
		.select("id")
		.where("id", "=", party_id)
		.forUpdate()
		.executeTakeFirst();
	if (!locked) throw new SaveRefusal(new Refusal(404, "not_found"));
	const current = await contactOf(tx, party_id);
	if (!current) throw new SaveRefusal(new Refusal(404, "not_found"));
	unchangedSince(request, request.fields, {
		...current,
		phone: current.phone?.shown ?? null,
	});
	await refuseMalformed(tx, to);
	const name = trimmed(request.name?.to);
	if (name !== null || request.city)
		await tx
			.updateTable("party")
			.set({
				...(name !== null && { name }),
				...(request.city && { city: trimmed(request.city.to) }),
			})
			.where("id", "=", party_id)
			.execute();
	// A changed address or number is a removed row and a new one.
	if (request.email) {
		await tx
			.deleteFrom("party_email")
			.where("party_id", "=", party_id)
			.where((eb) =>
				eb.or([
					eb("is_primary", "=", true),
					eb("address", "=", to.email ?? ""),
				]),
			)
			.execute();
		if (to.email) await addEmail(tx, party_id, to.email);
	}
	if (request.phone) {
		await tx
			.deleteFrom("party_phone")
			.where("party_id", "=", party_id)
			.where((eb) =>
				eb.or([
					eb("is_primary", "=", true),
					eb.and([
						eb("number", "=", to.phone?.number ?? ""),
						eb(
							"extension",
							"is not distinct from",
							to.phone?.extension ?? null,
						),
					]),
				]),
			)
			.execute();
		if (to.phone) await addPhone(tx, party_id, to.phone);
	}
	return { ...(await contactOf(tx, party_id)) };
}

// Only an id, so /parties/search stays the search's.
const PARTY_ID = "[0-9A-Fa-f-]{36}";

export const parties = new Hono<NextSaveEnv>()
	.get(`/parties/:party{${PARTY_ID}}`, async (c) => {
		const refused = checkFields(new URL(c.req.url).searchParams, []);
		if (refused) return refuse(c, refused);
		const party_id = c.req.param("party");
		if (!isUuid(party_id)) return refuse(c, new Refusal(404, "not_found"));
		return answerNextRead(
			c,
			"read-party",
			async (db) =>
				(await contactOf(db, party_id)) ?? new Refusal(404, "not_found"),
		);
	})
	.post("/parties", (c) =>
		answerNextSave(c, "add-party", parseNewParty, addParty, 201),
	)
	.post(`/parties/:party{${PARTY_ID}}`, (c) =>
		answerNextSave(
			c,
			"edit-party",
			(body) => parseEdit(c.req.param("party"), body),
			editParty,
		),
	);
