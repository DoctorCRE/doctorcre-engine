import assert from "node:assert/strict";
import { test } from "node:test";
import { checklistOf } from "./checklist.ts";
import { planOf } from "./plan.ts";

type Facts = Parameters<typeof planOf>[0];

// The lease defaults the owner approved on 2026-11-25.
const LENGTHS = {
	before_research: 7,
	representation: 7,
	requirements: 7,
	market_survey: 7,
	tour_notes: 12,
	loi_submission: 14,
	loi_grid: 21,
	business_terms: 20,
	contract_draft: 10,
	attorney_comments: 21,
	legal_review: 10,
	ti_scope: 14,
	executed_lease: 14,
	commencement_letter: 10,
	executed_comp: 7,
	expiration_recorded: 6,
	check_in_90_day: 90,
	invoice_recorded: 3,
	commission_received: 30,
};

const checklist = (finished: Record<string, string> = {}) => {
	const list = checklistOf({
		deal: {
			id: "example-deal",
			owner: "joe",
			type: "startup",
			invoiced_on: null,
		},
		lease: null,
		criticalDates: [],
		templateCurrent: true,
		commissions: [],
		requests: [],
		today: "2030-06-15",
	});
	return {
		phases: list.phases.map((phase) => ({
			...phase,
			items: phase.items.map((item) => {
				const day = finished[item.id];
				return day ? { ...item, status: "complete", finished_on: day } : item;
			}),
		})),
	};
};

// A lease in Negotiation since Jun 1 that sent its LOIs on Jun 5.
const facts = (changes: Partial<Facts> = {}): Facts => ({
	phase: "negotiation",
	outcome: null,
	checklist: checklist({
		market_survey: "2030-05-10",
		loi_submission: "2030-06-05",
	}),
	phase_spans: [
		{ phase: "research", from_on: "2030-04-01", to_on: "2030-05-01" },
		{ phase: "site_selection", from_on: "2030-05-01", to_on: "2030-06-01" },
		{ phase: "negotiation", from_on: "2030-06-01", to_on: null },
	],
	steps: [],
	critical_dates: [],
	lengths: LENGTHS,
	today: "2030-06-15",
	...changes,
});
type Plan = ReturnType<typeof planOf>;
const row = (plan: Plan, id: string) =>
	plan.rows.find(
		(r): r is Extract<Plan["rows"][number], { kind: "todo" }> =>
			r.kind === "todo" && r.id === id,
	);
const date = (kind: string, due_on: string, status = "open") => ({
	id: `example-${kind}`,
	kind,
	label: `Example ${kind}`,
	due_on,
	status,
});

test("a finished to-do runs from the later of the last finish and its phase's start to its own finish", () => {
	const plan = planOf(facts());
	assert.partialDeepStrictEqual(row(plan, "market_survey"), {
		state: "finished",
		from_on: "2030-05-01",
		to_on: "2030-05-10",
		expected_to_on: null,
	});
	assert.partialDeepStrictEqual(row(plan, "loi_submission"), {
		from_on: "2030-06-01",
		to_on: "2030-06-05",
	});
});

test("a to-do in a finished phase that never ticked is not recorded and has no days", () => {
	assert.partialDeepStrictEqual(row(planOf(facts()), "tour_notes"), {
		state: "not_recorded",
		from_on: null,
		to_on: null,
		expected_to_on: null,
	});
});

test("the to-do the deal is on counts its day from the last finish and is expected to end after its typical length", () => {
	const plan = planOf(facts());
	assert.partialDeepStrictEqual(row(plan, "loi_grid"), {
		state: "current",
		from_on: "2030-06-05",
		to_on: null,
		day: 11,
		typical_days: 21,
		expected_to_on: "2030-06-26",
	});
	const late = planOf(facts({ today: "2030-07-10" }));
	assert.equal(row(late, "loi_grid")?.expected_to_on, "2030-07-10");
});

