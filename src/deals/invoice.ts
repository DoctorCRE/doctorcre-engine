import { type DealType, dealTypeOf } from "./checklist.ts";

const LEASE_SIGNED = {
	trigger: "lease_signed",
	fact: "lease_executed_on",
} as const;
const PURCHASE_CLOSED = {
	trigger: "purchase_closed",
	fact: "closed_on",
} as const;
const INVOICE_OF_TYPE = {
	lease: LEASE_SIGNED,
	renewal: LEASE_SIGNED,
	purchase: PURCHASE_CLOSED,
	land: PURCHASE_CLOSED,
} satisfies Record<
	DealType,
	{ trigger: string; fact: "lease_executed_on" | "closed_on" }
>;

type Facts = {
	type: string | null;
	lease_executed_on: string | null;
	closed_on: string | null;
	payments: {
		id: string;
		invoiced_on: string | null;
		received_on: string | null;
	}[];
};

// Triggered is read from saved facts, never stored: a lease deal's signed lease, or an owned deal's close.
export function invoiceOf({ type, payments, ...facts }: Facts) {
	const dealType = dealTypeOf(type);
	const invoice = dealType ? INVOICE_OF_TYPE[dealType] : null;
	return {
		trigger: invoice?.trigger ?? null,
		triggered_on: invoice ? facts[invoice.fact] : null,
		payments: payments.map(({ id, invoiced_on, received_on }) => ({
			id,
			sent_on: invoiced_on,
			paid_on: received_on,
		})),
	};
}
