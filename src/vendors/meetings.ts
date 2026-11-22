import { sql, type Transaction } from "kysely";
import {
	type Meeting,
	meetingsFromSnapshot,
	UNAVAILABLE,
} from "../calendar/meetings.ts";
import { readStoredAgenda } from "../calendar/next-agenda.ts";
import { scheduling } from "../calendar/scheduling.ts";
import { attempt } from "../calendar/snapshot.ts";
import type { DB } from "../next-database.d.ts";
import { UUID } from "../uuid.ts";
import { nextVendorContacts } from "./people.ts";
import {
	nextRef,
	nextTerritory,
	nextVendorCategory,
	nextVendorContact,
} from "./read.ts";

export const VIEWS = ["suggested", "research"] as const;
type View = (typeof VIEWS)[number];
export type MeetingsQuery = {
	view: View;
	q: string;
	limit: number;
	after: [string, string];
};
type Candidate = {
	vendor_id: string;
	contact: { id: string; email: string | null } | null;
};

const CURSOR_VERSION = 2;
const ZERO = "00000000-0000-0000-0000-000000000000";

const company = sql`coalesce(c.company, case when p.kind = 'company'
	then jsonb_build_object('id', p.id, 'name', p.name) end)`;

const restricted = sql`exists(select from active_do_not_contact
	where party_id in (p.id, c.id, (${company} ->> 'id')::uuid))
	or exists(select from party_role avoided
	where avoided.party_id in (p.id, c.id, (${company} ->> 'id')::uuid)
	and avoided.role = 'vendor' and avoided.disposition = 'avoid')`;

const missing = sql`array_remove(array[
	case when nullif(btrim(c.name), '') is null then 'named_contact' end,
	case when nullif(btrim(${company} ->> 'name'), '') is null then 'company' end,
	case when cat.slug is null then 'category' end,
	case when pr.disposition is not null then 'workable_vendor' end,
	case when pr.offers is null then 'meeting_reason' end,
	'verified_office',
	case when ${restricted} then 'contact_permission' end], null)`;

function candidates(db: Transaction<DB>, { q, limit, after }: MeetingsQuery) {
	const searched = q
		? sql`where strpos(lower(searched), lower(${q})) > 0`
		: sql``;
	return sql<{ total: number; items: Candidate[] }>`with candidate as (
		select p.id as vendor_id, coalesce(c.id, ${ZERO}::uuid) as contact_key,
			jsonb_build_object('vendor_id', p.id, 'ref', vendor.ref, 'party_id', p.id,
				'company', ${company},
				'contact', case when c.id is not null then ${nextVendorContact} end,
				'office', null, 'research', jsonb_build_object('status', 'not_researched',
					'finding_id', null, 'observed_at', null, 'expires_on', null),
				'category', cat.slug, 'category_label', cat.label,
				'service_coverage', vendor.territory, 'reason', pr.offers,
				'missing', ${missing}) as item,
			concat_ws(' ', vendor.ref, c.name, ${company} ->> 'name', cat.slug, cat.label,
				vendor.territory, c.city) as searched
		from party_role pr
		join party p on p.id = pr.party_id
		cross join lateral (select ${nextRef} as ref, ${nextTerritory} as territory) vendor
		left join lateral ${nextVendorCategory} cat on true
		left join lateral ${nextVendorContacts} c on true
		where pr.role = 'vendor'
	), matching as (
		select * from candidate ${searched}
	)
	select (select count(*)::int from matching) as total,
		coalesce(jsonb_agg(item order by vendor_id, contact_key), '[]') as items
	from (select * from matching
		where (vendor_id, contact_key) > (${after[0]}::uuid, ${after[1]}::uuid)
		order by vendor_id, contact_key limit ${limit + 1}) page`.execute(db);
}

const isId = (id: unknown): id is string =>
	typeof id === "string" && UUID.test(id);

// Where a page starts: the first, or after the row a cursor for the same
// view and search names.
export function pageAfter(
	cursor: string | undefined,
	view: View,
	q: string,
): MeetingsQuery["after"] | null {
	if (cursor === undefined) return [ZERO, ZERO];
	if (!cursor || cursor.length > 2000) return null;
	try {
		const token: Partial<Record<"v" | "view" | "q" | "after", unknown>> | null =
			JSON.parse(decodeURIComponent(atob(cursor)));
		const after = token?.after;
		const valid =
			token?.v === CURSOR_VERSION && token.view === view && token.q === q;
		return valid &&
			Array.isArray(after) &&
			after.length === 2 &&
			isId(after[0]) &&
			isId(after[1])
			? [after[0], after[1]]
			: null;
	} catch {
		return null;
	}
}

async function calendarFor(db: Transaction<DB>, userId: string, now: Date) {
	const snapshot = await attempt(db, () => readStoredAgenda(db, userId));
	const section = meetingsFromSnapshot(snapshot, now) ?? UNAVAILABLE;
	const { items, ...calendar } = section;
	const planning = scheduling(snapshot, section, now);
	return { meetings: items, calendar: { ...calendar, scheduling: planning } };
}

// A person's meetings are those their email attends or organizes.
const attending = (meetings: readonly Meeting[], email: string | undefined) =>
	email
		? meetings.filter((meeting) =>
				[meeting.organizer, ...meeting.attendees].some(
					(p) => p.email === email,
				),
			)
		: [];

export async function readVendorMeetings(
	db: Transaction<DB>,
	userId: string,
	query: MeetingsQuery,
) {
	const { view, q, limit } = query;
	const now = new Date();
	const page =
		view === "suggested"
			? { total: 0, items: [] }
			: (await attempt(db, () => candidates(db, query)))?.rows[0];
	if (!page) return null;
	const { meetings, calendar } = await calendarFor(db, userId, now);
	const items = page.items.slice(0, limit).map((item) => ({
		...item,
		possible_meetings: attending(
			meetings,
			item.contact?.email?.trim().toLowerCase(),
		),
	}));
	const last = items.at(-1);
	const has_more = page.items.length > limit;
	const next = last && [last.vendor_id, last.contact?.id || ZERO];
	return {
		schema: "vendor-meetings.v1",
		view,
		total: page.total,
		items,
		has_more,
		calendar,
		next_cursor:
			has_more && next
				? btoa(
						encodeURIComponent(
							JSON.stringify({ v: CURSOR_VERSION, view, q, after: next }),
						),
					)
				: null,
		consistency: "live_keyset; restart after record changes",
	};
}
