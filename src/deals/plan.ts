const PHASES = [
	"pending",
	"research",
	"site_selection",
	"negotiation",
	"legal",
	"due_diligence",
	"closing",
	"closed",
] as const;
type Phase = (typeof PHASES)[number];

// The checklist's Invoice group is the Closed phase, and an invoiced deal is past Closed.
const phaseOf = (slug: string | null): Phase | null =>
	slug === "invoice" || slug === "invoiced"
		? "closed"
		: (PHASES.find((phase) => phase === slug) ?? null);
const rankOf = (phase: Phase | null) => (phase ? PHASES.indexOf(phase) : -1);

// Owner ruling on engine #1373: only these critical date kinds wait on a to-do.
const FOLLOWS = new Map([
	["loi_expiry", "loi_grid"],
	["lease_commencement", "commencement_letter"],
]);
// Prospective Client has no to-dos; its typical stay leads the chain without a row.
const BEFORE_RESEARCH = "before_research";
const OFF_CHAIN = new Set(["move_in", "check_in_90_day"]);
const CHECK_IN_DAYS = 90;
const FINISHED = new Set(["complete", "received"]);
const SHOWN_DATES = new Set(["proposed", "open", "cleared"]);

const DAY_MS = 86_400_000;
const timeOf = (day: string) => Date.parse(`${day}T00:00:00Z`);
const addDays = (day: string, days: number) =>
	new Date(timeOf(day) + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) =>
	Math.round((timeOf(to) - timeOf(from)) / DAY_MS);
const latest = (...days: (string | null)[]) =>
	days
		.filter((day) => day !== null)
		.sort()
		.at(-1) ?? null;

type Item = {
	id: string;
	label: string;
	status: string;
	finished_on: string | null;
};
type PlanFacts = {
	phase: string | null;
	outcome: string | null;
	checklist: { phases: { id: string; items: Item[] }[] };
	phase_spans: {
		phase: string;
		from_on: string | null;
		to_on: string | null;
	}[];
	steps: {
		id: string;
		owner: string | null;
		status: string | null;
		set_on: string;
		due_on: string | null;
		done_on: string | null;
	}[];
	critical_dates: {
		id: string;
		kind: string;
		label: string;
		due_on: string | null;
		status: string;
	}[];
	lengths: Record<string, number>;
	today: string;
};
type TodoRow = {
	kind: "todo";
	id: string;
	phase: Phase;
	label: string;
	state: "finished" | "current" | "expected" | "not_recorded" | "undated";
	typical_days: number | null;
	day: number | null;
	from_on: string | null;
	to_on: string | null;
	expected_from_on: string | null;
	expected_to_on: string | null;
};

