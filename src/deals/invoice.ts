import { dealTypeOf, LEASED } from "./checklist.ts";

type InvoiceTrigger = "lease_signed" | "purchase_closed";

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
export function invoiceOf({
	type,
	lease_executed_on,
	closed_on,
	payments,
}: Facts) {
	const dealType = dealTypeOf(type);
	const trigger: InvoiceTrigger | null = !dealType
		? null
		: LEASED.includes(dealType)
			? "lease_signed"
			: "purchase_closed";
	return {
		trigger,
		triggered_on:
			trigger === "lease_signed"
				? lease_executed_on
				: trigger === "purchase_closed"
					? closed_on
					: null,
		payments: payments.map(({ id, invoiced_on, received_on }) => ({
			id,
			sent_on: invoiced_on,
			paid_on: received_on,
		})),
	};
}
