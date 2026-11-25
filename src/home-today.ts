import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { answerNextRead, checkFields, Refusal, refuse } from "./answer.ts";
import { type Meeting, meetingsFromSnapshot } from "./calendar/meetings.ts";
import { readStoredAgenda } from "./calendar/next-agenda.ts";
import { PARTNERS } from "./clients/read.ts";
import { isOpenBoardDeal, selectNextDeals } from "./deals/next-board.ts";
import { readCompletionReviews } from "./home-inbox-reviews-updates.ts";
import {
	datedPartnerSteps,
	type HomeStepTarget,
	homeDayAt,
	homeStepShown,
	lateLabel,
	stepCopy,
	stepItemId,
	stepOpenUrl,
	stepTargetFields,
} from "./home-steps.ts";
import type { DB } from "./next-database.d.ts";
import type { DatabaseEnv } from "./reader.ts";
import { isArguments } from "./save-door.ts";

type Clock = Record<
	"today" | "today_start" | "tomorrow_start" | "now_at" | "viewer",
	string
> & { is_partner: boolean | null; partners: { slug: string; name: string }[] };
type Match = Record<"email" | "party_name", string> &
	Record<"deal_id" | "deal_name" | "client_name", string | null>;
type StepRow = Parameters<typeof stepCopy>[0] &
	HomeStepTarget &
	Record<"id" | "due_on" | "owner", string> &
	Record<"party_id" | "call_id" | "context_label", string | null> & {
		call_follow_up: boolean;
		days_late: number | null;
		is_viewer: boolean;
		prospect: boolean;
		deal_ended: boolean;
	};

const emailsOf = (m: Meeting) =>
	[m.organizer, ...m.attendees].flatMap((p) => p.email ?? []);
export const noMeetings = (reason: string) => ({
	state: "unavailable" as const,
	reason,
	observed_at: null,
	meetings_may_be_missing: false,
	notes: [] as string[],
	items: [] as never[],
	follow_up_reviews: [] as never[],
});

export async function isolate<T, F>(
	db: Transaction<DB>,
	read: () => Promise<T>,
	fallback: F,
): Promise<T | F> {
	await sql`savepoint today_section`.execute(db);
	try {
		return await read();
	} catch {
		await sql`rollback to savepoint today_section`.execute(db);
		return fallback;
	} finally {
		await sql`release savepoint today_section`.execute(db).catch(() => {});
	}
}

function handledReviewKeys(stored: unknown) {
	const keys = isArguments(stored) ? [stored.dismissed, stored.confirmed] : [];
	return new Set(
		keys.flatMap((value) =>
			Array.isArray(value)
				? value.filter((key): key is string => typeof key === "string")
				: [],
		),
	);
}

// One partner's stored Outlook occurrences that overlap [from_at, until_at).
export async function readMeetings(
	db: Transaction<DB>,
	userId: string,
	clock: Record<"today" | "now_at" | "from_at" | "until_at", string>,
	reviews: boolean,
) {
	const stored = await readStoredAgenda(db, userId);
	if (stored === null)
		return noMeetings("No calendar snapshot has been synced from Outlook yet.");
	const section = meetingsFromSnapshot(stored, new Date(clock.now_at), {
		fromMs: Date.parse(clock.from_at),
		untilMs: Date.parse(clock.until_at),
		handledReviewKeys: handledReviewKeys(stored),
		reviews,
	});
	if (!section || section.state === "unavailable")
		return noMeetings("Outlook calendar data could not be read.");
	const addresses = [...new Set(section.items.flatMap(emailsOf))];
	const openDeals = db
		.selectFrom(selectNextDeals(db, clock.today).as("board"))
		.select(["id", "name", "client_name"])
		.where(isOpenBoardDeal);
	const matches = addresses.length
		? (
				await sql<Match>`
					with matched as (
						select distinct pe.address::text as email, p.id as party_id, p.name as party_name, true as direct
						from party_email pe join party p on p.id = pe.party_id
						where pe.address::text = any(${addresses}::text[]) and not exists (select from app_user u where u.id = p.id)
					), scope as (
						select email, party_id, party_name, direct from matched
						union select m.email, c.id, c.name, false from matched m
						join party_company pc on pc.person_id = m.party_id and pc.ended_on is null
						join party c on c.id = pc.company_id
					), open_deals as (${openDeals})
					select distinct s.email, s.party_name, d.id as deal_id, d.name as deal_name, d.client_name, s.direct
					from scope s left join deal_party dp on dp.party_id = s.party_id left join open_deals d on d.id = dp.deal_id
					order by d.name nulls last, d.id nulls last, s.direct desc, s.party_name
				`.execute(db)
			).rows
		: [];
	const items = section.items.map((meeting) => {
		const emails = new Set(emailsOf(meeting));
		const rows = matches.filter((r) => emails.has(r.email));
		const seen = new Set<string>();
		const possible_deals = rows.flatMap((r) => {
			if (!r.deal_id || !r.deal_name || seen.has(r.deal_id)) return [];
			seen.add(r.deal_id);
			return [
				{
					id: r.deal_id,
					name: r.deal_name,
					client_name: r.client_name,
					open_url: `/deals?deal=${r.deal_id}`,
				},
			];
		});
		return {
			...meeting,
			context_label: possible_deals.length
				? possible_deals.map((d) => d.name).join(", ")
				: (rows[0]?.party_name ?? null),
			open_url:
				possible_deals.length === 1
					? (possible_deals[0]?.open_url ?? null)
					: null,
			possible_deals,
		};
	});
	const warnings = isArguments(stored) ? stored.warnings : undefined;
	return {
		state: section.state,
		reason: null,
		observed_at: section.observed_at,
		meetings_may_be_missing:
			Array.isArray(warnings) &&
			warnings.some(
				(warning) => isArguments(warning) && warning.code === "undecoded",
			),
		notes: section.notes,
		items,
		follow_up_reviews: section.follow_up_reviews ?? [],
	};
}

