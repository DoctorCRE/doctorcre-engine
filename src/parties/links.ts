import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { Refusal } from "../answer.ts";
import { isCalendarDate } from "../calendar-date.ts";
import type { JsonObject } from "../database.d.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import {
	fit,
	isStoredText,
	isUuid,
	optional,
	orNull,
} from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";
import { lock } from "./contact.ts";
import { changing, edit, unchangedSince } from "./edit.ts";

type Kind = "knows" | "can_introduce";
const isKind = (value: unknown): value is Kind =>
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
	started_on: edit(orNull(isCalendarDate)),
	ended_on: edit(orNull(isCalendarDate)),
	note: edit(orNull(isStoredText)),
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
		.$narrowType<{ kind: Kind }>()
		.where("id", "=", id);

function parseLink(body: JsonObject) {
	const request = fit(body, NEW_LINK, [
		"idempotency_key",
		"kind",
		"party_id",
		"other_party_id",
	]);
	if (request instanceof Refusal) return request;
	if (request.party_id.toLowerCase() === request.other_party_id.toLowerCase())
		return new Refusal(400, "invalid_field_value", {
			fields: ["other_party_id"],
		});
	return {
		...request,
		party_id: request.party_id.toLowerCase(),
		other_party_id: request.other_party_id.toLowerCase(),
		note: request.note?.trim() ?? null,
	};
}

type Pair = {
	kind: Kind;
	party_id: string;
	other_party_id: string;
};

// The database keeps one current link per pair and kind; this names it in the refusal.
// A knows link goes both ways, so either order finds it.
async function refuseLinked(
	tx: Transaction<DB>,
	{ kind, party_id, other_party_id }: Pair,
) {
	const ends = [party_id, other_party_id].sort();
	await lock(tx, `party link:${kind}${ends.join(":")}`);
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
		.where("ended_on", "is", null)
		.executeTakeFirst();
	if (current)
		throw new SaveRefusal(
			new Refusal(409, "already_linked", { link_id: current.id }),
		);
}

// The link a save has just written or locked.
async function savedLink(tx: Transaction<DB>, link_id: string) {
	const link = await linkRead(tx, link_id).executeTakeFirst();
	if (!link) throw new Error(`party link ${link_id} is missing after its save`);
	return link;
}

async function addLink(
	tx: Transaction<DB>,
	request: Exclude<ReturnType<typeof parseLink>, Refusal>,
) {
	const parties = await tx
		.selectFrom("party")
		.select("id")
		.where("id", "in", [request.party_id, request.other_party_id].sort())
		.orderBy("id")
		.forKeyShare()
		.execute();
	if (parties.length !== 2)
		throw new SaveRefusal(new Refusal(404, "not_found"));
	await refuseLinked(tx, request);
	const { id } = await tx
		.insertInto("party_link")
		.values({
			kind: request.kind,
			party_id: request.party_id,
			other_party_id: request.other_party_id,
			started_on: request.started_on ?? null,
			note: request.note,
			changed_at: sql<string>`now()`,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	return savedLink(tx, id);
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
	const current = await linkRead(tx, link_id).forUpdate().executeTakeFirst();
	if (!current) throw new SaveRefusal(new Refusal(404, "not_found"));
	unchangedSince(request, request.fields, current);
	if (current.ended_on !== null && request.ended_on?.to === null)
		await refuseLinked(tx, current);
	await tx
		.updateTable("party_link")
		.set({
			...(request.started_on && { started_on: request.started_on.to }),
			...(request.ended_on && { ended_on: request.ended_on.to }),
			...(request.note && { note: request.note.to?.trim() ?? null }),
		})
		.where("id", "=", link_id)
		.execute();
	return savedLink(tx, link_id);
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