test("to-dos ahead are expected one after another, and phases ahead follow them", () => {
	const plan = planOf(facts());
	assert.partialDeepStrictEqual(row(plan, "business_terms"), {
		state: "expected",
		from_on: null,
		expected_from_on: "2030-06-26",
		expected_to_on: "2030-07-16",
	});
	assert.partialDeepStrictEqual(row(plan, "contract_draft"), {
		expected_from_on: "2030-07-16",
		expected_to_on: "2030-07-26",
	});
	assert.deepEqual(plan.phases.slice(2, 6), [
		{
			phase: "site_selection",
			from_on: "2030-05-01",
			to_on: "2030-06-01",
			expected_from_on: null,
			expected_to_on: null,
		},
		{
			phase: "negotiation",
			from_on: "2030-06-01",
			to_on: null,
			expected_from_on: null,
			expected_to_on: "2030-07-16",
		},
		{
			phase: "legal",
			from_on: null,
			to_on: null,
			expected_from_on: "2030-07-16",
			expected_to_on: "2030-09-09",
		},
		{
			phase: "due_diligence",
			from_on: null,
			to_on: null,
			expected_from_on: "2030-09-09",
			expected_to_on: "2030-09-09",
		},
	]);
	assert.equal(plan.expected_signing_on, "2030-09-23");
	assert.equal(row(plan, "commission_received")?.expected_to_on, "2030-11-18");
});

test("arrows follow the workflow order between to-dos that have days", () => {
	const plan = planOf(facts());
	assert.deepEqual(
		plan.arrows.slice(0, 3).map(({ from, to }) => [from, to]),
		[
			["market_survey", "loi_submission"],
			["loi_submission", "loi_grid"],
			["loi_grid", "business_terms"],
		],
	);
	assert.ok(
		plan.arrows.some(
			(a) => a.from === "expiration_recorded" && a.to === "invoice_recorded",
		),
	);
	assert.ok(
		!plan.arrows.some((a) => a.from === "move_in" || a.to === "move_in"),
	);
});

test("a step runs from the day it was set to its due day under the phase it was set in, and a late one says so", () => {
	const step = (
		id: string,
		status: string,
		set_on: string,
		due_on: string,
	) => ({
		id,
		owner: "dell",
		status,
		set_on,
		due_on,
		done_on: status === "done" ? "2030-05-20" : null,
	});
	const plan = planOf(
		facts({
			steps: [
				step("late", "open", "2030-05-12", "2030-06-10"),
				step("ahead", "open", "2030-06-12", "2030-06-20"),
				step("done", "done", "2030-05-15", "2030-05-25"),
				step("cancelled", "cancelled", "2030-06-12", "2030-06-20"),
			],
		}),
	);
	assert.deepEqual(
		plan.rows.filter((r) => r.kind === "step"),
		[
			{
				kind: "step",
				id: "step:late",
				phase: "site_selection",
				owner: "dell",
				state: "late",
				from_on: "2030-05-12",
				to_on: "2030-06-10",
				done_on: null,
			},
			{
				kind: "step",
				id: "step:ahead",
				phase: "negotiation",
				owner: "dell",
				state: "open",
				from_on: "2030-06-12",
				to_on: "2030-06-20",
				done_on: null,
			},
			{
				kind: "step",
				id: "step:done",
				phase: "site_selection",
				owner: "dell",
				state: "done",
				from_on: "2030-05-15",
				to_on: "2030-05-25",
				done_on: "2030-05-20",
			},
		],
	);
});

