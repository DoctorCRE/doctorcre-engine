import { sql, type Transaction } from "kysely";
import { Refusal } from "../answer.ts";
import {
	datedPartnerSteps,
	type HomeStepTarget,
	homeDayAt,
	homeStepShown,
	stepCopy,
	stepRecordUrl,
	stepTargetFields,
} from "../home-steps.ts";
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
		.select([
			"cd.id",
			"cd.deal_id",
			"d.name as deal_name",
			"d.owner",
			"cd.kind",
		])
		.select((eb) => asText(eb.ref("cd.due_on")).as("due_on"))
		.where("cd.status", "=", "open")
		.distinct()
		.orderBy("due_on")
		.orderBy("cd.id")
		.execute();
	return calendarDates(rows);
}

export async function readNextCalendarDates(
	db: Transaction<DB>,
	viewerId: string,
	now = new Date().toISOString(),
) {
	const viewer = await db
		.selectFrom("app_user")
		.select("is_account_partner")
		.select(homeDayAt(sql`${now}::timestamptz`).as("today"))
		.where("id", "=", viewerId)
		.executeTakeFirst();
	if (!viewer?.is_account_partner)
		return new Refusal(403, "AUTHORIZATION_REFUSED");
	const deals = db
		.selectFrom(selectNextDeals(db).as("board"))
		.where(isOpenBoardDeal);
	const rows = await db
		.selectFrom(deals.select(["id", "name", "owner"]).as("d"))
		.innerJoin("critical_date as cd", "cd.deal_id", "d.id")
		.select([
			"cd.id",
			"cd.deal_id",
			"d.name as deal_name",
			"d.owner",
			"cd.kind",
		])
		.select((eb) => asText(eb.ref("cd.due_on")).as("due_on"))
		.where("cd.status", "=", "open")
		.distinct()
		.orderBy("due_on")
		.orderBy("cd.id")
		.execute();
	return {
		...calendarDates(rows),
		next_steps: await readCalendarSteps(db, now),
	};
}

type CalendarStep = Parameters<typeof stepRecordUrl>[0] &
	HomeStepTarget & {
		what: string;
		context_label: string;
		item_title: string | null;
		owner: string;
		due_on: string;
		display_on: string;
		days_late: number;
	};

async function readCalendarSteps(db: Transaction<DB>, now: string) {
	const at = sql`${now}::timestamptz`;
	const today = homeDayAt(at);
	const { rows } = await sql<CalendarStep>`
		select s.id, s.what, s.item_title, u.slug as owner, s.deal_id, s.party_id, s.property_id,
			${stepTargetFields(db, today)}, s.due_on::text as due_on,
			greatest(s.due_on, ${today})::text as display_on,
			greatest(${today} - s.due_on, 0) as days_late
		${datedPartnerSteps(at)}
		order by s.due_on, s.id
	`.execute(db);
	return rows.filter(homeStepShown).map((step) => {
		const { title, instruction } = stepCopy(step);
		return {
			id: step.id,
			what: title,
			why: instruction,
			owner: step.owner,
			record_label: step.context_label,
			due_on: step.due_on,
			display_on: step.display_on,
			days_late: step.days_late,
			open_url: stepRecordUrl(step),
		};
	});
}
