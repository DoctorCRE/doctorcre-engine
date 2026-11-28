import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { Refusal } from "../answer.ts";
import { isCalendarDate } from "../calendar-date.ts";
import { PARTNERS } from "../clients/read.ts";
import type { JsonObject } from "../database.d.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { ACTING_USER, userId } from "../next-save.ts";
import {
	fit,
	isBoolean,
	isOneOf,
	isStoredText,
	isUuid,
	optional,
	orNull,
} from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";
import { changing, edit, unchangedSince } from "./edit.ts";

const MAKERS = ["vendor", "team", "client"] as const;

const NEW_INTRODUCTION = {
	idempotency_key: isUuid,
	vendor_id: isUuid,
	made_by: (value: unknown) => isOneOf(MAKERS, value),
	unrecorded_only: optional(isBoolean),
	replaces: optional(isUuid),
	introduced_party_id: isUuid,
	introduced_on: isCalendarDate,
	note: optional(isStoredText),
	deal_id: optional(isUuid),
	// The partner who made a team introduction, when not the one saving it.
	introduced_by: optional((value: unknown) => isOneOf(PARTNERS, value)),
};

const EDIT_INTRODUCTION = {
	idempotency_key: isUuid,
	introduced_on: edit(isCalendarDate),
	deal_id: edit(orNull(isUuid)),
	note: edit(isStoredText),
};
const EDITABLE = ["introduced_on", "deal_id", "note"] as const;

const introductionRead = (tx: Transaction<DB>, id: string) =>
	tx
		.selectFrom("introduction as i")
		.leftJoin("app_user as u", "u.id", "i.introduced_by_user_id")
		.select([
			"i.id as introduction_id",
			"i.vendor_id",
			"i.made_by",
			"u.slug as introduced_by",
			"i.introduced_party_id",
			sql<string | null>`i.introduced_on::text`.as("introduced_on"),
			"i.deal_id",
			"i.note",
		])
		.where("i.id", "=", id)
		.executeTakeFirst();

function parseIntroduction(body: JsonObject) {
	const request = fit(body, NEW_INTRODUCTION, [
		"idempotency_key",
		"vendor_id",
		"made_by",
		"introduced_party_id",
		"introduced_on",
	]);
	if (request instanceof Refusal) return request;
	if (
		(request.made_by === "client" || request.unrecorded_only) &&
		!request.deal_id
	)
		return new Refusal(400, "missing_required", { fields: ["deal_id"] });
	const invalid = (field: string) =>
		new Refusal(400, "invalid_field_value", { fields: [field] });
	if (
		request.vendor_id.toLowerCase() ===
		request.introduced_party_id.toLowerCase()
	)
		return invalid("introduced_party_id");
	if (request.replaces && !request.unrecorded_only) return invalid("replaces");
	if (request.introduced_by && request.made_by !== "team")
		return invalid("introduced_by");
	return request;
}

const notFound = () => new SaveRefusal(new Refusal(404, "not_found"));

// Key-share locks keep what a save names from being deleted before it commits.
async function lockDeal(tx: Transaction<DB>, deal_id: string | null) {
	if (deal_id === null) return;
	const deal = await tx
		.selectFrom("deal")
		.select("id")
		.where("id", "=", deal_id)
		.forKeyShare()
		.executeTakeFirst();
	if (!deal) throw notFound();
}

