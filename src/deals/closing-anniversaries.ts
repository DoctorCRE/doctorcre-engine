import { Hono } from "hono";
import type { Transaction } from "kysely";
import { answerNextRead, checkFields, refuse } from "../answer.ts";
import { isCalendarDate } from "../calendar-date.ts";
import type { DB as NextDB } from "../next-database.d.ts";
import type { DatabaseEnv } from "../reader.ts";
import { nextBoardQuery } from "./next-board.ts";
import { CLOSED_PHASES } from "./shared.ts";

const chicagoDate = new Intl.DateTimeFormat("en-CA", {
	timeZone: "America/Chicago",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
});
const millisecondsPerDay = 86_400_000;
const windowDays = 30;

function anniversaryInYear(closedOn: string, year: number) {
	const date = new Date(`${closedOn}T00:00:00Z`);
	const month = date.getUTCMonth();
	date.setUTCFullYear(year);
	// A February 29 closing falls on February 28 in a common year.
	if (date.getUTCMonth() !== month) date.setUTCDate(0);
	return date;
}

// The first anniversary on or after `from`, never before the first year.
function anniversaryFrom(closedOn: string, from: Date) {
	const closedYear = Number(closedOn.slice(0, 4));
	let year = Math.max(from.getUTCFullYear(), closedYear + 1);
	let on = anniversaryInYear(closedOn, year);
	if (on < from) on = anniversaryInYear(closedOn, ++year);
	return { on, years: year - closedYear };
}

function chicagoToday() {
	return new Date(`${chicagoDate.format(new Date())}T00:00:00Z`);
}

async function closedWonDeals(db: Transaction<NextDB>) {
	const deals = await nextBoardQuery(
		db,
		{ workspace: "all", account: null },
		"closed",
	)
		.clearSelect()
		.clearOrderBy()
		.select([
			"id as deal_id",
			"name as deal_name",
			"client_id",
			"client_name",
			"closed_on",
		])
		.where("phase", "in", CLOSED_PHASES)
		.where("outcome", "=", "won")
		.where("closed_on", "is not", null)
		.execute();
	return deals.flatMap(({ client_id, client_name, closed_on, ...deal }) =>
		client_id && client_name !== null && isCalendarDate(closed_on)
			? [{ ...deal, client_id, client_name, closed_on }]
			: [],
	);
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

export const closingAnniversaries = new Hono<DatabaseEnv>()
	.get("/closing-anniversaries", async (c): Promise<Response> => {
		const refused = checkFields(new URL(c.req.url).searchParams, []);
		if (refused) return refuse(c, refused);

		return answerNextRead(c, "read-closing-anniversaries", async (db) => {
			const today = chicagoToday();
			return (await closedWonDeals(db))
				.flatMap((deal) => {
					const { on, years } = anniversaryFrom(deal.closed_on, today);
					const days_until =
						(on.getTime() - today.getTime()) / millisecondsPerDay;
					if (days_until > windowDays) return [];
					return [{ ...deal, anniversary_on: isoDate(on), years, days_until }];
				})
				.sort(
					(a, b) =>
						a.days_until - b.days_until || a.deal_id.localeCompare(b.deal_id),
				);
		});
	})
	.get("/closing-anniversaries/next", async (c): Promise<Response> => {
		const refused = checkFields(new URL(c.req.url).searchParams, []);
		if (refused) return refuse(c, refused);

		return answerNextRead(c, "read-closing-anniversaries", async (db) => {
			const afterWindow = chicagoToday();
			afterWindow.setUTCDate(afterWindow.getUTCDate() + windowDays + 1);
			let next: string | null = null;
			for (const deal of await closedWonDeals(db)) {
				const on = isoDate(anniversaryFrom(deal.closed_on, afterWindow).on);
				if (next === null || on < next) next = on;
			}
			return { next_anniversary_on: next };
		});
	});
