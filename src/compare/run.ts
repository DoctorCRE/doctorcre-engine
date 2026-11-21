import { WORKSPACES, type Workspace } from "../deals/board.ts";
import { UUID } from "../uuid.ts";
import {
	compareAnswers,
	isRecord,
	nextCursor,
	type ReadShape,
} from "./answers.ts";
import {
	boardShape,
	captureQueueShape,
	clientFitShape,
	detailShape,
	feedShape,
} from "./deals-shapes.ts";
import {
	activityShape,
	clientListShape,
	clientShape,
	networkShape,
	vendorListShape,
	vendorShape,
} from "./directory-shapes.ts";
import { invoicesShape } from "./invoices-shape.ts";
import {
	leadBoardShape,
	leadShape,
	quietShape,
	reasonsShape,
	territoryShape,
} from "./leads-shapes.ts";
import { findShape } from "./search-shape.ts";
import {
	meetingPrepShape,
	todayShape,
	vendorMeetingsShape,
} from "./today-shapes.ts";

export class StopRun extends Error {}

export type Ask =
	| { read: "board"; workspace: Workspace }
	| { read: "deal"; deal: string }
	| { read: "client fit"; state?: string; vertical?: string; city?: string }
	| { read: "capture queue" }
	| { read: "feed"; start?: string }
	| { read: "find"; query: string }
	| { read: "lead board" }
	| { read: "lead"; lead: string }
	| { read: "quiet follow-ups" }
	| { read: "territory"; vertical?: string; city?: string; state?: string }
	| { read: "reasons to reach out" }
	| { read: "invoices" }
	| { read: "client list" }
	| { read: "client"; client: string }
	| { read: "vendor list" }
	| { read: "vendor"; vendor: string }
	| { read: "relationships" }
	// `record` identifies the deal, client or vendor whose name is asked.
	| { read: "recent activity"; name: string; record: string; limit?: 20 }
	// With no owners, the old default queue of every owner.
	| { read: "today's reminders"; owners?: "partners" }
	| { read: "meeting prep" }
	| { read: "vendor meetings"; view: "suggested" | "research" };
type Fetch = (ask: Ask) => Promise<unknown>;
type Comparison = ReturnType<typeof compareAnswers>;
export type Outcome =
	| {
			ask: Ask;
			result: "matched" | "tie order" | "at cap" | "different";
			comparison: Comparison;
	  }
	| { ask: Ask; result: "unsettled" | "failed" };
export type Run = {
	outcomes: Outcome[];
	oldReads: number;
	engineReads: number;
	stopped: boolean;
};

function dealsOn(board: unknown) {
	if (!isRecord(board)) return [];
	return ["deals", "closed_deals", "lost_deals"].flatMap((key) => {
		const list = board[key];
		return Array.isArray(list) ? list.filter(isRecord) : [];
	});
}

function firstText(answer: unknown, list: string, field: string) {
	const rows =
		isRecord(answer) && Array.isArray(answer[list]) ? answer[list] : [];
	for (const row of rows)
		if (isRecord(row) && typeof row[field] === "string" && row[field].trim())
			return row[field];
	return undefined;
}

type Read = { shape: ReadShape; prefix: string; label?: string };
// The report prints a read as its label, or as its name when it has none.
export const READS: Record<Ask["read"], Read> = {
	board: { shape: boardShape, prefix: "board" },
	deal: { shape: detailShape, prefix: "detail", label: "deal detail" },
	"client fit": { shape: clientFitShape, prefix: "fit" },
	"capture queue": { shape: captureQueueShape, prefix: "queue" },
	feed: { shape: feedShape, prefix: "feed", label: "change feed" },
	find: { shape: findShape, prefix: "find", label: "search find" },
	"lead board": { shape: leadBoardShape, prefix: "leads" },
	lead: { shape: leadShape, prefix: "lead", label: "lead detail" },
	"quiet follow-ups": { shape: quietShape, prefix: "quiet" },
	territory: { shape: territoryShape, prefix: "territory" },
	"reasons to reach out": { shape: reasonsShape, prefix: "reasons" },
	invoices: { shape: invoicesShape, prefix: "invoices" },
	"client list": { shape: clientListShape, prefix: "clients" },
	client: { shape: clientShape, prefix: "client", label: "client detail" },
	"vendor list": { shape: vendorListShape, prefix: "vendors" },
	vendor: { shape: vendorShape, prefix: "vendor", label: "vendor detail" },
	relationships: { shape: networkShape, prefix: "network" },
	"recent activity": { shape: activityShape, prefix: "activity" },
	"today's reminders": { shape: todayShape, prefix: "today" },
	"meeting prep": { shape: meetingPrepShape, prefix: "prep" },
	"vendor meetings": { shape: vendorMeetingsShape, prefix: "meetings" },
};

