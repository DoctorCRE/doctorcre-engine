import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { Refusal } from "../answer.ts";
import { isCalendarDate } from "../calendar-date.ts";
import type { JsonObject } from "../database.d.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { ACTING_USER } from "../next-save.ts";
import {
	type Check,
	fit,
	fitting,
	isStoredText,
	isUuid,
	optional,
	orNull,
} from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";

const isMaker = (value: unknown): value is "vendor" | "team" =>
	value === "vendor" || value === "team";

const NEW_INTRODUCTION = {
	idempotency_key: isUuid,
	vendor_id: isUuid,
	made_by: isMaker,
	introduced_party_id: isUuid,
	introduced_on: isCalendarDate,
	note: isStoredText,
	deal_id: optional(isUuid),
};

// A change names the value the partner saw, so one made since is not overwritten.
const isSeen = (value: unknown): value is string | null =>
	value === null || typeof value === "string";
const edit = <T>(check: Check<T>) =>
	optional(fitting({ from: isSeen, to: check }));

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
		"note",
	]);
	if (request instanceof Refusal) return request;
	if (
		request.vendor_id.toLowerCase() ===
		request.introduced_party_id.toLowerCase()
	)
		return new Refusal(400, "invalid_field_value", {
			fields: ["introduced_party_id"],
		});
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
	const { id } = await tx
		.insertInto("introduction")
		.values({
			vendor_id: request.vendor_id,
			made_by: request.made_by,
			introduced_by_user_id: request.made_by === "team" ? ACTING_USER : null,
			introduced_party_id: request.introduced_party_id,
			introduced_on: request.introduced_on,
			deal_id: request.deal_id ?? null,
			note: request.note.trim(),
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
	const fields = EDITABLE.filter((field) => request[field] !== undefined);
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
	const stale = request.fields.filter(
		(field) => request[field]?.from !== current[field],
	);
	if (stale.length)
		throw new SaveRefusal(
			new Refusal(409, "version_conflict", { fields: stale, current }),
		);
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
	);
