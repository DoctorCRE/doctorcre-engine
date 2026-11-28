import { type Expression, sql, type Transaction } from "kysely";
import {
	jsonArrayFrom,
	jsonBuildObject,
	jsonObjectFrom,
} from "kysely/helpers/postgres";
import { filingReviewNeeded } from "../activity/filing-evidence.ts";
import {
	decisionPosition,
	mailGroup,
	readHomeEmailThread,
	senderLabel,
} from "../home-email-thread.ts";
import {
	currentEmailSummary,
	emailSuggestionTitle,
	savedEmailAction,
} from "../home-email-title.ts";
import { readHomeReviewCards } from "../home-inbox-review.ts";
import { stepCopy } from "../home-steps.ts";
import type { DB, JsonObject, JsonValue } from "../next-database.d.ts";
import {
	nameOldRecords,
	readOldRecordNames,
	recordLinks,
} from "../old-record-names.ts";
import { asText } from "../reader.ts";
import { checklistType } from "./checklist.ts";
import { invoiceOf } from "./invoice.ts";
import {
	checkInNextStep,
	clientWebsiteOf,
	parkingNoteForDisplay,
	selectNextDealsWithFacts,
} from "./next-board.ts";
import {
	commissionsOf,
	criticalDatesOf,
	currentLeaseOf,
	ownDatesOf,
	phaseSpansOf,
	planForRead,
	planVersionOf,
	seededWithoutMove,
	stepsOf,
	typicalLengthsOf,
} from "./plan-read.ts";
import { ENDED_PHASES } from "./shared.ts";

const HISTORY_CAP = 500;

type DealEvent = {
	id: string;
	activity_id: string | null;
	recorded_at: string;
	actor: string;
	verb: string;
	field: string | null;
	old_value: JsonValue;
	new_value: JsonValue;
};

type ImportedDealEvent = Omit<
	DealEvent,
	"activity_id" | "old_value" | "new_value"
> & {
	occurred_at: string;
	imported: true;
	old_value: JsonObject | null;
	new_value: JsonObject | null;
};

type Correspondence = {
	activity_id: string;
	happened_at: string;
} & (
	| {
			kind: "email";
			sender: string;
			sender_name: string | null;
			subject: string;
	  }
	| {
			kind: "meeting";
			title: string | null;
			properties?: { id: string; name: string | null; address: string }[];
	  }
);

