import { Hono } from "hono";
import { type RawBuilder, sql, type Transaction } from "kysely";
import { Refusal, unregisteredFields } from "../answer.ts";
import { isInstant } from "../calendar-date.ts";
import type { JsonObject, JsonValue } from "../database.d.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { ACTING_USER } from "../next-save.ts";
import { SaveRefusal } from "../save.ts";
import { isArguments } from "../save-door.ts";
import { isUuid } from "../uuid.ts";
import {
	type About,
	eligibleMailLinks,
	knownMailDestination,
} from "./filing-evidence.ts";

type Email = {
	message_id: string;
	conversation_id: string | null;
	sender: string;
	sender_name: string | null;
	recipients: { address: string; kind: "to" | "cc" }[];
	subject: string;
	body: string;
};
type CapturedEmail = Email & { split?: { authored: string; history: string } };
type ActivityFields = {
	kind: string;
	happened_at: string | RawBuilder<string>;
	summary: string | null;
	from_party_id: string | null;
	reached: boolean | null;
};
type NewActivity = Omit<ActivityFields, "happened_at"> & {
	idempotency_key: JsonValue;
	happened_at?: string;
	about: About[];
	email: CapturedEmail | null;
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

function parseEmail(value: JsonObject): Email | undefined {
	const {
		message_id,
		conversation_id = null,
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
		(conversation_id === null ||
			(isText(conversation_id) && conversation_id.trim() !== "")) &&
		(sender_name === null || isText(sender_name)) &&
		isText(message_id) &&
		isText(sender) &&
		isText(subject) &&
		isText(body)
		? {
				message_id,
				conversation_id,
				sender: address(sender),
				sender_name,
				recipients: to,
				subject,
				body,
			}
		: undefined;
}

export function parseCapturedEmail(value: unknown): CapturedEmail | undefined {
	if (!isArguments(value)) return undefined;
	const { authored, history, ...fields } = value;
	const email = parseEmail(fields);
	if (!email || (authored === undefined && history === undefined)) return email;
	if (
		isText(authored) &&
		isText(history) &&
		!authored.includes("\0") &&
		!history.includes("\0")
	) {
		return { ...email, split: { authored, history } };
	}
}

function parseActivity(args: JsonObject): NewActivity | Refusal {
	const { idempotency_key, kind, happened_at, about = [], email = null } = args;
	const { summary = null, from_party_id = null, reached = null } = args;
	const { calendar_review_key } = args;
	return settled(
		{
			idempotency_key,
			kind: isText(kind) ? kind : undefined,
			...((kind === "email" ||
				calendar_review_key !== undefined ||
				happened_at !== undefined) && {
				happened_at: isInstant(happened_at) ? happened_at : undefined,
			}),
			about: kind === "email" ? parseAbout(about) : filed(about),
			summary: optional(summary, isText),
			from_party_id: optional(from_party_id, isUuid),
			reached: kind === "call" ? optional(reached, isBoolean) : unused(reached),
			email: kind === "email" ? parseCapturedEmail(email) : unused(email),
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

export async function linkActivity(
	tx: Transaction<DB>,
	activity_id: string,
	about: About[],
) {
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

async function insertActivity(
	tx: Transaction<DB>,
	activity: ActivityFields,
	email?: Email,
) {
	const { id } = await tx
		.insertInto("activity")
		.values({ ...activity, ...STAMPED })
		.returning("id")
		.executeTakeFirstOrThrow();
	if (email) {
		const { recipients, ...stored } = email;
		await sql`insert into email (activity_id, message_id, conversation_id, sender, sender_name, subject, body)
	   values (${id}, ${stored.message_id}, ${stored.conversation_id}, ${stored.sender}, ${stored.sender_name}, ${stored.subject}, ${stored.body})`.execute(
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
	return id;
}

export async function lockEmail(tx: Transaction<DB>, messageId: string) {
	await sql`select pg_advisory_xact_lock(hashtextextended(${`email ${messageId}`}, 0))`.execute(
		tx,
	);
}

export async function recordEmailCapture(
	tx: Transaction<DB>,
	{
		activity_id,
		split,
		created = false,
	}: { activity_id: string; split: CapturedEmail["split"]; created?: boolean },
) {
	const mailbox = await sql`insert into email_mailbox (activity_id, user_id)
  select ${activity_id}, ${ACTING_USER} where ${ACTING_USER} is not null
  on conflict do nothing`.execute(tx);
	const mailboxAdded = mailbox.numAffectedRows === 1n;
	if (split && (created || mailboxAdded))
		await tx
			.updateTable("email")
			.set(split)
			.where("activity_id", "=", activity_id)
			.where("authored", "is", null)
			.execute();
	return mailboxAdded;
}

export async function recordEmail(
	tx: Transaction<DB>,
	activity: ActivityFields,
	records: About[],
	email: CapturedEmail,
	autoFile = false,
	queueFiling = false,
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
	await lockEmail(tx, message_id);
	const stored = await tx
		.selectFrom("email")
		.select(["activity_id", "conversation_id", "sender"])
		.where("email.message_id", "=", message_id)
		.executeTakeFirst();
	if (autoFile && !records.some((record) => "deal_id" in record)) {
		const destination = await knownMailDestination(
			tx,
			stored ?? email,
			!stored,
		);
		if (destination) about.push(destination);
	}
	const links =
		autoFile && stored
			? await eligibleMailLinks(tx, stored.activity_id, about)
			: about;
	if (!stored && !links.length)
		throw new SaveRefusal(new Refusal(422, "about_nothing"));
	const [from, another] = owners.filter((owner) => owner.address === sender);
	const from_party_id =
		activity.from_party_id ?? (another ? null : (from?.party_id ?? null));
	const activity_id =
		stored?.activity_id ??
		(await insertActivity(tx, { ...activity, from_party_id }, email));
	const mailboxAdded = await recordEmailCapture(tx, {
		activity_id,
		split: email.split,
		created: !stored,
	});
	const filedAbout = await linkActivity(tx, activity_id, links);
	if (autoFile && mailboxAdded) {
		const {
			rows: [storage],
		} = await sql<{ installed: boolean; split: boolean }>`
			select to_regclass('next.doc_judgment_job') is not null
				and to_regprocedure('next.queue_email_summary(uuid)') is not null as installed,
				to_regprocedure('next.queue_email_split(uuid)') is not null as split
		`.execute(tx);
		if (storage?.installed)
			await sql`select queue_email_summary(${activity_id})`.execute(tx);
		if (storage?.split)
			await sql`select queue_email_split(${activity_id})`.execute(tx);
		if (queueFiling) {
			const {
				rows: [filing],
			} = await sql<{ installed: boolean }>`
				select to_regprocedure('next.queue_email_filing(uuid)') is not null as installed
			`.execute(tx);
			if (filing?.installed)
				await sql`select queue_email_filing(${activity_id})`.execute(tx);
		}
	}
	return {
		activity_id,
		existing: stored !== undefined,
		about: filedAbout,
		unmatched: addresses.filter(
			(given) => !owners.some((owner) => owner.address === given),
		),
	};
}

export async function recordActivity(
	tx: Transaction<DB>,
	{
		idempotency_key: _key,
		about,
		email,
		calendar_review_key,
		happened_at,
		...fields
	}: NewActivity,
	autoFile = false,
	queueFiling = false,
) {
	await requireRecords(tx, about);
	const activity = {
		...fields,
		happened_at: happened_at ?? sql<string>`now()`,
	};
	if (email)
		return recordEmail(tx, activity, about, email, autoFile, queueFiling);
	const { activity_id, existing } =
		calendar_review_key === undefined
			? { activity_id: await insertActivity(tx, activity), existing: false }
			: await insertMeeting(tx, activity, calendar_review_key);
	return {
		activity_id,
		existing,
		about: await linkActivity(tx, activity_id, existing ? [] : about),
		unmatched: [],
	};
}

async function addLinks(
	tx: Transaction<DB>,
	{ activity_id, about }: { activity_id: string; about: About[] },
	mailCapture: boolean,
) {
	const stored = await tx
		.selectFrom("activity")
		.leftJoin("email", "email.activity_id", "activity.id")
		.select(["activity.kind", "email.message_id"])
		.where("id", "=", activity_id)
		.executeTakeFirst();
	if (!stored) throw new SaveRefusal(new Refusal(404, "not_found"));
	await requireRecords(tx, about);
	if (stored.message_id) await lockEmail(tx, stored.message_id);
	const links =
		mailCapture && stored.kind === "email"
			? await eligibleMailLinks(tx, activity_id, about)
			: about;
	return { activity_id, about: await linkActivity(tx, activity_id, links) };
}

export const activityDoor = new Hono<
	NextSaveEnv & { Bindings: { EMAIL_FILING_JUDGMENT?: string } }
>()
	.post("/activities", (c) =>
		answerNextSave(
			c,
			"record-activity",
			parseActivity,
			(tx, activity) =>
				recordActivity(
					tx,
					activity,
					c.get("stamp").job === "mail_capture",
					c.env.EMAIL_FILING_JUDGMENT === "true",
				),
			201,
		),
	)
	.post("/activities/:activity_id/about", (c) =>
		answerNextSave(
			c,
			"add-activity-about",
			(body) => parseLinks(c.req.param("activity_id"), body),
			(tx, args) => addLinks(tx, args, c.get("stamp").job === "mail_capture"),
		),
	);
