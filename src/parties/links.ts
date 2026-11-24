import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { Refusal } from "../answer.ts";
import { isCalendarDate } from "../calendar-date.ts";
import type { JsonObject } from "../database.d.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { fit, isStoredText, isUuid, optional } from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";
import { changing, edit, unchangedSince } from "./edit.ts";

const isKind = (value: unknown): value is "knows" | "can_introduce" =>
	value === "knows" || value === "can_introduce";

const NEW_LINK = {
	idempotency_key: isUuid,
	kind: isKind,
	party_id: isUuid,
	other_party_id: isUuid,
	started_on: optional(isCalendarDate),
	note: optional(isStoredText),
};
const EDIT_LINK = {
	idempotency_key: isUuid,
	started_on: edit(isCalendarDate),
	ended_on: edit(isCalendarDate),
	note: edit(isStoredText),
};
const EDITABLE = ["started_on", "ended_on", "note"] as const;

const linkRead = (tx: Transaction<DB>, id: string) =>
	tx
		.selectFrom("party_link")
		.select([
			"id as link_id",
			"kind",
			"party_id",
			"other_party_id",
			sql<string | null>`started_on::text`.as("started_on"),
			sql<string | null>`ended_on::text`.as("ended_on"),
			"note",
		])
		.where("id", "=", id)
		.executeTakeFirst();

function parseLink(body: JsonObject) {
	const request = fit(body, NEW_LINK, [
		"idempotency_key",
		"kind",
		"party_id",
		"other_party_id",
	]);
	if (request instanceof Refusal) return request;
	if (request.party_id === request.other_party_id)
		return new Refusal(400, "invalid_field_value", {
			fields: ["other_party_id"],
		});
	return { ...request, note: request.note?.trim() ?? null };
}

// A knows link goes both ways, so either order finds it. A lapsed link leaves room for a new one.
async function addLink(
	tx: Transaction<DB>,
	request: Exclude<ReturnType<typeof parseLink>, Refusal>,
) {
	const { kind, party_id, other_party_id } = request;
	const ends = [party_id, other_party_id].sort();
	const parties = await tx
		.selectFrom("party")
		.select("id")
		.where("id", "in", ends)
		.orderBy("id")
		.forKeyShare()
		.execute();
	if (parties.length !== 2)
		throw new SaveRefusal(new Refusal(404, "not_found"));
	await sql`select pg_advisory_xact_lock(hashtextextended('party link:' || ${kind} || ${ends.join(":")}, 0))`.execute(
		tx,
	);
	const current = await tx
		.selectFrom("party_link")
		.select("id")
		.where("kind", "=", kind)
		.where((eb) =>
			eb.or([
				eb.and([
					eb("party_id", "=", party_id),
					eb("other_party_id", "=", other_party_id),
				]),
				...(kind === "knows"
					? [
							eb.and([
								eb("party_id", "=", other_party_id),
								eb("other_party_id", "=", party_id),
							]),
						]
					: []),
			]),
		)
		.where((eb) =>
			eb.or([
				eb("ended_on", "is", null),
				eb("ended_on", ">", sql<string>`current_date`),
			]),
		)
		.executeTakeFirst();
	if (current)
		throw new SaveRefusal(
			new Refusal(409, "already_linked", { link_id: current.id }),
		);
	const { id } = await tx
		.insertInto("party_link")
		.values({
			kind,
			party_id,
			other_party_id,
			started_on: request.started_on ?? null,
			note: request.note,
			changed_at: sql<string>`now()`,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	return { ...(await linkRead(tx, id)) };
}

function parseEdit(link_id: string, body: JsonObject) {
	if (!isUuid(link_id)) return new Refusal(404, "not_found");
	const request = fit(body, EDIT_LINK, ["idempotency_key"]);
	if (request instanceof Refusal) return request;
	const fields = changing(request, EDITABLE);
	if (!fields.length)
		return new Refusal(400, "missing_required", { fields: [...EDITABLE] });
	return { ...request, link_id, fields };
}

async function editLink(
	tx: Transaction<DB>,
	request: Exclude<ReturnType<typeof parseEdit>, Refusal>,
) {
	const { link_id } = request;
	const locked = await tx
		.selectFrom("party_link")
		.select("id")
		.where("id", "=", link_id)
		.forUpdate()
		.executeTakeFirst();
	const current = locked && (await linkRead(tx, link_id));
	if (!current) throw new SaveRefusal(new Refusal(404, "not_found"));
	unchangedSince(request, request.fields, current);
	await tx
		.updateTable("party_link")
		.set({
			...(request.started_on && { started_on: request.started_on.to }),
			...(request.ended_on && { ended_on: request.ended_on.to }),
			...(request.note && { note: request.note.to?.trim() || null }),
		})
		.where("id", "=", link_id)
		.execute();
	return { ...(await linkRead(tx, link_id)) };
}

export const partyLinks = new Hono<NextSaveEnv>()
	.post("/party-links", (c) =>
		answerNextSave(c, "add-party-link", parseLink, addLink, 201),
	)
	.post("/party-links/:link", (c) =>
		answerNextSave(
			c,
			"edit-party-link",
			(body) => parseEdit(c.req.param("link"), body),
			editLink,
		),
	);
