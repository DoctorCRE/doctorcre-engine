import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { Refusal, unregisteredFields } from "../answer.ts";
import { isInstant } from "../calendar-date.ts";
import type { JsonObject, JsonValue } from "../database.d.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { SaveRefusal } from "../save.ts";
import { isArguments } from "../save-door.ts";
import { isUuid } from "../uuid.ts";

type About =
	| { deal_id: string }
	| { party_id: string }
	| { property_id: string };
type Email = {
	message_id: string;
	conversation_id?: string | null;
	sender: string;
	sender_name: string | null;
	recipients: { address: string; kind: "to" | "cc" }[];
	subject: string;
	body: string;
};
type ActivityFields = {
	kind: string;
	happened_at: string;
	summary: string | null;
	from_party_id: string | null;
	reached: boolean | null;
};
type NewActivity = ActivityFields & {
	idempotency_key: JsonValue;
	about: About[];
	email: Email | null;
	calendar_review_key?: string;
};

const optional = <T>(value: JsonValue, is: (value: unknown) => value is T) =>
	value === null || is(value) ? value : undefined;
const isText = (value: unknown): value is string => typeof value === "string";
const isBoolean = (value: unknown): value is boolean =>
	typeof value === "boolean";
// A field only another kind takes is refused, not dropped.
const unused = (value: JsonValue) => (value === null ? null : undefined);
const address = (value: string) => value.trim().toLowerCase();
// stamp_change sets it; the generated type asks only because it has no default.
const STAMPED = { changed_at: sql<string>`now()` };
const ACTING_USER = sql<string>`nullif(current_setting('engine.user_id', true), '')::uuid`;

type Settled<T> = { [K in keyof T]: Exclude<T[K], undefined> };
const isSettled = <T extends object>(parsed: T): parsed is Settled<T> =>
	Object.values(parsed).every((value) => value !== undefined);

function settled<T extends object>(
	parsed: T,
	args: JsonObject,
): Settled<T> | Refusal {
	const stray = unregisteredFields(Object.keys(args), Object.keys(parsed));
	if (stray) return stray;
	if (isSettled(parsed)) return parsed;
	const fields = Object.entries(parsed).flatMap(([name, value]) =>
		value === undefined ? [name] : [],
	);
	const missing = fields.every((name) => args[name] === undefined);
	const error = missing ? "missing_required" : "invalid_field_value";
	return new Refusal(400, error, { fields });
}

function parseLink(link: JsonValue): About | undefined {
	if (!isArguments(link) || Object.keys(link).length !== 1) return undefined;
	const { deal_id, party_id, property_id } = link;
	if (isUuid(deal_id)) return { deal_id };
	if (isUuid(party_id)) return { party_id };
	if (isUuid(property_id)) return { property_id };
}

function parseAbout(value: unknown): About[] | undefined {
	const about = Array.isArray(value) ? value.map(parseLink) : [undefined];
	return about.every((link) => link !== undefined) ? about : undefined;
}
// A call, meeting, note or filing names at least one record.
const filed = (value: unknown) =>
	Array.isArray(value) && value.length ? parseAbout(value) : undefined;

function recipient(value: JsonValue): Email["recipients"][number] | undefined {
	if (!isArguments(value) || !isText(value.address)) return undefined;
	if (Object.keys(value).some((key) => key !== "address" && key !== "kind"))
		return undefined;
	const { kind } = value;
	return kind === "to" || kind === "cc"
		? { address: address(value.address), kind }
		: undefined;
}

function parseEmail(value: JsonValue): Email | undefined {
	if (!isArguments(value)) return undefined;
	const {
		message_id,
		conversation_id,
		sender,
		sender_name = null,
		recipients,
		subject,
		body,
		...rest
	} = value;
	const to = Array.isArray(recipients)
		? recipients.map(recipient)
		: [undefined];
	return !Object.keys(rest).length &&
		to.every((item) => item !== undefined) &&
		(conversation_id === undefined ||
			conversation_id === null ||
			(isText(conversation_id) && conversation_id.trim() !== "")) &&
		(sender_name === null || isText(sender_name)) &&
		isText(message_id) &&
		isText(sender) &&
		isText(subject) &&
		isText(body)
		? {
				message_id,
				...(conversation_id !== undefined && { conversation_id }),
				sender: address(sender),
				sender_name,
				recipients: to,
				subject,
				body,
			}
		: undefined;
}

