import { sql, type Transaction } from "kysely";
import { Refusal } from "./answer.ts";
import { type Meeting, meetingsFromSnapshot } from "./calendar/meetings.ts";
import { readStoredAgenda } from "./calendar/next-agenda.ts";
import { criticalDateLabel } from "./deals/checklist.ts";
import { isOpenBoardDeal, selectNextDeals } from "./deals/next-board.ts";
import { stepItemId, stepOpenUrl, stepTargetFields } from "./home-inbox.ts";
import type { DB } from "./next-database.d.ts";
import { isArguments } from "./save-door.ts";

type Clock = Record<"today" | "tomorrow_start" | "now_at" | "viewer", string>;
type DealLink = Record<"id" | "name" | "open_url", string> & {
	client_name: string | null;
};
type Match = Record<"email" | "party_name", string> &
	Record<"deal_id" | "deal_name" | "client_name", string | null>;
type Reminder = Record<
	"id" | "title" | "context_label" | "due_on" | "owner",
	string
> &
	Record<
		"note" | "deal_id" | "party_id" | "call_id" | "building_deal_id",
		string | null
	> & {
		kind: "step" | "call_follow_up" | "critical_date";
		days_late: number;
		is_viewer: boolean;
		prospect: boolean;
	};

const emailsOf = (m: Meeting) =>
	[m.organizer, ...m.attendees].flatMap((p) => p.email ?? []);
const openDeals = (db: Transaction<DB>) =>
	db
		.selectFrom(selectNextDeals(db).as("board"))
		.select(["id", "name", "owner", "client_name"])
		.where(isOpenBoardDeal);
const unavailable = (reason: string) => ({
	state: "unavailable" as const,
	reason,
	observed_at: null,
	notes: [] as string[],
	items: [] as (Meeting & {
		context_label: string | null;
		open_url: string | null;
		possible_deals: DealLink[];
	})[],
	follow_up_reviews: [],
});

function unhandledSnapshot(stored: unknown) {
	if (!isArguments(stored) || !Array.isArray(stored.follow_up_reviews))
		return stored;
	const done = new Set(
		[
			...(Array.isArray(stored.dismissed) ? stored.dismissed : []),
			...(Array.isArray(stored.confirmed) ? stored.confirmed : []),
		].filter((k): k is string => typeof k === "string"),
	);
	if (done.size === 0) return stored;
	return {
		...stored,
		follow_up_reviews: stored.follow_up_reviews.filter(
			(r) => !isArguments(r) || typeof r.key !== "string" || !done.has(r.key),
		),
	};
}