// Each opened lead re-sends the whole board, so a fixed number spread over the
// board's order is opened.
const LEADS_OPENED = 25;

function leadsOn(board: unknown) {
	const leads =
		isRecord(board) && Array.isArray(board.leads) ? board.leads : [];
	const ids = leads.flatMap((lead) =>
		isRecord(lead) && typeof lead.id === "string" && UUID.test(lead.id)
			? [lead.id]
			: [],
	);
	// Picks exactly LEADS_OPENED evenly spaced IDs, or all when fewer.
	return ids.filter((_, n) => (n * LEADS_OPENED) % ids.length < LEADS_OPENED);
}

// Each find costs one old read, so the names asked stay few. The probes are
// the wildcards the old query passed through unescaped, and a blank.
const FIND_NAMES = 12;
const PROBES = ["%", "_", " "];

// The app asks recent activity after a good record read, only for a record
// with a ref and a name of at most 200 characters, both trimmed. Each name runs
// a search on both systems, so few are asked.
const ACTIVITY_NAMES = 5;
const NAME_MAX = 200;

// A list answers its first page, at most 25 rows, each a record to open.
function listed(list: unknown) {
	const rows = isRecord(list) && Array.isArray(list.rows) ? list.rows : [];
	return rows.flatMap((row) =>
		isRecord(row) && typeof row.id === "string" && UUID.test(row.id)
			? [row.id]
			: [],
	);
}

function activityName(answer: unknown) {
	const record =
		isRecord(answer) && isRecord(answer.record) ? answer.record : {};
	const name = typeof record.name === "string" ? record.name.trim() : "";
	const ref = typeof record.ref === "string" ? record.ref.trim() : "";
	return name && ref && name.length <= NAME_MAX ? name : null;
}

// A walk cut off at its page limit ends on a page that still points on.
const cutOff = (answer: unknown) =>
	isRecord(answer) &&
	Array.isArray(answer.pages) &&
	nextCursor(answer.pages.at(-1)) !== undefined;

const FEED_DAYS = 3;

// Built as the app builds its start cursor: a time and the zero ID, base64url without padding.
function feedStart(now: number) {
	const recorded_at = new Date(now - FEED_DAYS * 86_400_000).toISOString();
	return btoa(
		JSON.stringify({ recorded_at, id: "00000000-0000-0000-0000-000000000000" }),
	)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
}

