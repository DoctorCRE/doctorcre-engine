import { Hono } from "hono";
import { sql } from "kysely";
import { isoMillis, Refusal, refuse } from "./answer.ts";
import { nextTransaction } from "./next-connection.ts";
import { answerNextSave, type NextSaveEnv } from "./next-door.ts";
import { clearable, fit, isInstant, isText, isUuid } from "./request-shape.ts";

const invoiceText = (value: unknown): value is string =>
	isText(value) && !value.includes("\0");

// PostgreSQL rejects NUL and dates JS parses (Feb 31, year 0000, +23:00), yielding a 503.
const captureRequest = {
	idempotency_key: isUuid,
	evidence_ref: invoiceText,
	sender: invoiceText,
	deal_name: invoiceText,
	client_name: clearable(invoiceText),
	property_address: clearable(invoiceText),
	occurred_at: isInstant,
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
			async (tx, evidence) => {
				const {
					evidence_ref,
					sender,
					deal_name,
					client_name,
					property_address,
					occurred_at,
				} = evidence;
				const {
					rows: [inserted],
				} = await sql<{ invoice_id: string }>`
					insert into invoice_email
						(evidence_ref, sender, deal_name, client_name, property_address, occurred_at, email_date)
					values (${evidence_ref}, ${sender.trim().toLowerCase()}, ${deal_name},
						${client_name ?? null}, ${property_address ?? null}, ${occurred_at}, ${occurred_at.slice(0, 10)})
					on conflict (evidence_ref) do nothing
					returning id as invoice_id
				`.execute(tx);
				const saved =
					inserted ??
					(await tx
						.selectFrom("invoice_email")
						.select("id as invoice_id")
						.where("evidence_ref", "=", evidence_ref)
						.executeTakeFirstOrThrow());
				return { ...saved, evidence_ref };
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