function parseActivity(args: JsonObject): NewActivity | Refusal {
	const { idempotency_key, kind, happened_at, about = [], email = null } = args;
	const { summary = null, from_party_id = null, reached = null } = args;
	const { calendar_review_key } = args;
	return settled(
		{
			idempotency_key,
			kind: isText(kind) ? kind : undefined,
			happened_at: isInstant(happened_at) ? happened_at : undefined,
			about: kind === "email" ? parseAbout(about) : filed(about),
			summary: optional(summary, isText),
			from_party_id: optional(from_party_id, isUuid),
			reached: kind === "call" ? optional(reached, isBoolean) : unused(reached),
			email: kind === "email" ? parseEmail(email) : unused(email),
			// Leave preexisting requests unchanged for receipt hashing.
			...("calendar_review_key" in args && {
				calendar_review_key:
					kind === "meeting" &&
					isText(calendar_review_key) &&
					/^[a-f0-9]{16}$/.test(calendar_review_key)
						? calendar_review_key
						: undefined,
			}),
		},
		args,
	);
}

function parseLinks(activity_id: string, args: JsonObject) {
	if (!isUuid(activity_id)) return new Refusal(404, "not_found");
	const { idempotency_key, about } = args;
	return settled({ idempotency_key, activity_id, about: filed(about) }, args);
}

async function requireRecords(tx: Transaction<DB>, about: About[]) {
	const { rows } = await sql<{ link: About }>`
		select jsonb_strip_nulls(to_jsonb(l)) as link
		from jsonb_to_recordset(${JSON.stringify(about)}::jsonb) as l (deal_id uuid, party_id uuid, property_id uuid)
		where not exists (select from deal where id = l.deal_id)
			and not exists (select from party where id = l.party_id)
			and not exists (select from property where id = l.property_id)`.execute(
		tx,
	);
	if (rows.length)
		throw new SaveRefusal(
			new Refusal(404, "not_found", { about: rows.map((row) => row.link) }),
		);
}

async function link(tx: Transaction<DB>, activity_id: string, about: About[]) {
	if (about.length)
		await tx
			.insertInto("activity_about")
			.values(about.map((link) => ({ activity_id, ...link, ...STAMPED })))
			.onConflict((conflict) => conflict.doNothing())
			.execute();
	const { rows } = await sql<{ link: About }>`
		select jsonb_strip_nulls(jsonb_build_object('deal_id', deal_id, 'party_id', party_id, 'property_id', property_id)) as link
		from activity_about where activity_id = ${activity_id}
		order by created_at, deal_id, party_id, property_id`.execute(tx);
	return rows.map((row) => row.link);
}

async function insertActivity(tx: Transaction<DB>, activity: ActivityFields) {
	const { id } = await tx
		.insertInto("activity")
		.values({ ...activity, ...STAMPED })
		.returning("id")
		.executeTakeFirstOrThrow();
	return id;
}

async function insertMeeting(
	tx: Transaction<DB>,
	activity: ActivityFields,
	calendar_review_key: string,
) {
	const saved = await tx
		.insertInto("activity")
		.values({
			...activity,
			...STAMPED,
			calendar_review_key,
			calendar_review_user_id: ACTING_USER,
		})
		.onConflict((conflict) =>
			conflict
				.columns(["calendar_review_user_id", "calendar_review_key"])
				.doNothing(),
		)
		.returning("id")
		.executeTakeFirst();
	if (saved) return { activity_id: saved.id, existing: false };
	const stored = await tx
		.selectFrom("activity")
		.select("id")
		.where("calendar_review_user_id", "=", ACTING_USER)
		.where("calendar_review_key", "=", calendar_review_key)
		.executeTakeFirstOrThrow();
	return { activity_id: stored.id, existing: true };
}

