import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { lockEmail, parseEmail, recordEmail } from "../activity/next-record.ts";
import { Refusal, refuse } from "../answer.ts";
import type { JsonObject } from "../database.d.ts";
import { beforeEmailHistory } from "../home-email-thread.ts";
import { nextTransaction } from "../next-connection.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { ACTING_USER, stampNextSave } from "../next-save.ts";
import {
	fit,
	fitting,
	isBoolean,
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
	name: optional(
		(v): v is string => typeof v === "string" && !v.includes("\0"),
	),
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
type IntakeFacts = Pick<Intake, "kind" | "evidence" | "prospect">;
type StoredIntake = IntakeFacts & {
	activity_id: string;
	message_id: string | null;
	preview: boolean;
};

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function quotesFact(evidence: string, fact: string) {
	const word = "[\\p{L}\\p{M}\\p{N}_]";
	return new RegExp(`(?<!${word})${literal(fact.trim())}(?!${word})`, "u").test(
		evidence,
	);
}

function identified(
	{ kind, evidence, prospect }: IntakeFacts,
	source: Pick<Intake["email"], "sender" | "sender_name" | "body">,
) {
	const name = prospect?.name?.trim();
	if (!prospect?.kind || !name || !evidence || !source.body.includes(evidence))
		return;
	const { phone, street_address, city } = prospect;
	const email = prospect.email?.trim().toLowerCase();
	const body = source.body.toLowerCase();
	const has = (value: string) => body.includes(value.trim().toLowerCase());
	if (kind === "direct_inquiry") {
		if (
			email !== source.sender ||
			(name !== source.sender_name?.trim() && !has(name))
		)
			return;
	} else if (kind !== "lead_source" || !has(name) || email === source.sender)
		return;
	if (email && kind === "lead_source") {
		const tokens = body.match(/[\p{L}\p{M}\p{N}.!#$%&'*+/=?^_`{|}~@-]+/gu);
		if (!tokens?.some((token) => token.replace(/\.+$/, "") === email)) return;
	}
	const digits = phone?.replace(/^\+1(?=\d{10}$)|^\+/, "");
	if (
		digits &&
		(!/^\d+$/.test(digits) ||
			!new RegExp(`\\b${[...digits].join("[ ().-]*")}\\b`).test(body))
	)
		return;
	if (
		(street_address || city) &&
		!(
			street_address &&
			city &&
			quotesFact(evidence, street_address) &&
			quotesFact(evidence, city)
		)
	)
		return;
	if (!email && !phone && !street_address) return;
	return {
		...prospect,
		kind: prospect.kind,
		name,
		email,
		street_address: street_address?.trim(),
		city: city?.trim(),
		evidence,
	};
}

async function saveIntake(tx: Transaction<DB>, request: Intake | StoredIntake) {
	const capture = "email" in request;
	const message_id = capture ? request.email.message_id : request.message_id;
	const preview = !capture && request.preview;
	const {
		rows: [sponsor],
	} = await sql<{ id: string }>`
		select id from app_user where id = ${ACTING_USER} and is_account_partner
	`.execute(tx);
	if (!sponsor)
		throw new SaveRefusal(new Refusal(422, "actor_not_provisioned"));
	const reject = async (reason: string) => {
		if (capture)
			await sql`insert into lead_email_evidence (message_id, mailbox_user_id, source, reason)
			values (${message_id}, ${sponsor.id}, ${JSON.stringify(request)}::jsonb, ${reason})
			on conflict do nothing`.execute(tx);
		return { error: "lead_email_not_eligible", hint: reason };
	};
	if (message_id && !preview) await lockEmail(tx, message_id);
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
		from email e left join lead_email_source s using (activity_id)
		where ${capture ? sql`e.message_id = ${message_id}` : sql`e.activity_id = ${request.activity_id}`}
	`.execute(tx);
	const source = stored ?? (capture ? request.email : undefined);
	if (!source) return reject("The source email is unavailable.");
	const internal = await sql`
		select from party_email e join app_user u on u.id = e.party_id where e.address = ${source.sender} limit 1
	`.execute(tx);
	if (
		internal.rows.length ||
		request.kind === "internal" ||
		request.kind === "system"
	)
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
		if (capture)
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
		if (contact && !preview)
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
	if (preview) return { party_id: match?.party_id ?? null };
	const party_id = match?.party_id ?? (await createLead(tx, prospect));
	const { evidence, ...facts } = prospect;
	if (facts.email)
		await sql`insert into party_email (party_id, address, label, is_primary)
		values (${party_id}, ${facts.email}, 'work', ${!match}) on conflict do nothing`.execute(
			tx,
		);
	if (facts.phone)
		await sql`insert into party_phone (party_id, number, label, is_primary)
		select ${party_id}::uuid, ${facts.phone}, 'work', ${!match}
		where not exists (select from party_phone where party_id = ${party_id} and number = ${facts.phone})
		on conflict do nothing`.execute(tx);
	let activity_id: string;
	if (capture) {
		({ activity_id } = await recordEmail(
			tx,
			{
				kind: "email",
				happened_at: request.happened_at,
				from_party_id: null,
				reached: null,
				summary: null,
			},
			[{ party_id }],
			{ ...request.email, ...stored },
		));
	} else {
		activity_id = request.activity_id;
		await sql`insert into activity_about (activity_id, party_id)
			values (${activity_id}, ${party_id}) on conflict do nothing`.execute(tx);
	}
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

const defaultLabels = {
	name: "Name",
	email: "Email",
	phone: "Phone",
	street_address: "Street Address",
	city: "City",
	request: "Request",
};

const contactText = (value: string) =>
	value.trim().toLowerCase().replace(/\s+/g, " ");

const phonePrefix = /^\+?[(\d][\d ().-]*\d/;
const bareEmailSlot =
	/^\s*[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]*[a-z](?=\s|$)/i;

function noticePhone(value: string | undefined) {
	const digits = value?.replace(/[ ().-]/g, "");
	const phone = digits?.replace(/^1?(\d{10})$/, "+1$1");
	if (phone && /^\+(?:1[2-9]\d{2}[2-9]\d{6}|[2-9]\d{6,14})$/.test(phone))
		return phone;
}

const streetTypes = [
	"alley|aly",
	"avenue|ave",
	"boulevard|blvd",
	"circle|cir",
	"court|ct",
	"crescent|cres",
	"drive|dr",
	"expressway|expy",
	"freeway|fwy",
	"highway|hwy",
	"lane|ln",
	"loop",
	"parkway|pkwy",
	"pike",
	"place|pl",
	"plaza|plz",
	"road|rd",
	"row",
	"run",
	"square|sq",
	"street|st",
	"terrace|ter",
	"trail|trl",
	"turnpike|tpke",
	"way",
].join("|");

const streetPattern = new RegExp(
	String.raw`^\d+\p{L}?\s+(?:[\p{L}\d][\p{L}\p{M}\d'’/-]*\s+)+(?:${streetTypes})\.?` +
		String.raw`(?:\s+(?:n|ne|e|se|s|sw|w|nw|north(?:east|west)?|south(?:east|west)?|east|west)\.?)?` +
		String.raw`(?:\s+(?:(?:suite|ste|unit|bldg|apt)\.?\s+(?:#\s*)?|#\s*)(?:[a-z]|[a-z]*\d[a-z\d]*)(?:-[a-z\d]+)?)?$`,
	"iu",
);

function recognizableStreet(street: string, name: string) {
	return (
		street.length <= 80 &&
		streetPattern.test(street) &&
		contactText(street) !== contactText(name)
	);
}

function noticeFacts(
	storedBody: string,
	fields: Record<string, string> | null,
) {
	const [own = ""] = beforeEmailHistory(storedBody).split(/(?<!\S)>/u, 1);
	const start = fields || !/[\r\n]/.test(own) ? "(?<!\\S)" : "^[ \\t]*";
	const nameLabel = literal((fields?.name ?? defaultLabels.name).trim());
	const nameStart = own.search(
		new RegExp(`${start}${nameLabel}[ \\t]*:`, "imu"),
	);
	if (nameStart < 0) return;
	const [contactBlock = ""] = own
		.slice(nameStart)
		.split(/(?<!\S)Received[ \t]*:/iu, 1);
	const [contactLine = ""] = contactBlock.split(/[\r\n]/, 1);
	const [namePart, firstSlot, secondSlot] = contactLine.split(" · ", 3);
	const copied = firstSlot !== undefined;
	const phoneSlot = firstSlot?.trim();
	const emailSlot =
		phoneSlot === "—" || noticePhone(phoneSlot)
			? secondSlot?.match(bareEmailSlot)?.[0]
			: undefined;
	const body = copied
		? [namePart, firstSlot, ...(emailSlot ? [emailSlot] : [])].join(" · ")
		: own.slice(0, nameStart) + contactBlock;
	const labels = new Map(
		Object.entries(fields ?? defaultLabels).map(([key, label]) => [
			label.trim().toLowerCase(),
			key,
		]),
	);
	const alternatives = [...labels.keys()]
		.sort((a, b) => b.length - a.length)
		.map(literal)
		.join("|");
	const matches = [
		...body.matchAll(
			new RegExp(
				`${copied ? "(?<!\\S)" : start}(${alternatives})[ \\t]*:`,
				"gimu",
			),
		),
	];
	const facts = new Map<string, string>();
	let combinedAddress: { street_address: string; city: string } | undefined;
	let end = 0;
	for (const [i, match] of matches.entries()) {
		const key = labels.get(match[1]?.toLowerCase() ?? "");
		if (!key || facts.has(key)) return;
		const offset = match.index + match[0].length;
		const [line = ""] = body
			.slice(offset, matches[i + 1]?.index)
			.split(/[\r\n]/, 1);
		const [value = "", extraPart] = line.split(" · ", 2);
		facts.set(key, value.trim());
		end = offset + line.length;
		if (key === "name" && extraPart !== undefined) {
			const extra = extraPart.trimStart();
			const email = extra.match(/^([^\s@]+@[^\s@]+)(?=\s|$)/)?.[1];
			const phone = extra.match(phonePrefix)?.[0];
			const contact = email ? "email" : phone ? "phone" : undefined;
			const contactValue = email ?? phone ?? "";
			if (contact) {
				if (facts.has(contact)) return;
				facts.set(contact, contactValue);
			}
			const [, streetAddress, city] =
				extra
					.slice(contactValue.length)
					.match(
						/^\s*(?:—\s*)?Address[ \t]*:\s*(\d[^,\r\n]+),\s*(\p{L}[\p{L}\p{M} .’'-]*),\s*[a-z]{2}\s+\d{5}(?:-\d{4})?(?=\s|$)/iu,
					) ?? [];
			if (streetAddress && city) {
				combinedAddress = {
					street_address: streetAddress.trim(),
					city: city.trim(),
				};
			}
		}
	}
	const name = facts.get("name");
	if (!name || (fields?.request && !facts.get("request"))) return;
	const email = (facts.get("email") ?? emailSlot?.trim())?.toLowerCase();
	const phone = noticePhone(facts.get("phone"));
	const labeledStreet = facts.get("street_address");
	const labeledCity = facts.get("city");
	const street_address = combinedAddress?.street_address ?? labeledStreet;
	const city = combinedAddress?.city ?? labeledCity;
	const address =
		street_address &&
		city &&
		recognizableStreet(street_address, name) &&
		(!labeledStreet ||
			contactText(labeledStreet) === contactText(street_address)) &&
		(!labeledCity || contactText(labeledCity) === contactText(city))
			? { street_address, city }
			: undefined;
	return {
		prospect: {
			kind: "person" as const,
			name,
			...(email && { email }),
			...(phone && { phone }),
			...address,
		},
		evidence: body.slice(matches[0]?.index, end).trim(),
	};
}

const parseReconcile = (body: JsonObject) =>
	fit(
		body,
		{
			idempotency_key: isUuid,
			activity_id: isUuid,
			dry_run: optional(isBoolean),
		},
		["idempotency_key", "activity_id"],
	);
type Reconcile = Exclude<ReturnType<typeof parseReconcile>, Refusal>;

async function reconcileEmail(tx: Transaction<DB>, request: Reconcile) {
	const { activity_id, dry_run } = request;
	const none = { eligible_emails: 0, filing_decisions: 0 };
	const {
		rows: [stored],
	} = await sql<{
		message_id: string | null;
		body: string;
		fields: Record<string, string> | null;
	}>`
		select e.message_id, e.body, source.fields
		from email e
		join email_mailbox m on m.activity_id = e.activity_id
		join app_user u on u.id = m.user_id and u.is_account_partner
		cross join lateral (
			select fields from lead_source_sender
			where lower(address) = e.sender or domain = split_part(e.sender, '@', 2)
			order by (address is not null) desc limit 1
		) source
		where e.activity_id = ${activity_id} and u.id = ${ACTING_USER}
	`.execute(tx);
	if (!stored) return none;
	const { rows: filings } = await sql<{ id: string }>`
		select id from proposal where activity_id = ${activity_id} and status = 'pending'
		and kind in ('file_to_deal', 'possible_new_deal') order by id ${dry_run ? sql`` : sql`for update`}
	`.execute(tx);
	if (!filings.length) {
		const prior = await tx
			.selectFrom("lead_email_source")
			.select("party_id")
			.where("activity_id", "=", activity_id)
			.executeTakeFirst();
		if (!prior || dry_run) return none;
		return { ...none, ...prior, eligible_emails: 1 };
	}
	const facts = noticeFacts(stored.body, stored.fields);
	if (!facts) return none;
	const result = await saveIntake(tx, {
		activity_id,
		message_id: stored.message_id,
		kind: "lead_source",
		preview: dry_run === true,
		...facts,
	});
	if ("error" in result) return none;
	const counts = { eligible_emails: 1, filing_decisions: filings.length };
	if (dry_run) return counts;
	await sql`update proposal set status = 'superseded'
		where id = any(${filings.map(({ id }) => id)}::uuid[])`.execute(tx);
	return { ...counts, party_id: result.party_id };
}

leadEmailIntake.post("/leads/email-reconcile", async (c) => {
	const stamp = c.get("stamp");
	if (stamp.job !== "mail_capture" || !stamp.for_user)
		return refuse(c, new Refusal(403, "unknown_job"));
	const body: unknown = await c.req.json().catch(() => undefined);
	if (!isArguments(body)) return refuse(c, new Refusal(400, "invalid_json"));
	const request = parseReconcile(body);
	if (request instanceof Refusal) return refuse(c, request);
	if (!request.dry_run)
		return answerNextSave(
			c,
			"lead-email-reconcile",
			() => request,
			reconcileEmail,
		);
	const database = c.env.DATABASE;
	if (!database) return refuse(c, new Refusal(503, "database_unavailable"));
	try {
		return c.json(
			await nextTransaction(database.connectionString, "read", async (tx) => {
				await stampNextSave(tx, stamp);
				return reconcileEmail(tx, request);
			}),
		);
	} catch (error) {
		return refuse(
			c,
			error instanceof SaveRefusal
				? error.refusal
				: new Refusal(503, "database_unavailable"),
		);
	}
});
