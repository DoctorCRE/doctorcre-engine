import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import pg from "pg";
import { Refusal, refuse } from "../answer.ts";
import { PARTNERS } from "../clients/read.ts";
import type { JsonObject } from "../database.d.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { ACTING_USER } from "../next-save.ts";
import { lockLead } from "../prospects/membership.ts";
import {
	fit,
	isChangeId,
	isStoredText,
	isText,
	isUuid,
	optional,
} from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";
import { STAGE_ORDER } from "./board.ts";
import { leadVersions } from "./versions.ts";

const isAction = (
	value: unknown,
): value is "acknowledge_email" | "claim" | "stage" | "link" =>
	value === "acknowledge_email" ||
	value === "claim" ||
	value === "stage" ||
	value === "link";
const SHAPE = {
	idempotency_key: isUuid,
	base_version: isChangeId,
	expected_actor: isText,
	action: isAction,
	stage: optional(isText),
	reason: optional(isStoredText),
	client_id: optional(isUuid),
	confirmed: optional((value): value is true => value === true),
};

function parseLeadChange(
	body: JsonObject,
	lead_id: string,
	actor: string | undefined,
) {
	if (!isUuid(lead_id)) return new Refusal(404, "not_found");
	const args = fit(body, SHAPE, [
		"idempotency_key",
		"base_version",
		"expected_actor",
		"action",
	]);
	if (args instanceof Refusal) return args;
	const { action, stage, reason, client_id, confirmed, ...common } = args;
	if (common.expected_actor !== actor)
		return new Refusal(409, "account_changed");
	const base = { ...common, lead_id };
	if (action === "claim") return { ...base, action };
	if (action === "acknowledge_email") return { ...base, action };
	if (action === "link") {
		if (!client_id || !confirmed)
			return new Refusal(400, "missing_required", {
				fields: ["client_id", "confirmed"],
			});
		return { ...base, action, client_id };
	}
	const target = stage === "nurture_drip" ? "nurture" : stage;
	if (!target || !STAGE_ORDER.includes(target))
		return new Refusal(400, "unknown_stage");
	if (target === "archived" && !reason)
		return new Refusal(400, "missing_required", { fields: ["reason"] });
	return { ...base, action, stage: target, reason: reason?.trim() ?? null };
}

type LeadChange = Exclude<ReturnType<typeof parseLeadChange>, Refusal>;

async function acknowledgeLeadEmail(tx: Transaction<DB>, partyId: string) {
	await tx
		.updateTable("lead_email_attention")
		.set({
			acknowledged_by_user_id: ACTING_USER,
			acknowledged_at: sql<string>`now()`,
		})
		.where("party_id", "=", partyId)
		.where("acknowledged_at", "is", null)
		.execute();
}

async function saveLeadChange(tx: Transaction<DB>, change: LeadChange) {
	const { lead_id, base_version } = change;
	const imported = await tx
		.selectFrom("outside_id")
		.select("party_id")
		.where("source", "=", "old_system_lead")
		.where("value", "=", lead_id.toLowerCase())
		.executeTakeFirst();
	const party_id = imported?.party_id ?? lead_id.toLowerCase();
	const lead = await lockLead(
		tx,
		party_id,
		change.action === "link" ? change.client_id : undefined,
	);
	if (!lead || lead.stage === null)
		throw new SaveRefusal(new Refusal(404, "not_found"));
	const answer = { ok: true, lead_id };
	if (change.action === "acknowledge_email") {
		await acknowledgeLeadEmail(tx, party_id);
		return answer;
	}
	const {
		rows: [version],
	} = await sql<{ base_version: string }>`
		select base_version from (${leadVersions}) versions where party_id = ${party_id}`.execute(
		tx,
	);
	const current_version = version ? Number(version.base_version) : null;
	if (base_version !== current_version)
		throw new SaveRefusal(
			new Refusal(409, "version_conflict", { current_version }),
		);

	const role = tx
		.updateTable("party_role")
		.where("party_id", "=", party_id)
		.where("role", "=", "lead");
	if (change.action === "stage") {
		if (change.stage === lead.stage) return answer;
		if (change.stage === "archived") {
			await tx
				.insertInto("lead_stage_move")
				.values({
					party_id,
					from_stage: lead.stage,
					to_stage: "archived",
					strength: "weak",
					reason: change.reason,
					changed_at: sql<string>`now()`,
				})
				.execute();
		} else {
			await role.set({ stage: change.stage }).execute();
		}
		return answer;
	}

	const {
		rows: [eligibility],
	} = await sql<{ excluded: boolean }>`
		select exists (select from active_do_not_contact where party_id = ${party_id})
			or exists (select from party_role where party_id = ${party_id} and role = 'client')
			or exists (select from deal_party where party_id = ${party_id}
				and role in ('client', 'client_contact')) as excluded`.execute(tx);
	const unavailable = eligibility?.excluded || lead.lead_client_id !== null;
	if (change.action === "claim") {
		if (unavailable || lead.stage === "archived" || lead.owner_user_id !== null)
			throw new SaveRefusal(new Refusal(409, "lead_not_claimable"));
		await role.set({ owner_user_id: ACTING_USER }).execute();
		const pending = await tx
			.selectFrom("lead_email_attention")
			.select("party_id")
			.where("party_id", "=", party_id)
			.where("acknowledged_at", "is", null)
			.executeTakeFirst();
		if (pending) await acknowledgeLeadEmail(tx, party_id);
	} else {
		if (unavailable)
			throw new SaveRefusal(new Refusal(409, "lead_not_linkable"));
		const target = await tx
			.selectFrom("client")
			.select("party_id")
			.where("party_id", "=", change.client_id)
			.executeTakeFirst();
		if (!target || target.party_id === party_id)
			throw new SaveRefusal(new Refusal(404, "client_not_found"));
		try {
			await role.set({ lead_client_id: target.party_id }).execute();
		} catch (error) {
			if (
				error instanceof pg.DatabaseError &&
				error.constraint === "lead_client_link_suggested"
			) {
				throw new SaveRefusal(new Refusal(409, "client_not_suggested"));
			}
			throw error;
		}
	}
	return answer;
}

export const leadChanges = new Hono<
	NextSaveEnv & { Bindings: { LEADS_READ_SCHEMA?: string } }
>().post("/leads/:lead_id/changes", async (c) => {
	if (c.env.LEADS_READ_SCHEMA !== "next")
		return refuse(c, new Refusal(404, "not_found"));
	const { user } = c.get("stamp");
	if (!PARTNERS.some((partner) => partner === user))
		return refuse(c, new Refusal(403, "AUTHORIZATION_REFUSED"));
	return answerNextSave(
		c,
		"change-lead",
		(body) => parseLeadChange(body, c.req.param("lead_id"), user),
		saveLeadChange,
	);
});