async function readTodayMeetings(
	db: Transaction<DB>,
	userId: string,
	clock: Clock,
) {
	const stored = await readStoredAgenda(db, userId);
	if (stored === null)
		return unavailable(
			"No calendar snapshot has been synced from Outlook yet.",
		);
	const section = meetingsFromSnapshot(
		unhandledSnapshot(stored),
		new Date(clock.now_at),
		{ untilMs: new Date(clock.tomorrow_start).getTime() },
	);
	if (!section || section.state === "unavailable")
		return unavailable("Outlook calendar data could not be read.");
	const addresses = [...new Set(section.items.flatMap(emailsOf))];
	const matches = addresses.length
		? (
				await sql<Match>`
					with matched as (
						select distinct pe.address::text as email, p.id as party_id, p.name as party_name, true as direct
						from party_email pe join party p on p.id = pe.party_id
						where pe.address::text = any(${addresses}::text[])
							and not exists (select from app_user u where u.id = p.id)
					), scope as (
						select email, party_id, party_name, direct from matched
						union
						select m.email, c.id, c.name, false from matched m
						join party_company pc on pc.person_id = m.party_id and pc.ended_on is null
						join party c on c.id = pc.company_id
					), open_deals as (${openDeals(db)})
					select distinct s.email, s.party_name, d.id as deal_id, d.name as deal_name, d.client_name, s.direct
					from scope s left join deal_party dp on dp.party_id = s.party_id
					left join open_deals d on d.id = dp.deal_id
					order by s.email, d.name nulls last, d.id nulls last, s.direct desc, s.party_name
				`.execute(db)
			).rows
		: [];
	const items = section.items.map((meeting) => {
		const emails = new Set(emailsOf(meeting));
		const deals = new Map<string, DealLink>();
		const parties: string[] = [];
		for (const row of matches) {
			if (!emails.has(row.email)) continue;
			if (row.deal_id && row.deal_name && !deals.has(row.deal_id))
				deals.set(row.deal_id, {
					id: row.deal_id,
					name: row.deal_name,
					client_name: row.client_name,
					open_url: `/deals?deal=${row.deal_id}`,
				});
			if (!parties.includes(row.party_name)) parties.push(row.party_name);
		}
		const possible_deals = [...deals.values()].sort(
			(a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
		);
		const sole = possible_deals.length === 1 ? possible_deals[0] : null;
		const label =
			sole?.name ??
			(possible_deals.length > 1
				? possible_deals.map((d) => d.name).join(", ")
				: (parties[0] ?? null));
		return {
			...meeting,
			context_label: label,
			open_url: sole?.open_url ?? null,
			possible_deals,
		};
	});
	return {
		state: section.state,
		reason: null,
		observed_at: section.observed_at,
		notes: section.notes,
		items,
		follow_up_reviews: section.follow_up_reviews ?? [],
	};
}

async function readTodayReminders(
	db: Transaction<DB>,
	userId: string,
	today: string,
	owner: string,
) {
	const { rows } = await sql<Reminder>`
		with open_deals as (${openDeals(db)}),
		reminders as (
			select s.id, case when s.call_activity_id is null then 'step' else 'call_follow_up' end as kind,
				s.what as title, null::text as note, ${stepTargetFields(db)},
				s.due_on::text as due_on, (${today}::date - s.due_on)::int as days_late,
				u.slug as owner, s.owner_party_id = ${userId}::uuid as is_viewer,
				s.deal_id, s.party_id, s.call_activity_id as call_id
			from next_step s join app_user u on u.id = s.owner_party_id
			left join deal d on d.id = s.deal_id left join party p on p.id = s.party_id
			left join property on property.id = s.property_id
			left join home_mark m on m.user_id = s.owner_party_id and m.item_id = s.id
				and m.item_kind = case when s.call_activity_id is null then 'next_step' else 'call_follow_up' end
			where s.status = 'open' and s.due_on is not null and s.due_on <= ${today}::date
				and (s.hold_until is null or s.hold_until <= ${today}::date)
				and m.disposition is distinct from 'dropped'
				and (m.snoozed_until is null or m.snoozed_until <= now())
			union all
			select cd.id, 'critical_date', cd.kind, cd.note, null::uuid, d.name, false,
				cd.due_on::text, (${today}::date - cd.due_on)::int,
				d.owner, false, cd.deal_id, null::uuid, null::uuid
			from critical_date cd join open_deals d on d.id = cd.deal_id
			where cd.status = 'open' and cd.due_on <= ${today}::date + 14
		)
		select * from reminders ${owner === "all" ? sql`` : sql`where owner = ${owner}`}
		order by due_on, kind, id
	`.execute(db);
	const formatted = rows.map((r) => {
		const isDate = r.kind === "critical_date";
		const note = r.note?.trim();
		const label = isDate ? criticalDateLabel(r.title) : r.title;
		const late = r.days_late > 0;
		return {
			id: r.id,
			kind: r.kind,
			title: isDate && note ? `${label}: ${note}` : label,
			context_label: r.context_label,
			due_on: r.due_on,
			days_late: late ? r.days_late : null,
			late_label: late
				? `${r.days_late} ${r.days_late === 1 ? "day" : "days"} late`
				: null,
			owner: r.owner,
			deal_id: r.deal_id,
			home_item_id: r.is_viewer ? stepItemId(r) : null,
			open_url: isDate ? `/deals?deal=${r.deal_id}` : stepOpenUrl(r),
		};
	});
	return {
		state: formatted.length ? "ready" : "empty",
		late: formatted.filter((r) => r.days_late !== null),
		upcoming: formatted.filter((r) => r.days_late === null),
	} as const;
}

export async function readHomeToday(
	db: Transaction<DB>,
	userId: string,
	owner: string,
) {
	const {
		rows: [clock],
	} = await sql<Clock>`
		select (now() at time zone 'America/Chicago')::date::text as today,
			(((now() at time zone 'America/Chicago')::date + 1)::timestamp at time zone 'America/Chicago') as tomorrow_start,
			now() as now_at, (select slug from app_user where id = ${userId}::uuid) as viewer
	`.execute(db);
	if (!clock) return new Refusal(422, "unauthenticated");
	const partners = await db
		.selectFrom("app_user as u")
		.innerJoin("party as p", "p.id", "u.id")
		.select(["u.slug", "p.name"])
		.orderBy("u.slug")
		.execute();
	if (owner !== "all" && !partners.some((p) => p.slug === owner))
		return new Refusal(400, "unknown_owner");
	const meetings = await readTodayMeetings(db, userId, clock);
	const reminders = await readTodayReminders(db, userId, clock.today, owner);
	return {
		ok: true,
		schema_version: "home-today.v1",
		today: clock.today,
		viewer: clock.viewer,
		owner,
		partners,
		meetings,
		reminders,
	};
}
