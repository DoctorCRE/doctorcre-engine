import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { lockEmail, parseEmail, recordEmail } from "../activity/next-record.ts";
import { Refusal, refuse } from "../answer.ts";
import type { JsonObject } from "../database.d.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { ACTING_USER } from "../next-save.ts";
import {
	fit,
	fitting,
	isInstant,
	isStoredText,
	isUuid,
	optional,
} from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";
import { isArguments } from "../save-door.ts";

const kinds = new Set([
	"direct_inquiry",
	"lead_source",
	"uncertain",
	"internal",
	"system",
	"existing_relationship",
]);
const prospectShape = fitting({
	kind: optional(
		(v): v is "person" | "company" => v === "person" || v === "company",
	),
	name: optional(isStoredText),
	email: optional(isStoredText),
	phone: optional(isStoredText),
	street_address: optional(isStoredText),
	city: optional(isStoredText),
});
const shape = {
	idempotency_key: isUuid,
	happened_at: isInstant,
	email: isArguments,
	kind: (v: unknown): v is string => typeof v === "string" && kinds.has(v),
	evidence: optional(isStoredText),
	prospect: optional(prospectShape),
};

function parseIntake(body: JsonObject) {
	const request = fit(body, shape, [
		"idempotency_key",
		"happened_at",
		"email",
		"kind",
	]);
	if (request instanceof Refusal) return request;
	const email = parseEmail(request.email);
	return email &&
		isStoredText(email.message_id) &&
		email.message_id === email.message_id.trim() &&
		!/[<>]/.test(email.message_id)
		? { ...request, email }
		: new Refusal(400, "invalid_field_value", { fields: ["email"] });
}

type Intake = Exclude<ReturnType<typeof parseIntake>, Refusal>;

function identified(
	{ kind, evidence, prospect }: Intake,
	source: Intake["email"],
) {
	if (
		!prospect?.kind ||
		!prospect.name ||
		!evidence ||
		!source.body.includes(evidence)
	)
		return;
	const { name, phone, street_address, city } = prospect;
	const email = prospect.email?.trim().toLowerCase();
	const body = source.body.toLowerCase();
	const has = (value: string) => body.includes(value.trim().toLowerCase());
	if (kind === "direct_inquiry") {
		if (
			email !== source.sender ||
			(name.trim() !== source.sender_name?.trim() && !has(name))
		)
			return;
	} else if (kind !== "lead_source" || !has(name) || email === source.sender)
		return;
	if (email && kind === "lead_source" && !has(email)) return;
	const digits = phone?.replace(/^\+1(?=\d{10}$)|^\+/, "");
	if (
		digits &&
		(!/^\d+$/.test(digits) ||
			!new RegExp(`\\b${[...digits].join("[ ().-]*")}\\b`).test(body))
	)
		return;
	if (
		(street_address || city) &&
		!(street_address && city && has(street_address) && has(city))
	)
		return;
	if (!email && !phone && !street_address) return;
	return {
		...prospect,
		kind: prospect.kind,
		name: name.trim(),
		email,
		city: city?.trim(),
		evidence,
	};
}