export function nextDealDetailQuery(db: Transaction<DB>, deal: string) {
	return selectNextDealsWithFacts(db)
		.select((eb) => [
			sql.lit("deal-timeline.v1").as("schema_version"),
			sql.lit("deal-items.v1").as("item_schema_version"),
			"d.id as deal_id",
			"d.closed_value",
			"d.renews_lease_id",
			clientWebsiteOf(db, eb.ref("d.id"), eb.ref("c.party_id")).as(
				"client_portal_url",
			),
			asText(sql`(now() at time zone 'America/Chicago')::date`)
				.$notNull()
				.as("today"),
			jsonArrayFrom(commissionsOf(db, eb.ref("d.id"))).as("commissions"),
			jsonArrayFrom(
				eb
					.selectFrom("deal_property as dp")
					.innerJoin("property as p", "p.id", "dp.property_id")
					.select(["p.id", "p.name", "p.address"])
					.whereRef("dp.deal_id", "=", "d.id")
					.orderBy("p.address")
					.orderBy("p.id"),
			).as("properties"),
			jsonArrayFrom(stepsOf(db, eb.ref("d.id"))).as("next_actions"),
			phaseSpansOf(eb.ref("d.id")).as("phase_spans"),
			typicalLengthsOf(eb.ref("d.kind")).as("typical_lengths"),
			ownDatesOf(eb.ref("d.id")).as("own_dates"),
			planVersionOf(eb.ref("d.id")).as("plan_version"),
			jsonArrayFrom(
				selectDealParties(db, eb.ref("d.id"))
					.select(["dp.role", "p.name", "u.slug as actor", "dp.party_id"])
					.where("dp.role", "<>", "client"),
			).as("participants"),
			jsonArrayFrom(
				activityHistoryOf(db, eb.ref("d.id"))
					.where("a.kind", "<>", "note")
					.select((eb) => [
						"a.summary",
						asText(eb.ref("a.happened_at")).as("occurred_at"),
					]),
			).as("activities"),
			jsonArrayFrom(
				activityHistoryOf(db, eb.ref("d.id"))
					.where("a.kind", "=", "note")
					.select((eb) => [
						"a.summary as text",
						asText(eb.ref("a.happened_at")).as("created_at"),
					]),
			).as("thread"),
			correspondenceOf(eb.ref("d.id")).as("correspondence"),
			jsonArrayFrom(criticalDatesOf(db, eb.ref("d.id"))).as("critical_dates"),
			jsonArrayFrom(documentsOf(db, eb.ref("d.id"))).as("documents"),
			jsonArrayFrom(emailFollowUpsOf(db, eb.ref("d.id"))).as(
				"email_follow_ups",
			),
			jsonArrayFrom(
				eb
					.selectFrom("proposal as suggestion")
					.select((eb) => [
						"suggestion.id as proposal_id",
						"suggestion.what",
						"suggestion.evidence",
						asText(eb.ref("suggestion.due_on")).as("due_on"),
					])
					.whereRef("suggestion.deal_id", "=", "d.id")
					.where("suggestion.kind", "=", "workflow_step")
					.where("suggestion.status", "=", "pending")
					.orderBy("suggestion.created_at")
					.orderBy("suggestion.id"),
			).as("workflow_suggestions"),
			jsonObjectFrom(currentLeaseOf(db, eb.ref("d.id"))).as("lease"),
			sql<
				ImportedDealEvent[]
			>`coalesce((select events from deal_imported_history h where h.deal_id = d.id), '[]')`.as(
				"imported_deal_history",
			),
			sql<
				DealEvent[]
			>`(select coalesce(json_agg(e order by recorded_at desc, id desc), '[]') from (
				select c.id::text, coalesce((c.source_event ->> 'recorded_at')::timestamptz, c.changed_at) as recorded_at,
					coalesce(u.slug, c.changed_by_job) as actor,
					c.source_event ->> 'verb' as verb, c.source_event ->> 'field' as field,
					${copiedDealEditValue("old_value")} as old_value, ${copiedDealEditValue("new_value")} as new_value,
					case when c.table_name = 'activity' then c.record ->> 'id' end as activity_id
				from (
					select c.* from imported_change c
					where c.table_name = 'deal' and c.record = jsonb_build_object('id', d.id)
					union all
					select c.* from activity_about ab join imported_change c
						on c.table_name = 'activity' and c.record = jsonb_build_object('id', ab.activity_id)
					where ab.deal_id = d.id and c.source_event ->> 'verb' = 'add-deal-note'
						and c.source_event ->> 'subject_id' = d.id::text
				) c left join app_user u on u.id = c.changed_by_user_id
				union all
				select p.deal_id || ':phase:' || (to_jsonb(p.happened_at) #>> '{}'),
					p.changed_at, coalesce(u.slug, p.changed_by_job), 'move-phase',
					'phase', null::jsonb, to_jsonb(p.phase), null::text
				from deal_phase_change p left join app_user u on u.id = p.changed_by_user_id
				where p.deal_id = d.id and not ${seededWithoutMove}
				union all
				select c.id || ':' || edit.key, c.changed_at, coalesce(u.slug, c.changed_by_job), 'update-deal',
					case edit.key
						when 'owner_user_id' then 'owner'
						when 'market_id' then 'market'
						when 'needs_attention' then 'attention'
						when 'closed_value' then 'won_value'
						else edit.key
					end,
					${dealEditValue("c.old_value")}, ${dealEditValue("c.new_value")}, null::text
				from change c left join app_user u on u.id = c.changed_by_user_id
				cross join lateral (
					select key from jsonb_object_keys(c.new_value) as fields(key)
					where key not in ('parking_reason', 'parking_note', 'parked_at', 'parked_by_user_id', 'parked_automatically')
					union all
					select 'operating_state' where c.new_value ?| array['parking_reason', 'parking_note']
				) edit
				where c.table_name = 'deal' and c.record = jsonb_build_object('id', d.id) and c.action = 'update'
				union all
				select c.id::text, c.changed_at, coalesce(u.slug, c.changed_by_job), 'cancel-tour',
					'cancelled_at', c.old_value -> 'cancelled_at', c.new_value -> 'cancelled_at', null::text
				from change created join change c on c.table_name = 'tour_plan' and c.record = created.record
				left join app_user u on u.id = c.changed_by_user_id
				where created.table_name = 'tour_plan' and created.action = 'insert'
					and created.new_value ->> 'deal_id' = d.id::text
					and c.action = 'update' and c.new_value ->> 'cancelled_at' is not null
				order by recorded_at desc, id desc limit ${HISTORY_CAP}
			) e)`.as("events"),
		])
		.where("d.id", "=", deal);
}