export function planOf(facts: PlanFacts) {
	const { today, lengths } = facts;
	const current = phaseOf(facts.phase);
	const at = rankOf(current);
	const lost = facts.outcome === "lost";
	const lastSpan = (phase: Phase) =>
		facts.phase_spans.findLast((span) => phaseOf(span.phase) === phase);
	const items = new Map<Phase, Item[]>([
		[
			"pending",
			[{ id: BEFORE_RESEARCH, label: "", status: "", finished_on: null }],
		],
	]);
	for (const { id, items: phaseItems } of facts.checklist.phases) {
		const phase = phaseOf(id);
		if (phase)
			items.set(phase, [
				...(items.get(phase) ?? []),
				...phaseItems.filter((item) => !item.id.startsWith("critical-date:")),
			]);
	}

	// The expected end of the chain so far; null once nothing ahead can be expected.
	let cursor = current && !lost ? today : null;
	let lastFinish: string | null = null;
	let onCurrent = false;
	let stale: { phase: Phase; days: number } | null = null;
	const chain: TodoRow[] = [];
	const phases = [];
	for (const phase of PHASES) {
		const rank = rankOf(phase);
		const expected_from_on = rank > at ? cursor : null;
		for (const item of items.get(phase) ?? []) {
			const typical_days = lengths[item.id] ?? null;
			const row = (fields: Partial<TodoRow> & Pick<TodoRow, "state">) =>
				chain.push({
					kind: "todo",
					id: item.id,
					phase,
					label: item.label,
					typical_days,
					day: null,
					from_on: null,
					to_on: null,
					expected_from_on: null,
					expected_to_on: null,
					...fields,
				});
			if (FINISHED.has(item.status)) {
				const end = item.finished_on;
				const starts = [lastFinish, lastSpan(phase)?.from_on ?? null];
				row({
					state: "finished",
					from_on: end && latest(...starts.filter((day) => day && day <= end)),
					to_on: end,
				});
				lastFinish = latest(lastFinish, end);
			} else if (OFF_CHAIN.has(item.id)) {
				const movedIn =
					item.id === "check_in_90_day" && !lost
						? chain.find((r) => r.id === "move_in")?.to_on
						: null;
				row(
					movedIn
						? {
								state: "expected",
								expected_to_on: addDays(movedIn, CHECK_IN_DAYS),
							}
						: { state: "undated" },
				);
			} else if (rank < at || lost) row({ state: "not_recorded" });
			else if (rank === at && !onCurrent) {
				onCurrent = true;
				const from = latest(lastFinish, lastSpan(phase)?.from_on ?? null);
				const sat = from === null ? null : daysBetween(from, today);
				if (typical_days && sat !== null && sat > 2 * typical_days) {
					stale = { phase, days: sat };
					cursor = null;
				} else if (cursor && typical_days)
					cursor = latest(addDays(from ?? today, typical_days), today);
				else cursor = null;
				row({
					state: "current",
					from_on: from,
					day: sat === null ? null : sat + 1,
					expected_to_on: cursor,
				});
			} else if (cursor && typical_days) {
				const from = cursor;
				cursor = addDays(from, typical_days);
				row({
					state: "expected",
					expected_from_on: from,
					expected_to_on: cursor,
				});
			} else {
				cursor = null;
				row({ state: "expected" });
			}
		}
		const span = rank <= at ? lastSpan(phase) : undefined;
		phases.push({
			phase,
			from_on: span?.from_on ?? null,
			to_on: span?.to_on ?? null,
			expected_from_on,
			expected_to_on: rank >= at ? cursor : null,
		});
	}

	const todos = chain.filter((row) => row.id !== BEFORE_RESEARCH);
	const todo = (id: string) => todos.find((row) => row.id === id);
	const drawn = todos.filter(
		(row) => !OFF_CHAIN.has(row.id) && (row.to_on || row.expected_to_on),
	);
	const arrows = drawn.flatMap((row, i) => {
		const next = drawn[i + 1];
		return next ? [{ from: row.id, to: next.id, at_risk: false }] : [];
	});
	const dates = facts.critical_dates
		.flatMap(({ due_on, ...date }) =>
			due_on && SHOWN_DATES.has(date.status) ? [{ ...date, due_on }] : [],
		)
		.map((date) => {
			const before = todo(FOLLOWS.get(date.kind) ?? "");
			const at_risk = Boolean(
				date.status !== "cleared" &&
					before?.expected_to_on &&
					before.expected_to_on > date.due_on,
			);
			const id = `critical-date:${date.id}`;
			if (before) arrows.push({ from: before.id, to: id, at_risk });
			return {
				kind: "critical_date" as const,
				id,
				phase: before?.phase ?? null,
				label: date.label,
				on: date.due_on,
				status: date.status,
				at_risk,
			};
		});
	const steps = facts.steps
		.filter((step) => step.status === "open" || step.status === "done")
		.map((step) => {
			const span =
				facts.phase_spans.findLast(
					(s) => s.from_on !== null && s.from_on <= step.set_on,
				) ?? facts.phase_spans[0];
			const late =
				step.status === "open" && step.due_on !== null && step.due_on < today;
			return {
				kind: "step" as const,
				id: `step:${step.id}`,
				phase: phaseOf(span?.phase ?? null),
				owner: step.owner,
				state: step.status === "done" ? "done" : late ? "late" : "open",
				from_on: step.set_on,
				to_on: step.due_on,
				done_on: step.done_on,
			};
		});
	const signing = todo("executed_lease");
	return {
		phases,
		rows: [...todos, ...steps, ...dates],
		arrows,
		expected_signing_on: signing?.to_on ?? signing?.expected_to_on ?? null,
		stale,
	};
}
