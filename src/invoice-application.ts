import { Hono } from "hono";
import type { Transaction } from "kysely";
import { Refusal, refuse } from "./answer.ts";
import type { DB } from "./next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "./next-door.ts";
import { fit, isUuid } from "./request-shape.ts";
import { SaveRefusal } from "./save.ts";

const undo = { idempotency_key: isUuid };
const apply = { ...undo, deal_id: isUuid, payment_id: isUuid };

type InvoiceMove =
	| { status: "applied"; deal_id: string; payment_id: string }
	| { status: "undone" };

async function moveInvoice(
	tx: Transaction<DB>,
	invoiceId: string,
	move: InvoiceMove,
) {
	const invoice = await tx
		.updateTable("invoice_email")
		.set(move)
		.where("id", "=", invoiceId)
		.returning([
			"id as invoice_id",
			"deal_id",
			"payment_id",
			"status",
			"application_id",
		])
		.executeTakeFirst();
	if (!invoice) throw new SaveRefusal(new Refusal(404, "not_found"));
	return invoice;
}

export const invoiceJobs = new Hono<NextSaveEnv>().post(
	"/invoice-emails/:id/apply",
	async (c) => {
		if (c.get("stamp").job !== "lead_stage")
			return refuse(c, new Refusal(403, "unknown_job"));
		const invoice_id = c.req.param("id");
		if (!isUuid(invoice_id)) return refuse(c, new Refusal(404, "not_found"));
		return answerNextSave(
			c,
			"apply-invoice-email",
			(body) => {
				const request = fit(body, apply, [
					"idempotency_key",
					"deal_id",
					"payment_id",
				]);
				return request instanceof Refusal
					? request
					: { ...request, invoice_id };
			},
			(tx, { invoice_id, deal_id, payment_id }) =>
				moveInvoice(tx, invoice_id, { status: "applied", deal_id, payment_id }),
		);
	},
);

export const invoiceUndo = new Hono<NextSaveEnv>().post(
	"/invoice-emails/:id/undo",
	async (c) => {
		const invoice_id = c.req.param("id");
		if (!isUuid(invoice_id)) return refuse(c, new Refusal(404, "not_found"));
		return answerNextSave(
			c,
			"undo-invoice-email",
			(body) => {
				const request = fit(body, undo, ["idempotency_key"]);
				return request instanceof Refusal
					? request
					: { ...request, invoice_id };
			},
			(tx, { invoice_id }) => moveInvoice(tx, invoice_id, { status: "undone" }),
		);
	},
);
