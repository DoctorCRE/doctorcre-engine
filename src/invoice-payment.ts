import { Hono } from "hono";
import { sql } from "kysely";
import { Refusal } from "./answer.ts";
import { isCalendarDate } from "./calendar-date.ts";
import { answerNextSave, type NextSaveEnv } from "./next-door.ts";
import { fit, isChangeId, isUuid } from "./request-shape.ts";
import { SaveRefusal } from "./save.ts";
import { latestChange } from "./seen-change.ts";

const receipt = {
	idempotency_key: isUuid,
	commission_id: isUuid,
	base_version: (value: unknown): value is number =>
		isChangeId(value) && value > 0,
	received_on: (value: unknown): value is string =>
		isCalendarDate(value) && !value.startsWith("0000-"),
};

export const invoicePayment = new Hono<NextSaveEnv>().post(
	"/invoices/mark-paid",
	(c) =>
		answerNextSave(
			c,
			"record-commission-receipt",
			(body) =>
				fit(body, receipt, [
					"idempotency_key",
					"commission_id",
					"base_version",
					"received_on",
				]),
			async (tx, { commission_id, base_version, received_on }) => {
				const payment = await tx
					.selectFrom("commission_payment")
					.select(["id", "invoiced_on", "received_on"])
					.select(sql<string>`current_date`.as("today"))
					.where("id", "=", commission_id)
					.forUpdate()
					.executeTakeFirst();
				if (!payment)
					throw new SaveRefusal(new Refusal(404, "invoice_not_found"));

				const current = await latestChange(
					tx,
					"commission_payment",
					payment.id,
				);
				if (base_version !== current)
					throw new SaveRefusal(
						new Refusal(409, "version_conflict", { current_version: current }),
					);
				if (!payment.invoiced_on || payment.received_on)
					throw new SaveRefusal(new Refusal(422, "invoice_not_unpaid"));
				if (received_on < payment.invoiced_on || received_on > payment.today)
					throw new SaveRefusal(new Refusal(422, "payment_date_out_of_range"));

				await tx
					.updateTable("commission_payment")
					.set({ received_on })
					.where("id", "=", payment.id)
					.execute();
				return {
					ok: true,
					id: payment.id,
					received_on,
					base_version: await latestChange(
						tx,
						"commission_payment",
						payment.id,
					),
				};
			},
		),
);
