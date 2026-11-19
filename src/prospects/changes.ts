import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { Refusal } from "../answer.ts";
import { PARTNERS } from "../clients/read.ts";
import type { JsonObject } from "../database.d.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { userId } from "../next-save.ts";
import {
	clearable,
	fit,
	fitting,
	isBoolean,
	isChangeId,
	isText,
	isUuid,
	optional,
} from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";
import { seenAnswer, unseenChanges } from "../seen-change.ts";
import { lockLead, requireProspect } from "./membership.ts";

const OWNER_REFUSAL = { hint: "Choose Joe or Dell, or leave it Unclaimed." };

const FIELDS = {
	owner: clearable(isText),
	needs_attention: optional(isBoolean),
};
const CHANGES = {
	idempotency_key: isUuid,
	seen_change_id: isChangeId,
	fields: fitting(FIELDS),
};
const DROP = { idempotency_key: isUuid, reason: isText };

function parseChanges(party_id: string, body: JsonObject) {
	if (!isUuid(party_id)) return new Refusal(404, "not_found");
	const request = fit(body, CHANGES, [
		"idempotency_key",
		"seen_change_id",
		"fields",
	]);
	if (request instanceof Refusal) return request;
	const { owner } = request.fields;
	if (owner != null && !PARTNERS.some((partner) => partner === owner))
		return new Refusal(400, "unknown_owner", OWNER_REFUSAL);
	if (!Object.keys(request.fields).length)
		return new Refusal(400, "invalid_field_value", { fields: ["fields"] });
	return { party_id, ...request };
}

function parseDrop(party_id: string, body: JsonObject) {
	if (!isUuid(party_id)) return new Refusal(404, "not_found");
	if (typeof body.reason === "string" && !body.reason.trim())
		return new Refusal(400, "missing_required", { fields: ["reason"] });
	const request = fit(body, DROP, ["idempotency_key", "reason"]);
	return request instanceof Refusal ? request : { party_id, ...request };
}

type Changes = Exclude<ReturnType<typeof parseChanges>, Refusal>;
type Drop = Exclude<ReturnType<typeof parseDrop>, Refusal>;

async function changeProspect(
	tx: Transaction<DB>,
	{ party_id, fields, seen_change_id }: Changes,
) {
	const lead = await lockLead(tx, party_id);
	if (!lead) throw new SaveRefusal(new Refusal(404, "not_found"));
	await requireProspect(tx, party_id, lead.stage);
	const { owner, needs_attention } = fields;
	const changed = {
		...(owner !== undefined && {
			owner_user_id:
				owner === null ? null : await userId(tx, owner, OWNER_REFUSAL),
		}),
		...(needs_attention !== undefined && { needs_attention }),
	};
	const record = { party_id, role: "lead" } as const;
	const unseen = await unseenChanges(
		tx,
		"party_role",
		record,
		seen_change_id,
		Object.keys(changed),
	);
	await tx
		.updateTable("party_role")
		.set(changed)
		.where("party_id", "=", party_id)
		.where("role", "=", "lead")
		.execute();
	return {
		party_id,
		...(await seenAnswer(tx, "party_role", record, seen_change_id, unseen)),
	};
}

async function dropProspect(tx: Transaction<DB>, { party_id, reason }: Drop) {
	const lead = await lockLead(tx, party_id);
	await requireProspect(tx, party_id, lead?.stage);
	await tx
		.insertInto("lead_stage_move")
		.values({
			party_id,
			from_stage: "opportunity",
			to_stage: "archived",
			strength: "weak",
			reason: reason.trim(),
			changed_at: sql<string>`now()`,
		})
		.execute();
	return { party_id, stage: "archived" };
}

export const prospectChanges = new Hono<NextSaveEnv>()
	.post("/prospects/:party_id/changes", (c) =>
		answerNextSave(
			c,
			"change-prospect",
			(body) => parseChanges(c.req.param("party_id"), body),
			changeProspect,
		),
	)
	.post("/prospects/:party_id/drop", (c) =>
		answerNextSave(
			c,
			"drop-prospect",
			(body) => parseDrop(c.req.param("party_id"), body),
			dropProspect,
		),
	);