async function saveIntake(tx: Transaction<DB>, request: Intake) {
	const { email, happened_at, kind } = request;
	const { message_id } = email;
	const {
		rows: [sponsor],
	} = await sql<{ id: string }>`
		select id from app_user where id = ${ACTING_USER} and is_account_partner
	`.execute(tx);
	if (!sponsor)
		throw new SaveRefusal(new Refusal(422, "actor_not_provisioned"));
	const reject = async (reason: string) => {
		await sql`insert into lead_email_evidence (message_id, mailbox_user_id, source, reason)
			values (${message_id}, ${sponsor.id}, ${JSON.stringify(request)}::jsonb, ${reason})
			on conflict do nothing`.execute(tx);
		return { error: "lead_email_not_eligible", hint: reason };
	};
	await lockEmail(tx, message_id);
	const {
		rows: [stored],
	} = await sql<{
		activity_id: string;
		sender: string;
		sender_name: string | null;
		body: string;
		party_id: string | null;
		about_deal: boolean;
	}>`
		select e.activity_id, e.sender, e.sender_name, e.body, s.party_id,
			exists(select from activity_about a where a.activity_id = e.activity_id and a.deal_id is not null) as about_deal
		from email e left join lead_email_source s using (activity_id) where e.message_id = ${message_id}
	`.execute(tx);
	const source = { ...email, ...stored };
	const internal = await sql`
		select from party_email e join app_user u on u.id = e.party_id where e.address = ${source.sender} limit 1
	`.execute(tx);
	if (internal.rows.length || kind === "internal" || kind === "system")
		return reject("Internal and system email cannot create a lead.");
	const prospect = identified(request, source);
	if (!prospect)
		return reject(
			"The email needs a clear inquiry and recorded prospect details.",
		);
	const {
		rows: [valid],
	} = await sql<{ contacts: boolean }>`
		select (${prospect.email ?? null}::text is null or pg_input_is_valid(${prospect.email ?? null}, 'email_address'))
			and (${prospect.phone ?? null}::text is null or pg_input_is_valid(${prospect.phone ?? null}, 'phone_number')) as contacts
	`.execute(tx);
	if (!valid?.contacts)
		return reject("The prospect's email or phone is invalid.");
	if (stored?.party_id) {
		await sql`insert into email_mailbox (activity_id, user_id)
			values (${stored.activity_id}, ${sponsor.id}) on conflict do nothing`.execute(
			tx,
		);
		return {
			party_id: stored.party_id,
			activity_id: stored.activity_id,
			created_lead: false,
		};
	}
	if (stored?.about_deal) return reject("This email is already about a deal.");

	for (const contact of [prospect.email, prospect.phone]) {
		if (contact)
			await sql`select pg_advisory_xact_lock(hashtextextended(${`lead intake ${contact}`}, 0))`.execute(
				tx,
			);
	}
	const {
		rows: [match, another],
	} = await sql<{ party_id: string; is_lead: boolean; is_internal: boolean }>`
		select m.party_id, exists(select from party_role r where r.party_id = m.party_id and r.role = 'lead') as is_lead,
			exists(select from app_user u where u.id = m.party_id) as is_internal
		from (select party_id from party_email where address = ${prospect.email ?? null}
			union select party_id from party_phone where number = ${prospect.phone ?? null}) m
		limit 2
	`.execute(tx);
	if (another)
		return reject("The prospect details match more than one record.");
	if (match && (!match.is_lead || match.is_internal))
		return reject("The prospect details belong to an existing relationship.");
	const party_id = match?.party_id ?? (await createLead(tx, prospect));
	const { evidence, ...facts } = prospect;
	const { activity_id } = await recordEmail(
		tx,
		{
			kind: "email",
			happened_at,
			from_party_id: null,
			reached: null,
			summary: null,
		},
		[{ party_id }],
		source,
	);
	await sql`insert into lead_email_source (activity_id, party_id, mailbox_user_id, prospect, evidence)
		values (${activity_id}, ${party_id}, ${sponsor.id}, ${JSON.stringify(facts)}::jsonb, ${evidence})`.execute(
		tx,
	);
	if (!match)
		await sql`insert into lead_email_attention (party_id, activity_id)
		values (${party_id}, ${activity_id})`.execute(tx);
	return { party_id, activity_id, created_lead: !match };
}

async function createLead(
	tx: Transaction<DB>,
	prospect: NonNullable<ReturnType<typeof identified>>,
) {
	const {
		rows: [party],
	} = await sql<{ id: string }>`
		insert into party (kind, name, city, how_found)
		values (${prospect.kind}, ${prospect.name}, ${prospect.city ?? null}, 'inbound') returning id
	`.execute(tx);
	if (!party) throw new Error("Lead insert returned no party");
	await sql`insert into party_role (party_id, role, stage) values (${party.id}, 'lead', 'new')`.execute(
		tx,
	);
	if (prospect.email)
		await sql`insert into party_email (party_id, address, label, is_primary)
		values (${party.id}, ${prospect.email}, 'work', true)`.execute(tx);
	if (prospect.phone)
		await sql`insert into party_phone (party_id, number, label, is_primary)
		values (${party.id}, ${prospect.phone}, 'work', true)`.execute(tx);
	return party.id;
}

export const leadEmailIntake = new Hono<NextSaveEnv>().post(
	"/leads/email-intake",
	async (c) => {
		if (c.get("stamp").job !== "mail_capture")
			return refuse(c, new Refusal(403, "unknown_job"));
		return answerNextSave(
			c,
			"lead-email-intake",
			parseIntake,
			saveIntake,
			(result) => (result.error ? 422 : result.created_lead ? 201 : 200),
		);
	},
);