test("only LOI expiry and lease commencement wait on a to-do, and one expected to finish too late is at risk", () => {
	const plan = planOf(
		facts({
			critical_dates: [
				date("loi_expiry", "2030-06-20", "proposed"),
				date("lease_commencement", "2030-12-01"),
				date("rent_start", "2030-07-01"),
				date("lease_end", "2035-01-01", "dropped"),
			],
		}),
	);
	assert.deepEqual(
		plan.rows.filter((r) => r.kind === "critical_date"),
		[
			{
				kind: "critical_date",
				id: "critical-date:example-loi_expiry",
				phase: "negotiation",
				label: "Example loi_expiry",
				on: "2030-06-20",
				status: "proposed",
				at_risk: true,
			},
			{
				kind: "critical_date",
				id: "critical-date:example-lease_commencement",
				phase: "closing",
				label: "Example lease_commencement",
				on: "2030-12-01",
				status: "open",
				at_risk: false,
			},
			{
				kind: "critical_date",
				id: "critical-date:example-rent_start",
				phase: null,
				label: "Example rent_start",
				on: "2030-07-01",
				status: "open",
				at_risk: false,
			},
		],
	);
	assert.deepEqual(plan.arrows.slice(-2), [
		{ from: "loi_grid", to: "critical-date:example-loi_expiry", at_risk: true },
		{
			from: "commencement_letter",
			to: "critical-date:example-lease_commencement",
			at_risk: false,
		},
	]);
	const cleared = planOf(
		facts({ critical_dates: [date("loi_expiry", "2030-06-20", "cleared")] }),
	);
	assert.equal(cleared.arrows.at(-1)?.at_risk, false);
});

test("move-in has no day until one is recorded, and the 90-day check-in follows a recorded move-in", () => {
	const plan = planOf(facts());
	assert.partialDeepStrictEqual(row(plan, "move_in"), {
		state: "undated",
		to_on: null,
		expected_to_on: null,
	});
	assert.partialDeepStrictEqual(row(plan, "check_in_90_day"), {
		state: "undated",
		expected_to_on: null,
	});
	const movedIn = planOf(
		facts({ checklist: checklist({ move_in: "2030-06-01" }) }),
	);
	assert.partialDeepStrictEqual(row(movedIn, "check_in_90_day"), {
		state: "expected",
		expected_to_on: "2030-08-30",
	});
});

test("a deal sitting more than twice the typical length on its to-do is stale and expects nothing", () => {
	const plan = planOf(facts({ today: "2030-07-20" }));
	assert.deepEqual(plan.stale, { phase: "negotiation", days: 45 });
	assert.partialDeepStrictEqual(row(plan, "loi_grid"), {
		state: "current",
		day: 46,
		expected_to_on: null,
	});
	assert.partialDeepStrictEqual(row(plan, "business_terms"), {
		state: "expected",
		expected_from_on: null,
		expected_to_on: null,
	});
	assert.equal(plan.expected_signing_on, null);
	assert.equal(plan.phases.at(-1)?.expected_to_on, null);
});

test("a deal in Prospective Client expects Research after its typical stay, or is stale after twice that", () => {
	const pending = (from_on: string | null) =>
		facts({
			phase: "pending",
			checklist: checklist(),
			phase_spans: [{ phase: "pending", from_on, to_on: null }],
		});
	const plan = planOf(pending("2030-06-12"));
	assert.equal(row(plan, "before_research"), undefined);
	assert.partialDeepStrictEqual(plan.phases[0], {
		phase: "pending",
		from_on: "2030-06-12",
		expected_to_on: "2030-06-19",
	});
	assert.partialDeepStrictEqual(row(plan, "representation"), {
		state: "expected",
		expected_from_on: "2030-06-19",
	});
	assert.deepEqual(planOf(pending("2030-05-01")).stale, {
		phase: "pending",
		days: 45,
	});
	assert.partialDeepStrictEqual(row(planOf(pending(null)), "representation"), {
		expected_from_on: "2030-06-22",
	});
});

test("a lost deal expects nothing, and a to-do without a typical length ends what can be expected", () => {
	const lost = planOf(facts({ outcome: "lost" }));
	assert.partialDeepStrictEqual(row(lost, "loi_grid"), {
		state: "not_recorded",
		expected_to_on: null,
	});
	assert.equal(lost.expected_signing_on, null);
	const { business_terms: _, ...gap } = LENGTHS;
	const broken = planOf(facts({ lengths: gap }));
	assert.equal(row(broken, "business_terms")?.expected_to_on, null);
	assert.equal(row(broken, "contract_draft")?.expected_to_on, null);
	assert.equal(broken.expected_signing_on, null);
});

test("a recorded signing day is the expected signing day", () => {
	const plan = planOf(
		facts({ checklist: checklist({ executed_lease: "2030-06-10" }) }),
	);
	assert.equal(plan.expected_signing_on, "2030-06-10");
});