// The database refuses a vendor without its vendor role.
async function addIntroduction(
	tx: Transaction<DB>,
	request: Exclude<ReturnType<typeof parseIntroduction>, Refusal>,
) {
	const parties = await tx
		.selectFrom("party")
		.select("id")
		.where("id", "in", [request.vendor_id, request.introduced_party_id].sort())
		.orderBy("id")
		.forKeyShare()
		.execute();
	if (parties.length !== 2) throw notFound();
	await lockDeal(tx, request.deal_id ?? null);
	if (request.unrecorded_only && request.deal_id) {
		const record = tx
			.selectFrom("introduction")
			.select("id")
			.where("vendor_id", "=", request.vendor_id)
			.where("deal_id", "=", request.deal_id)
			.where("confirmed", "=", true);
		// An edit holds the row before the introduction trigger takes the vendor lock.
		if (request.replaces)
			await record
				.where("id", "=", request.replaces)
				.forUpdate()
				.executeTakeFirst();
		await sql`select pg_advisory_xact_lock(hashtextextended('introduction:' || ${request.vendor_id}::uuid::text, 0))`.execute(
			tx,
		);
		const recorded = await record.limit(2).execute();
		if (
			request.replaces &&
			recorded.length === 1 &&
			recorded[0]?.id === request.replaces
		)
			await removeIntroduction(tx, { introduction_id: request.replaces });
		else if (recorded.length || request.replaces)
			throw new SaveRefusal(new Refusal(409, "introduction_already_recorded"));
	}
	const introducer = request.introduced_by
		? await userId(tx, request.introduced_by)
		: ACTING_USER;
	const { id } = await tx
		.insertInto("introduction")
		.values({
			vendor_id: request.vendor_id,
			made_by: request.made_by,
			...(request.made_by === "client" && { maker_client_role: "client" }),
			introduced_by_user_id: request.made_by === "team" ? introducer : null,
			introduced_party_id: request.introduced_party_id,
			introduced_on: request.introduced_on,
			deal_id: request.deal_id ?? null,
			note: request.note?.trim() ?? null,
			changed_at: sql<string>`now()`,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	return { ...(await introductionRead(tx, id)) };
}

function parseEdit(introduction_id: string, body: JsonObject) {
	if (!isUuid(introduction_id)) return new Refusal(404, "not_found");
	const request = fit(body, EDIT_INTRODUCTION, ["idempotency_key"]);
	if (request instanceof Refusal) return request;
	const fields = changing(request, EDITABLE);
	if (!fields.length)
		return new Refusal(400, "missing_required", { fields: [...EDITABLE] });
	return { ...request, introduction_id, fields };
}

// Who it joins and who made it never change; the engine may update only these fields.
async function editIntroduction(
	tx: Transaction<DB>,
	request: Exclude<ReturnType<typeof parseEdit>, Refusal>,
) {
	const { introduction_id } = request;
	const locked = await tx
		.selectFrom("introduction")
		.select("id")
		.where("id", "=", introduction_id)
		.forUpdate()
		.executeTakeFirst();
	const current = locked && (await introductionRead(tx, introduction_id));
	if (!current) throw notFound();
	unchangedSince(request, request.fields, current);
	if (request.deal_id) await lockDeal(tx, request.deal_id.to);
	await tx
		.updateTable("introduction")
		.set({
			...(request.introduced_on && { introduced_on: request.introduced_on.to }),
			...(request.deal_id && { deal_id: request.deal_id.to }),
			...(request.note && { note: request.note.to.trim() }),
		})
		.where("id", "=", introduction_id)
		.execute();
	return { ...(await introductionRead(tx, introduction_id)) };
}

function parseRemove(introduction_id: string, body: JsonObject) {
	if (!isUuid(introduction_id)) return new Refusal(404, "not_found");
	const request = fit(body, { idempotency_key: isUuid }, ["idempotency_key"]);
	return request instanceof Refusal ? request : { ...request, introduction_id };
}

async function removeIntroduction(
	tx: Transaction<DB>,
	{ introduction_id }: { introduction_id: string },
) {
	const removed = await tx
		.deleteFrom("introduction")
		.where("id", "=", introduction_id)
		.where("confirmed", "=", true)
		.where("source_job_id", "is", null)
		.returning("id")
		.executeTakeFirst();
	if (!removed) throw notFound();
	return { introduction_id };
}

export const introductions = new Hono<NextSaveEnv>()
	.post("/introductions", (c) =>
		answerNextSave(
			c,
			"add-introduction",
			parseIntroduction,
			addIntroduction,
			201,
		),
	)
	.post("/introductions/:introduction", (c) =>
		answerNextSave(
			c,
			"edit-introduction",
			(body) => parseEdit(c.req.param("introduction"), body),
			editIntroduction,
		),
	)
	.post("/introductions/:introduction/remove", (c) =>
		answerNextSave(
			c,
			"remove-introduction",
			(body) => parseRemove(c.req.param("introduction"), body),
			removeIntroduction,
		),
	);
