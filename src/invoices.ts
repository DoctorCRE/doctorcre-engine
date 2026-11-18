import { Hono } from "hono";
import { type AliasedExpression, sql, type Transaction } from "kysely";
import { answer, answerNextRead, checkFields, refuse } from "./answer.ts";
import { selectNextDeals } from "./deals/next-board.ts";
import type { DB } from "./next-database.d.ts";
import { asText, type DatabaseEnv, type Reader } from "./reader.ts";

function trackerAnswer<Entry>(actor: string, entries: Entry[]) {
	return {
		schema_version: "invoice-tracker.v1",
		actor,
		entries,
		observed_at: new Date().toISOString(),
	};
}

export async function readInvoiceTracker(db: Reader, partner: string) {
	const entries = await db
		.selectFrom("v_invoice_tracker")
		.select((q) => [
			"deal_id",
			"name",
			"owner",
			"phase",
			"lane",
			"outcome",
			asText(q.ref("closed_on")).as("closed_on"),
			asText(q.ref("deal_invoiced_on")).as("invoiced_on"),
			"commission_id",
			"gross_amount",
			"status",
			"base_version",
			asText(q.ref("commission_invoiced_on")).as("commission_invoiced_on"),
			asText(q.ref("received_on")).as("received_on"),
			asText(q.ref("due_on")).as("due_on"),
			asText(sql`current_date`).as("as_of"),
		])
		.orderBy("name")
		.orderBy("commission_invoiced_on", (o) => o.asc().nullsLast())
		.orderBy("commission_id")
		.orderBy("deal_id")
		.execute();
	return trackerAnswer(partner, entries);
}

async function readNextInvoiceTracker(db: Transaction<DB>, partner: string) {
	const deals: AliasedExpression<
		{
			id: string;
			name: string;
			owner: string;
			phase: string | null;
			outcome: string | null;
			closed_on: string | null;
			invoiced_on: string | null;
		},
		"d"
	> = selectNextDeals(db).where("c.party_id", "is not", null).as("d");
	const entries = await db
		.selectFrom(deals)
		.leftJoin("commission_payment as p", (join) =>
			join.onRef("p.deal_id", "=", "d.id").on("p.invoiced_on", "is not", null),
		)
		.where((eb) =>
			eb.or([
				eb("d.invoiced_on", "is not", null),
				eb.and([
					eb("d.phase", "=", "closed"),
					eb("d.outcome", "is distinct from", "lost"),
				]),
			]),
		)
		.select((eb) => [
			"d.id as deal_id",
			"d.name",
			"d.owner",
			"d.phase",
			sql<null>`null`.as("lane"),
			"d.outcome",
			"d.closed_on",
			"d.invoiced_on",
			"p.id as commission_id",
			"p.amount as gross_amount",
			eb
				.case()
				.when("p.received_on", "is not", null)
				.then("received")
				.when("p.invoiced_on", "is not", null)
				.then("invoiced")
				.end()
				.as("status"),
			sql<number | null>`(select max(ch.id)::float8 from change ch
				where ch.table_name = 'commission_payment' and ch.record = jsonb_build_object('id', p.id))`.as(
				"base_version",
			),
			asText(eb.ref("p.invoiced_on")).as("commission_invoiced_on"),
			asText(eb.ref("p.received_on")).as("received_on"),
			asText(eb.ref("p.due_on")).as("due_on"),
			asText(sql`current_date`).as("as_of"),
		])
		.execute();
	return trackerAnswer(partner, entries);
}

export const invoices = new Hono<
	DatabaseEnv & { Bindings: { INVOICES_READ_SCHEMA?: string } }
>();

invoices.get("/invoices", async (c) => {
	const refused = checkFields(new URL(c.req.url).searchParams, []);
	if (refused) return refuse(c, refused);
	const partner = c.get("partner").slug;
	return c.env.INVOICES_READ_SCHEMA === "next"
		? answerNextRead(c, "read-invoice-tracker", (db) =>
				readNextInvoiceTracker(db, partner),
			)
		: answer(c, "read-invoice-tracker", (db) =>
				readInvoiceTracker(db, partner),
			);
});