export async function readNextDealDocumentText(
	db: Transaction<DB>,
	{ deal, document }: { deal: string; document: string },
) {
	const file = await nextDealDetailQuery(db, deal)
		.clearSelect()
		.innerJoin("document as doc", "doc.deal_id", "d.id")
		.where("doc.id", "=", document)
		.select((eb) =>
			eb
				.selectFrom("document_extraction as extraction")
				.select("extraction.pages")
				.whereRef("extraction.document_id", "=", "doc.id")
				.where("extraction.status", "=", "produced")
				.orderBy("extraction.extracted_at", "desc")
				.orderBy("extraction.id", "desc")
				.limit(1)
				.as("pages"),
		)
		.executeTakeFirst();
	return file ? { pages: file.pages ?? [] } : null;
}

// The conversation of an email filed to the deal, as Home shows it to the same partner.
export async function readNextDealEmailThread(
	db: Transaction<DB>,
	userId: string,
	{ deal, email }: { deal: string; email: string },
) {
	const filed = await db
		.selectFrom("activity_about as ab")
		.innerJoin("email as e", "e.activity_id", "ab.activity_id")
		.select("e.activity_id")
		.where("ab.deal_id", "=", deal)
		.where("ab.activity_id", "=", email)
		.executeTakeFirst();
	if (!filed) return null;
	const { thread } = await readHomeEmailThread(db, userId, email);
	return { thread };
}

export async function readNextDealDetail(
	db: Transaction<DB>,
	deal: string,
	userId?: string,
) {
	const record = await nextDealDetailQuery(db, deal).executeTakeFirst();
	if (!record) return { error: "not_found" as const };
	const {
		today,
		commissions,
		critical_dates,
		email_follow_ups,
		typical_lengths,
		own_dates,
		plan_version,
		...detail
	} = record;
	const {
		plan,
		attention,
		checklist,
		critical_dates: labeledDates,
	} = planForRead(
		{
			...detail,
			commissions,
			critical_dates,
			steps: detail.next_actions,
			lengths: typical_lengths,
			own_dates,
			today,
		},
		detail.operating_state === "active" &&
			!detail.closed_on &&
			!detail.invoiced_on &&
			!detail.outcome &&
			!ENDED_PHASES.includes(detail.phase ?? ""),
	);
	const emailActivityIds = [
		...new Set(email_follow_ups.map(({ email }) => email.activity_id)),
	];
	const cards =
		userId && emailActivityIds.length
			? await readHomeReviewCards(db, userId, null, true, {
					kind: "email_sources",
					activityIds: emailActivityIds,
				})
			: [];
	const homeTitles = new Map(
		cards.flatMap(({ source_activity, title }) =>
			source_activity?.kind === "email"
				? [[source_activity.id, title] as const]
				: [],
		),
	);
	const names = await readOldRecordNames(db, [
		detail.next_step,
		...detail.thread.map(({ text }) => text),
		...detail.activities.map(({ summary }) => summary),
		...detail.next_actions.flatMap(({ description, title }) => [
			description,
			title,
		]),
	]);
	const named = (text: string | null) => text && nameOldRecords(text, names);
	return {
		...checkInNextStep(names)(detail),
		attention,
		thread: detail.thread.map((note) => ({ ...note, text: named(note.text) })),
		activities: detail.activities.map((activity) => ({
			...activity,
			summary: named(activity.summary),
		})),
		record_links: recordLinks(names),
		next_actions: detail.next_actions.map((step) => {
			const { title, instruction } = stepCopy(
				{
					what: nameOldRecords(step.description, names),
					item_title: named(step.title),
				},
				names,
			);
			return {
				...step,
				display_title: title,
				display_instruction: instruction,
			};
		}),
		email_follow_ups: email_follow_ups.map(
			({ email_action_title, email_sender, decision_label, ...followUp }) => ({
				...followUp,
				title:
					homeTitles.get(followUp.email.activity_id) ??
					emailSuggestionTitle({
						kind: followUp.kind,
						email_action_title,
						email_sender,
						context_label: detail.name,
						decision_label,
					}),
			}),
		),
		critical_dates: labeledDates,
		checklist,
		invoice: invoiceOf({
			type: checklistType(detail),
			lease_executed_on: detail.lease?.executed_on ?? null,
			closed_on: detail.closed_on,
			payments: commissions,
		}),
		plan: { own_dates, base_version: plan_version, ...plan },
	};
}

