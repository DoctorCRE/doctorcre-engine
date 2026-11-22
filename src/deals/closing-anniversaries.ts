import { Hono } from "hono";
import { answerNextRead, checkFields, refuse } from "../answer.ts";
import { isCalendarDate } from "../calendar-date.ts";
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

function anniversaryInYear(closedOn: string, year: number) {
	const date = new Date(`${closedOn}T00:00:00Z`);
	const month = date.getUTCMonth();
	date.setUTCFullYear(year);
	// February 29 rolls to March 1 in a common year.
	if (date.getUTCMonth() !== month) date.setUTCDate(0);
	return date;
}

export const closingAnniversaries = new Hono<DatabaseEnv>().get(
	"/closing-anniversaries",
	async (c): Promise<Response> => {
		const refused = checkFields(new URL(c.req.url).searchParams, []);
		if (refused) return refuse(c, refused);

		return answerNextRead(c, "read-closing-anniversaries", async (db) => {
			const today = new Date(`${chicagoDate.format(new Date())}T00:00:00Z`);
			const year = today.getUTCFullYear();
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

			return deals
				.flatMap(({ client_id, client_name, closed_on, ...deal }) => {
					if (!client_id || client_name === null || !isCalendarDate(closed_on))
						return [];

					const closedYear = Number(closed_on.slice(0, 4));
					let anniversaryYear = Math.max(year, closedYear + 1);
					let anniversary = anniversaryInYear(closed_on, anniversaryYear);
					if (anniversary < today) {
						anniversaryYear += 1;
						anniversary = anniversaryInYear(closed_on, anniversaryYear);
					}
					const days_until =
						(anniversary.getTime() - today.getTime()) / millisecondsPerDay;
					if (days_until > 30) return [];
					return [
						{
							...deal,
							client_id,
							client_name,
							closed_on,
							anniversary_on: anniversary.toISOString().slice(0, 10),
							years: anniversaryYear - closedYear,
							days_until,
						},
					];
				})
				.sort(
					(a, b) =>
						a.days_until - b.days_until || a.deal_id.localeCompare(b.deal_id),
				);
		});
	},
);
