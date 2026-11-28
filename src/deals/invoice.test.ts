import assert from "node:assert/strict";
import { test } from "node:test";
import { invoiceOf } from "./invoice.ts";

const facts = {
	lease_executed_on: "2025-01-10",
	closed_on: "2025-02-20",
	payments: [],
};

test("a lease deal's invoice is triggered by the signed lease, not the close", () => {
	for (const type of ["startup", "renewal"])
		assert.partialDeepStrictEqual(invoiceOf({ ...facts, type }), {
			trigger: "lease_signed",
			triggered_on: "2025-01-10",
		});
});

test("a purchase or land deal's invoice is triggered by the close", () => {
	for (const type of ["purchase", "land"])
		assert.partialDeepStrictEqual(invoiceOf({ ...facts, type }), {
			trigger: "purchase_closed",
			triggered_on: "2025-02-20",
		});
});

test("a deal of no known type names no trigger", () => {
	assert.partialDeepStrictEqual(invoiceOf({ ...facts, type: "other" }), {
		trigger: null,
		triggered_on: null,
	});
});

test("each payment is sent on its invoice day and paid on its receipt day", () => {
	const payments = [
		{ id: "first", invoiced_on: "2025-03-01", received_on: "2025-03-09" },
		{ id: "second", invoiced_on: null, received_on: null },
	];
	assert.deepEqual(invoiceOf({ ...facts, type: "lease", payments }).payments, [
		{ id: "first", sent_on: "2025-03-01", paid_on: "2025-03-09" },
		{ id: "second", sent_on: null, paid_on: null },
	]);
});
