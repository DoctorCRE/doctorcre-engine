import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { answerNextRead, checkFields, Refusal, refuse } from "../answer.ts";
import { isCalendarDate } from "../calendar-date.ts";
import { isOpenBoardDeal, selectNextDeals } from "../deals/next-board.ts";
import { homeDayAt } from "../home-steps.ts";
import { isolate, noMeetings, readMeetings } from "../home-today.ts";
import type { DB } from "../next-database.d.ts";
import type { DatabaseEnv } from "../reader.ts";

// Six weeks covers a whole month grid.
const MAX_DAYS = 42;
const DAY_MS = 86_400_000;

type Range = { from: string; to: string };
type Clock = Record<"today" | "from_at" | "until_at", string> & {
	is_partner: boolean | null;
	partners: { id: string; slug: string; name: string }[];
};

async function readCalendarMeetings(
	db: Transaction<DB>,
	userId: string,
	{ from, to }: Range,
	now_at: string,
) {
	const [clock] = (
		await sql<Clock>`
			select ${homeDayAt(sql`${now_at}::timestamptz`)}::text as today,
				(${from}::date::timestamp at time zone 'America/Chicago') as from_at,
				((${to}::date + 1)::timestamp at time zone 'America/Chicago') as until_at,
				u.is_account_partner as is_partner,
				coalesce((select jsonb_agg(jsonb_build_object('id', au.id, 'slug', au.slug, 'name', p.name) order by au.slug)
					from app_user au join party p on p.id = au.id where au.is_account_partner), '[]') as partners
			from app_user u where u.id = ${userId}::uuid
		`.execute(db)
	).rows;
	if (!clock?.is_partner) return new Refusal(403, "AUTHORIZATION_REFUSED");
	const window = {
		today: clock.today,
		now_at,
		from_at: new Date(clock.from_at).toISOString(),
		until_at: new Date(clock.until_at).toISOString(),
	};
	// Both partners see every meeting (decision 210).
	const meetings = [];
	for (const partner of clock.partners) {
		const { follow_up_reviews: _, ...section } = await isolate(
			db,
			() => readMeetings(db, partner.id, window, false),
			noMeetings(`${partner.name}'s meetings could not be loaded.`),
		);
		meetings.push({ partner: partner.slug, name: partner.name, ...section });
	}
	const tours = await isolate(
		db,
		() => readPlannedTours(db, clock.today, { from, to }),
		{
			state: "unavailable" as const,
			reason: "Planned tours could not be loaded.",
			items: [],
		},
	);
	return {
		ok: true,
		schema_version: "calendar-meetings.v1",
		from,
		to,
		meetings,
		tours,
	};
}

async function readPlannedTours(
	db: Transaction<DB>,
	today: string,
	{ from, to }: Range,
) {
	const items = await db
		.selectFrom("tour_plan as t")
		.innerJoin(
			db
				.selectFrom(selectNextDeals(db, today).as("board"))
				.select(["id", "name", "owner"])
				.where(isOpenBoardDeal)
				.as("d"),
			"d.id",
			"t.deal_id",
		)
		.select([
			"t.id",
			"t.deal_id",
			"d.name as deal_name",
			"d.owner",
			sql<string>`t.planned_on::text`.as("planned_on"),
			sql<number>`(select count(*)::int from tour_stop s where s.tour_plan_id = t.id)`.as(
				"stop_count",
			),
			sql<string>`'/deals?deal=' || t.deal_id`.as("open_url"),
		])
		.where("t.completed_activity_id", "is", null)
		.where("t.cancelled_at", "is", null)
		.where(sql<boolean>`t.planned_on between ${from}::date and ${to}::date`)
		.orderBy("t.planned_on")
		.orderBy("d.name")
		.orderBy("t.id")
		.execute();
	return {
		state: items.length ? ("ready" as const) : ("empty" as const),
		reason: null,
		items,
	};
}

function checkRange(params: URLSearchParams): Range | Refusal {
	const refused = checkFields(params, ["from", "to"]);
	if (refused) return refused;
	const [from, ...moreFrom] = params.getAll("from");
	const [to, ...moreTo] = params.getAll("to");
	const bad = [
		...(isCalendarDate(from) && !moreFrom.length ? [] : ["from"]),
		...(isCalendarDate(to) && !moreTo.length ? [] : ["to"]),
	];
	if (bad.length || !from || !to)
		return new Refusal(400, "invalid_field_value", { fields: bad });
	const days = (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;
	if (days < 1 || days > MAX_DAYS)
		return new Refusal(400, "invalid_range", { max_days: MAX_DAYS });
	return { from, to };
}

export const calendarMeetings = new Hono<
	DatabaseEnv & { Bindings: { HOME_INBOX_READ_SCHEMA?: string } }
>().get("/calendar/meetings", (c) => {
	if (c.env.HOME_INBOX_READ_SCHEMA !== "next") return c.notFound();
	const range = checkRange(new URL(c.req.url).searchParams);
	if (range instanceof Refusal) return refuse(c, range);
	const now = new Date().toISOString();
	return answerNextRead(c, "read-calendar-meetings-v1", (db, userId) =>
		readCalendarMeetings(db, userId, range, now),
	);
});