const correspondenceOf = (deal: Expression<string>) => sql<Correspondence[]>`(
	select coalesce(jsonb_agg(
		jsonb_build_object('activity_id', a.id, 'kind', a.kind, 'happened_at', a.happened_at)
		|| case when a.kind = 'meeting' then jsonb_build_object('title',
			nullif(btrim(split_part(replace(a.summary, chr(13), ''), E'\\n\\n', 1), E' \\t\\n'), ''))
			|| coalesce((
				select jsonb_build_object('properties', jsonb_agg(
					jsonb_build_object('id', p.id, 'name', p.name, 'address', p.address)
					order by p.address, p.id))
				from activity_about visited join property p on p.id = visited.property_id
				where visited.activity_id = a.id having count(*) > 0
			), '{}')
		else jsonb_build_object('sender', e.sender, 'sender_name', ${senderLabel("e", false)}, 'subject', e.subject)
		end
		order by a.happened_at desc, a.id desc
	), '[]')
	from activity_about ab
	join activity a on a.id = ab.activity_id
	left join email e on e.activity_id = a.id
	where ab.deal_id = ${deal} and (a.kind = 'meeting' or e.activity_id is not null)
)`;

function copiedDealEditValue(side: "old_value" | "new_value") {
	const value = sql`c.source_event -> ${sql.lit(side)}`;
	const parking = sql`${value} -> 'operating_state'`;
	return sql`case when c.source_event ->> 'field' = 'operating_state' and ${parking} is not null
		then jsonb_strip_nulls(jsonb_build_object(
			'state', ${parking} -> 'state',
			'reason', ${parking} -> 'reason',
			'note', ${parkingNoteForDisplay(sql`${parking} ->> 'note'`)}
		))
		else ${value}
	end`;
}

function dealEditValue(column: "c.old_value" | "c.new_value") {
	const value = sql.ref(column);
	return sql`case edit.key
		when 'owner_user_id' then to_jsonb((select slug from app_user where id = (${value} ->> edit.key)::uuid))
		when 'market_id' then to_jsonb((select name from market where id = (${value} ->> edit.key)::uuid))
		when 'operating_state' then jsonb_strip_nulls(jsonb_build_object(
			'state', case when ${value} -> 'parking_reason' = 'null'::jsonb then 'active' else 'parked' end,
			'reason', ${value} -> 'parking_reason',
			'note', ${parkingNoteForDisplay(sql`${value} ->> 'parking_note'`)}
		))
		else ${value} -> edit.key
	end`;
}