async function insertEmail(
	tx: Transaction<DB>,
	id: string,
	{ recipients, ...stored }: Email,
) {
	await sql`insert into email (activity_id, message_id, conversation_id, sender, sender_name, subject, body)
   values (${id}, ${stored.message_id}, ${stored.conversation_id ?? null}, ${stored.sender}, ${stored.sender_name}, ${stored.subject}, ${stored.body})`.execute(
		tx,
	);
	if (recipients.length)
		await tx
			.insertInto("email_recipient")
			.values(
				recipients.map((recipient, position) => ({
					activity_id: id,
					position,
					...recipient,
					...STAMPED,
				})),
			)
			.execute();
}

// Links an email to every party, other than the users, whose address sent or
// received it. A second copy of a stored email only adds its new links.
async function recordEmail(
	tx: Transaction<DB>,
	activity: ActivityFields,
	records: About[],
	email: Email,
) {
	const { message_id, sender, recipients } = email;
	if (!message_id || message_id !== message_id.trim())
		throw new SaveRefusal(new Refusal(422, "message_id_invalid"));
	const addresses = [
		...new Set([sender, ...recipients.map((recipient) => recipient.address)]),
	];
	const owners = await tx
		.selectFrom("party_email")
		.leftJoin("app_user", "app_user.id", "party_email.party_id")
		.select(["address", "party_id", "app_user.id as user_id"])
		.where("address", "in", addresses)
		.execute();
	const about: About[] = [
		...owners.flatMap(({ party_id, user_id }) =>
			user_id ? [] : [{ party_id }],
		),
		...records,
	];
	// Queues the other mailbox's copy of this email behind this one.
	await sql`select pg_advisory_xact_lock(hashtextextended(${`email ${message_id}`}, 0))`.execute(
		tx,
	);
	const stored = await tx
		.selectFrom("email")
		.select("activity_id")
		.where("message_id", "=", message_id)
		.executeTakeFirst();
	if (!stored && !about.length)
		throw new SaveRefusal(new Refusal(422, "about_nothing"));
	const [from, another] = owners.filter((owner) => owner.address === sender);
	const from_party_id =
		activity.from_party_id ?? (another ? null : (from?.party_id ?? null));
	let activity_id = stored?.activity_id;
	if (activity_id === undefined) {
		activity_id = await insertActivity(tx, { ...activity, from_party_id });
		await insertEmail(tx, activity_id, email);
	}
	await sql`insert into email_mailbox (activity_id, user_id)
  select ${activity_id}, ${ACTING_USER} where ${ACTING_USER} is not null
  on conflict do nothing`.execute(tx);
	return {
		activity_id,
		existing: stored !== undefined,
		about: await link(tx, activity_id, about),
		unmatched: addresses.filter(
			(given) => !owners.some((owner) => owner.address === given),
		),
	};
}

async function recordActivity(
	tx: Transaction<DB>,
	{
		idempotency_key: _key,
		about,
		email,
		calendar_review_key,
		...activity
	}: NewActivity,
) {
	await requireRecords(tx, about);
	if (email) return recordEmail(tx, activity, about, email);
	const { activity_id, existing } =
		calendar_review_key === undefined
			? { activity_id: await insertActivity(tx, activity), existing: false }
			: await insertMeeting(tx, activity, calendar_review_key);
	return {
		activity_id,
		existing,
		about: await link(tx, activity_id, existing ? [] : about),
		unmatched: [],
	};
}

async function addLinks(
	tx: Transaction<DB>,
	{ activity_id, about }: { activity_id: string; about: About[] },
) {
	const stored = await tx
		.selectFrom("activity")
		.select("id")
		.where("id", "=", activity_id)
		.executeTakeFirst();
	if (!stored) throw new SaveRefusal(new Refusal(404, "not_found"));
	await requireRecords(tx, about);
	return { activity_id, about: await link(tx, activity_id, about) };
}

export const activityDoor = new Hono<NextSaveEnv>()
	.post("/activities", (c) =>
		answerNextSave(c, "record-activity", parseActivity, recordActivity, 201),
	)
	.post("/activities/:activity_id/about", (c) =>
		answerNextSave(
			c,
			"add-activity-about",
			(body) => parseLinks(c.req.param("activity_id"), body),
			addLinks,
		),
	);