export async function compareDeals(
	askEngine: Fetch,
	askOld: Fetch,
	pause: () => Promise<void>,
): Promise<Run> {
	const run: Run = {
		outcomes: [],
		oldReads: 0,
		engineReads: 0,
		stopped: false,
	};
	const queue: Ask[] = [
		...WORKSPACES.map((workspace) => ({ read: "board", workspace }) as const),
		{ read: "client fit" },
		{ read: "capture queue" },
		// The recent walk and the app's cursorless first page are separate asks.
		{ read: "feed", start: feedStart(Date.now()) },
		{ read: "feed" },
		...PROBES.map((query) => ({ read: "find", query }) as const),
		{ read: "lead board" },
		// The app's inputs: no filters, and the first page of reasons.
		{ read: "quiet follow-ups" },
		{ read: "territory" },
		{ read: "reasons to reach out" },
		{ read: "invoices" },
		{ read: "client list" },
		{ read: "vendor list" },
		{ read: "relationships" },
		{ read: "today's reminders" },
		{ read: "today's reminders", owners: "partners" },
		// Both systems read the signed-in partner's own calendar.
		{ read: "meeting prep" },
		{ read: "vendor meetings", view: "suggested" },
		{ read: "vendor meetings", view: "research" },
	];
	const queued = new Set(queue.map((ask) => JSON.stringify(ask)));
	let names = 0;
	let searchActivity = false;
	const asked = { client: 0, vendor: 0 };
	const enqueue = (ask: Ask) => {
		const key = JSON.stringify(ask);
		if (queued.has(key)) return false;
		queued.add(key);
		queue.push(ask);
		return true;
	};
	for (const [index, ask] of queue.entries()) {
		if (index > 0) await pause();
		const { shape } = READS[ask.read];
		let answers: unknown[];
		try {
			run.engineReads++;
			const first = await askEngine(ask);
			run.oldReads++;
			const old = await askOld(ask);
			run.engineReads++;
			answers = [first, old, await askEngine(ask)];
		} catch (error) {
			run.outcomes.push({ ask, result: "failed" });
			if (!(error instanceof StopRun)) continue;
			run.stopped = true;
			return run;
		}
		const [first, old, second] = answers;
		if (
			ask.read === "client fit" &&
			ask.state === undefined &&
			ask.vertical === undefined &&
			ask.city === undefined
		) {
			enqueue({
				read: "client fit",
				state: firstText(old, "profiles", "state") ?? "ZZ",
			});
			for (const field of ["vertical", "city"] as const) {
				const value = firstText(old, "profiles", field);
				if (value !== undefined)
					enqueue({ read: "client fit", [field]: value });
			}
		}
		if (ask.read === "lead board") {
			// The territory answer has no vertical, so sample it from the Leads board.
			const vertical = firstText(old, "leads", "specialty");
			if (vertical !== undefined) enqueue({ read: "territory", vertical });
		}
		if (
			ask.read === "territory" &&
			ask.vertical === undefined &&
			ask.city === undefined &&
			ask.state === undefined
		)
			for (const field of ["city", "state"] as const) {
				const value = firstText(old, "submarkets", field);
				if (value !== undefined) enqueue({ read: "territory", [field]: value });
			}

		if (ask.read === "board")
			for (const { id, client_name } of dealsOn(old)) {
				if (
					!searchActivity &&
					typeof id === "string" &&
					UUID.test(id) &&
					typeof client_name === "string" &&
					client_name.trim() &&
					client_name.trim().length <= NAME_MAX
				) {
					enqueue({
						read: "recent activity",
						name: client_name.trim(),
						record: id,
						limit: 20,
					});
					searchActivity = true;
				}
				if (typeof id === "string" && UUID.test(id))
					enqueue({ read: "deal", deal: id });
				if (
					typeof client_name === "string" &&
					names < FIND_NAMES &&
					enqueue({ read: "find", query: client_name })
				)
					names++;
			}
		if (ask.read === "lead board")
			for (const lead of leadsOn(old)) enqueue({ read: "lead", lead });
		if (ask.read === "client list")
			for (const client of listed(old)) enqueue({ read: "client", client });
		if (ask.read === "vendor list")
			for (const vendor of listed(old)) enqueue({ read: "vendor", vendor });
		if (ask.read === "client" || ask.read === "vendor") {
			const name = activityName(old);
			const record = ask.read === "client" ? ask.client : ask.vendor;
			if (
				name !== null &&
				asked[ask.read] < ACTIVITY_NAMES &&
				enqueue({ read: "recent activity", name, record })
			)
				asked[ask.read]++;
		}
		const settled = compareAnswers(first, second, shape);
		if (settled.differences.length + settled.capAmbiguous.length > 0) {
			run.outcomes.push({ ask, result: "unsettled" });
			continue;
		}
		const comparison = compareAnswers(old, first, shape);
		const result =
			comparison.differences.length > 0
				? "different"
				: comparison.capAmbiguous.length > 0 || cutOff(old)
					? "at cap"
					: comparison.tiedRowsReordered.length > 0
						? "tie order"
						: "matched";
		run.outcomes.push({ ask, result, comparison });
	}
	return run;
}

export function exitCode(run: Run): 0 | 1 | 2 {
	const results = new Set(run.outcomes.map((outcome) => outcome.result));
	if (results.has("failed")) return 2;
	return results.has("different") || results.has("unsettled") ? 1 : 0;
}
