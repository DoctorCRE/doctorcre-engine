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

// Invoiced is Closed. A checklist group still named invoice is too.
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
type TodoBase = {
	kind: "todo";
	id: string;
	phase: Phase;
	label: string;
	typical_days: number | null;
};
type TodoRow =
	| (TodoBase & {
			state: "finished";
			from_on: string | null;
			to_on: string | null;
	  })
	| (TodoBase & {
			state: "current";
			from_on: string | null;
			day: number | null;
			expected_to_on: string | null;
	  })
	| (TodoBase & {
			state: "expected";
			expected_from_on: string | null;
			expected_to_on: string | null;
	  })
	| (TodoBase & { state: "not_recorded" })
	| (TodoBase & { state: "undated" });

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
			const base = {
				kind: "todo" as const,
				id: item.id,
				phase,
				label: item.label,
				typical_days,
			};
			// A finished off-chain item sits on its own day. It must not move the next start.
			if (OFF_CHAIN.has(item.id)) {
				const moved = chain.find((entry) => entry.id === "move_in");
				const movedOn =
					item.id === "check_in_90_day" && !lost && moved?.state === "finished"
						? moved.to_on
						: null;
				if (FINISHED.has(item.status))
					chain.push({
						...base,
						state: "finished",
						from_on: item.finished_on,
						to_on: item.finished_on,
					});
				else if (movedOn)
					chain.push({
						...base,
						state: "expected",
						expected_from_on: null,
						expected_to_on: addDays(movedOn, CHECK_IN_DAYS),
					});
				else chain.push({ ...base, state: "undated" });
			} else if (FINISHED.has(item.status)) {
				const end = item.finished_on;
				const starts = [lastFinish, lastSpan(phase)?.from_on ?? null];
				chain.push({
					...base,
					state: "finished",
					from_on: end && latest(...starts.filter((day) => day && day <= end)),
					to_on: end,
				});
				lastFinish = latest(lastFinish, end);
			} else if (rank < at || lost)
				chain.push({ ...base, state: "not_recorded" });
			else if (rank === at && !onCurrent && typical_days) {
				onCurrent = true;
				const from = latest(lastFinish, lastSpan(phase)?.from_on ?? null);
				const sat = from === null ? null : daysBetween(from, today);
				if (sat !== null && sat > 2 * typical_days) {
					stale = { phase, days: sat };
					cursor = null;
				} else if (cursor)
					cursor = latest(addDays(from ?? today, typical_days), today);
				else cursor = null;
				chain.push({
					...base,
					state: "current",
					from_on: from,
					day: sat === null ? null : sat + 1,
					expected_to_on: cursor,
				});
			} else if (cursor && typical_days) {
				const from = cursor;
				cursor = addDays(from, typical_days);
				chain.push({
					...base,
					state: "expected",
					expected_from_on: from,
					expected_to_on: cursor,
				});
			} else {
				if (rank === at && !onCurrent) onCurrent = true;
				cursor = null;
				chain.push({
					...base,
					state: "expected",
					expected_from_on: null,
					expected_to_on: null,
				});
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
	const recordedOrExpectedEnd = (item: TodoRow | undefined) => {
		if (item?.state === "finished") return item.to_on;
		if (item?.state === "current" || item?.state === "expected")
			return item.expected_to_on;
		return null;
	};
	const expectedEnd = (item: TodoRow | undefined) =>
		item?.state === "current" || item?.state === "expected"
			? item.expected_to_on
			: null;
	const drawn = todos.filter(
		(row) => !OFF_CHAIN.has(row.id) && recordedOrExpectedEnd(row),
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
			const end = expectedEnd(before);
			const at_risk = Boolean(
				date.status !== "cleared" && end && end > date.due_on,
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
		expected_signing_on: recordedOrExpectedEnd(signing),
		stale,
	};
}
