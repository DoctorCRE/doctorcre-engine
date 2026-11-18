import { Hono } from "hono";
import { sql } from "kysely";
import { isoMillis, Refusal, refuse } from "./answer.ts";
import { isCalendarDate } from "./calendar-date.ts";
import { nextTransaction } from "./next-connection.ts";
import { answerNextSave, type NextSaveEnv } from "./next-door.ts";
import { clearable, fit, isInstant, isText, isUuid } from "./request-shape.ts";

const invoiceText = (value: unknown): value is string =>
	isText(value) && !value.includes("\0");

const invoiceInstant = (value: unknown): value is string =>
	isInstant(value) &&
	isCalendarDate(value.slice(0, 10)) &&
	!value.startsWith("0000-") &&
	/(Z|[+-](0\d|1[0-5]):[0-5]\d)$/.test(value);

const captureRequest = {
	idempotency_key: isUuid,
	evidence_ref: invoiceText,
	sender: invoiceText,
	deal_name: invoiceText,
	client_name: clearable(invoiceText),
	property_address: clearable(invoiceText),
	occurred_at: invoiceInstant,
};

export const invoiceEvidence = new Hono<NextSaveEnv>()
	.post("/invoice-emails", async (c) => {
		const stamp = c.get("stamp");
		if (stamp.job !== "mail_capture")
			return refuse(c, new Refusal(403, "unknown_job"));
		if (!stamp.for_user)
			return refuse(c, new Refusal(422, "actor_not_provisioned"));
		return answerNextSave(
			c,
			"capture-invoice-email",
			(body) =>
				fit(body, captureRequest, [
					"idempotency_key",
					"evidence_ref",
					"sender",
					"deal_name",
					"occurred_at",
				]),
			async (tx, { idempotency_key, ...evidence }) => {
				const inserted = await tx
					.insertInto("invoice_email")
					.values({
						...evidence,
						sender: evidence.sender.trim().toLowerCase(),
						email_date: evidence.occurred_at.slice(0, 10),
					})
					.onConflict((conflict) => conflict.column("evidence_ref").doNothing())
					.returning("id as invoice_id")
					.executeTakeFirst();
				const saved =
					inserted ??
					(await tx
						.selectFrom("invoice_email")
						.select("id as invoice_id")
						.where("evidence_ref", "=", evidence.evidence_ref)
						.executeTakeFirstOrThrow());
				return { ...saved, evidence_ref: evidence.evidence_ref };
			},
		);
	})
	.get("/invoice-emails", async (c) => {
		if (c.get("stamp").job !== "lead_stage")
			return refuse(c, new Refusal(403, "unknown_job"));
		const reader = c.env.DATABASE;
		if (!reader) return refuse(c, new Refusal(503, "database_unavailable"));
		try {
			const invoices = await nextTransaction(
				reader.connectionString,
				"read",
				async (tx) => {
					const rows = await tx
						.selectFrom("invoice_email")
						.leftJoinLateral(
							sql<{
								deal_id: string;
								payment_id: string;
							}>`invoice_email_target(invoice_email)`.as("matched"),
							(join) => join.onTrue(),
						)
						.leftJoin("deal", "deal.id", "matched.deal_id")
						.leftJoin("app_user", "app_user.id", "deal.owner_user_id")
						.select([
							"invoice_email.id as invoice_id",
							"evidence_ref",
							"sender",
							"deal_name",
							"client_name",
							"property_address",
							"matched.deal_id",
							"matched.payment_id",
							"app_user.slug as for_user",
						])
						.select((eb) => [
							isoMillis(eb.ref("occurred_at")).as("occurred_at"),
							sql<string>`to_char(email_date, 'YYYY-MM-DD')`.as("email_date"),
						])
						.where("invoice_email.status", "=", "captured")
						.orderBy("invoice_email.occurred_at")
						.orderBy("invoice_email.id")
						.execute();
					return rows.map(({ deal_id, payment_id, for_user, ...evidence }) => ({
						...evidence,
						target:
							deal_id && payment_id && for_user
								? { deal_id, payment_id, for_user }
								: null,
					}));
				},
			);
			return c.json({ invoices });
		} catch {
			return refuse(c, new Refusal(503, "database_unavailable"));
		}
	});
