import type { Transaction } from "kysely";
import type { DB } from "../next-database.d.ts";
import { asText, type Reader } from "../reader.ts";
import { isOpenBoardDeal, selectNextDeals } from "./next-board.ts";

const labels = new Map([
	["loi_expiry", "LOI expiry"],
	["option_window", "Option notice"],
	["lease_expiration", "Lease expiration"],
]);

function kindLabel(kind: string | null) {
	if (!kind) return "Critical date";
	const words = kind.replace(/[_-]+/g, " ").trim();
	return (
		labels.get(kind) ??
		(words ? words.charAt(0).toUpperCase() + words.slice(1) : "Critical date")
	);
}

function calendarDates<Row extends { kind: string | null }>(rows: Row[]) {
	return {
		schema_version: "calendar-critical-dates.v1",
		critical_dates: rows.map((row) => ({
			...row,
			kind: kindLabel(row.kind),
			done: false,
		})),
	};
}

export async function readCalendarDates(db: Reader) {
	const rows = await db
		.selectFrom("v_open_deal_room_board as d")
		.innerJoin("v_deal_room_critical_date as cd", "cd.deal_id", "d.id")
		.select(["cd.id", "cd.deal_id", "d.name as deal_name", "cd.kind"])
		.select((eb) => asText(eb.ref("cd.due_on")).as("due_on"))
		.where("cd.status", "=", "open")
		.distinct()
		.orderBy("due_on")
		.orderBy("cd.id")
		.execute();
	return calendarDates(rows);
}

export async function readNextCalendarDates(db: Transaction<DB>) {
	const deals = db
		.selectFrom(selectNextDeals(db).as("board"))
		.where(isOpenBoardDeal);
	const rows = await db
		.selectFrom(deals.select(["id", "name"]).as("d"))
		.innerJoin("critical_date as cd", "cd.deal_id", "d.id")
		.select(["cd.id", "cd.deal_id", "d.name as deal_name", "cd.kind"])
		.select((eb) => asText(eb.ref("cd.due_on")).as("due_on"))
		.where("cd.status", "=", "open")
		.distinct()
		.orderBy("due_on")
		.orderBy("cd.id")
		.execute();
	return calendarDates(rows);
}