const documentsOf = (db: Transaction<DB>, deal: Expression<string>) =>
	db
		.selectFrom("document as doc")
		.leftJoin("app_user as by", "by.id", "doc.changed_by_user_id")
		.select((eb) => [
			"doc.id",
			"doc.name",
			"doc.kind",
			"doc.note",
			"doc.version",
			eb.ref("doc.bytes").$castTo<number>().as("bytes"),
			"doc.content_type",
			eb.fn.coalesce("by.slug", "doc.changed_by_job").as("actor"),
			asText(eb.ref("doc.created_at")).as("prepared_at"),
		])
		.where("doc.deal_id", "=", deal)
		.orderBy("doc.created_at", "desc")
		.orderBy("doc.id");

const dealEmailFollowUpKinds = [
	"next_step",
	"file_to_deal",
	"phase_move",
] as const;

const emailFollowUpsOf = (db: Transaction<DB>, deal: Expression<string>) =>
	db
		.selectFrom((eb) =>
			eb
				.selectFrom("proposal as p")
				.innerJoin("email as e", "e.activity_id", "p.activity_id")
				.select(["p.id", decisionPosition("p", mailGroup).as("position")])
				.where("p.deal_id", "=", deal)
				.where("p.status", "=", "pending")
				.where("p.kind", "in", dealEmailFollowUpKinds)
				.where((eb) =>
					eb.or([
						eb("p.kind", "<>", "file_to_deal"),
						filingReviewNeeded(eb.ref("p.activity_id"), eb.ref("p.deal_id")),
					]),
				)
				.as("shown"),
		)
		.innerJoin("proposal as p", "p.id", "shown.id")
		.innerJoin("email as e", "e.activity_id", "p.activity_id")
		.innerJoin("activity as a", "a.id", "e.activity_id")
		.leftJoin("app_user as o", "o.id", "p.owner_party_id")
		.leftJoin("phase", "phase.slug", "p.to_phase")
		.leftJoinLateral(
			(eb) => currentEmailSummary(eb.ref("e.activity_id")).as("summary"),
			(join) => join.onTrue(),
		)
		.select((eb) => [
			"p.id as proposal_id",
			"p.kind",
			"phase.label as decision_label",
			savedEmailAction.as("email_action_title"),
			senderLabel("e").as("email_sender"),
			"p.deal_id",
			"p.evidence",
			"p.what",
			"o.slug as owner",
			asText(eb.ref("p.due_on")).as("due_on"),
			"p.from_phase",
			"p.to_phase",
			jsonBuildObject({
				activity_id: eb.ref("e.activity_id"),
				sender: eb.ref("e.sender"),
				sender_name: senderLabel("e", false),
				subject: eb.ref("e.subject"),
				happened_at: asText(eb.ref("a.happened_at")),
				summary: eb.ref("a.summary"),
			}).as("email"),
		])
		.$narrowType<{ kind: (typeof dealEmailFollowUpKinds)[number] }>()
		.where("shown.position", "=", 1)
		.orderBy("p.created_at", "desc")
		.orderBy("p.id");

export const selectDealParties = (
	db: Transaction<DB>,
	deal: Expression<string>,
) =>
	db
		.selectFrom("deal_party as dp")
		.innerJoin("party as p", "p.id", "dp.party_id")
		.leftJoin("app_user as u", "u.id", "dp.party_id")
		.where("dp.deal_id", "=", deal)
		.orderBy("dp.role")
		.orderBy("p.name");

const activityHistoryOf = (db: Transaction<DB>, deal: Expression<string>) =>
	db
		.selectFrom("activity as a")
		.innerJoin("activity_about as ab", "ab.activity_id", "a.id")
		.leftJoin("app_user as by", "by.id", "a.changed_by_user_id")
		.select((eb) => [
			"a.id",
			"a.kind",
			eb.fn.coalesce("by.slug", "a.changed_by_job").as("actor"),
		])
		.where("ab.deal_id", "=", deal)
		.orderBy("a.happened_at", "desc")
		.orderBy("a.id", "desc")
		.limit(HISTORY_CAP);