async function readTodayReminders(
	db: Transaction<DB>,
	userId: string,
	{ today, now_at }: Clock,
	owner: string,
) {
	const openDeals = db
		.selectFrom(selectNextDeals(db, today).as("board"))
		.select("id")
		.where(isOpenBoardDeal);
	const requestDay = sql<string>`${today}::date`;
	const reminders = sql`
		select s.id, s.what, s.item_title, s.property_id, ${stepTargetFields(db, requestDay)}, s.due_on::text as due_on,
			case when s.due_on < ${requestDay} then (${requestDay} - s.due_on)::int end as days_late,
			u.slug as owner, s.owner_party_id = ${userId}::uuid as is_viewer, s.deal_id, s.party_id,
			s.call_activity_id is not null as call_follow_up,
			(select a.id from activity a where a.id = s.call_activity_id) as call_id,
			s.deal_id is not null and not exists (
				select from (${openDeals}) as open_deal where open_deal.id = s.deal_id
			) as deal_ended
		${datedPartnerSteps(sql`${now_at}::timestamptz`)} and s.due_on <= ${requestDay}
			${owner === "all" ? sql`` : sql`and u.slug = ${owner}`}
		`;
	const { rows } = await sql<StepRow>`
		select * from (${reminders}) as steps
		where not call_follow_up or is_viewer or call_id is not null
		order by due_on::date, not call_follow_up, id
	`.execute(db);
	const shown = rows.filter(homeStepShown);
	const viewerSteps = shown.filter((r) => r.is_viewer).map((r) => r.id);
	const reviews = viewerSteps.length
		? await readCompletionReviews(db, viewerSteps)
		: null;
	const list = shown.map((r) => {
		const review = reviews?.get(r.id);
		const { title, instruction } = stepCopy(r);
		return {
			id: r.id,
			kind: r.call_follow_up ? ("call_follow_up" as const) : ("step" as const),
			title: review?.title ?? title,
			why: review?.why ?? instruction,
			context_label: r.context_label,
			due_on: r.due_on,
			days_late: r.days_late,
			late_label: r.days_late ? lateLabel(r.days_late) : null,
			owner: r.owner,
			deal_id: r.deal_id,
			...(r.deal_ended && { deal_ended: true as const }),
			home_item_id: r.is_viewer ? stepItemId(r) : null,
			open_url: stepOpenUrl(r),
		};
	});
	return {
		state: list.length ? ("ready" as const) : ("empty" as const),
		reason: null,
		late: list.filter((r) => r.days_late !== null),
		upcoming: list.filter((r) => r.days_late === null),
	};
}

async function readHomeToday(
	db: Transaction<DB>,
	userId: string,
	owner: string,
	now: string,
) {
	const [clock] = (
		await sql<Clock>`
			select central.day::text as today,
				(central.day::timestamp at time zone 'America/Chicago') as today_start,
				((central.day + 1)::timestamp at time zone 'America/Chicago') as tomorrow_start,
				request_time.now_at, u.slug as viewer, u.is_account_partner as is_partner,
				coalesce((select jsonb_agg(jsonb_build_object('slug', au.slug, 'name', p.name) order by au.slug)
					from app_user au join party p on p.id = au.id where au.is_account_partner), '[]') as partners
			from app_user u
			cross join (select ${now}::timestamptz as now_at) request_time
			cross join lateral (select ${homeDayAt(sql`request_time.now_at`)} as day) central
			where u.id = ${userId}::uuid
		`.execute(db)
	).rows;
	if (!clock?.is_partner) return new Refusal(403, "AUTHORIZATION_REFUSED");
	const meetings = await isolate(
		db,
		() =>
			readMeetings(
				db,
				userId,
				{
					...clock,
					from_at: clock.today_start,
					until_at: clock.tomorrow_start,
				},
				true,
			),
		noMeetings("Today's meetings could not be loaded."),
	);
	const reminders = await isolate(
		db,
		() => readTodayReminders(db, userId, clock, owner),
		{
			state: "unavailable" as const,
			reason: "Today's reminders could not be loaded.",
			late: [],
			upcoming: [],
		},
	);
	return {
		ok: true,
		schema_version: "home-today.v1",
		today: clock.today,
		viewer: clock.viewer,
		owner,
		partners: clock.partners,
		meetings,
		reminders,
	};
}

export const homeToday = new Hono<
	DatabaseEnv & { Bindings: { HOME_INBOX_READ_SCHEMA?: string } }
>().get("/home/today", (c) => {
	if (c.env.HOME_INBOX_READ_SCHEMA !== "next") return c.notFound();
	const params = new URL(c.req.url).searchParams;
	const refused = checkFields(params, ["owner"]);
	if (refused) return refuse(c, refused);
	const owners = params.getAll("owner");
	const owner = owners[0] ?? "all";
	if (owners.length > 1 || !owner)
		return refuse(
			c,
			new Refusal(400, "invalid_field_value", { fields: ["owner"] }),
		);
	if (owner !== "all" && !PARTNERS.some((p) => p === owner))
		return refuse(c, new Refusal(400, "unknown_owner"));
	const now = new Date().toISOString();
	return answerNextRead(c, "read-home-today-v1", (db, userId) =>
		readHomeToday(db, userId, owner, now),
	);
});
