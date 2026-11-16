import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { URL } from "node:url";
import pg from "pg";
import { asAdmin } from "../scripts/test-database.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLIENT = id(1);
const AGENT = id(2);
const PROPERTY = id(3);
const ELSEWHERE = id(4);
const DEAL = id(5);
const MISSING = id(99);
const LENDERS = [id(6), id(7)];
const LENDER_DEAL = id(8);
const BROKERAGES = [id(9), id(10)];
const EMAIL = id(300);
const CALL = id(301);
const NOTE = id(302);
const DOCTOR = id(12);
// Made up. No NPI issued yet starts with 9, so none can be anyone's.
const NPIS = ["9000000015", "9000000023", "9000000031"];
const BAY = id(600);
const HOME = id(610);
const STATEWIDE = id(611);
const VENDOR = id(620);
const IN_STATE = id(630);
const IN_MARKET = id(631);
const IN_REACH = id(632);
const OUTSIDE = id(633);
const INTRODUCTION = id(640);
const CLOSED_DEAL = id(650);
const DEAD_DEAL = id(651);
const USER = id(20);
const TEAMMATE = id(21);
const LEAD = id(660);

const SEED = `
insert into role (slug, label, category_of) values
	('client', 'Client', null), ('lead', 'Lead', null), ('listing_agent', 'Listing agent', null), ('vendor', 'Vendor', null),
	('lender', 'Lender', 'vendor'), ('title', 'Title', 'vendor');
insert into how_found values ('referral', 'Referral'), ('vendor', 'Vendor'), ('public_records', 'Public records');
insert into party (id, kind, name, npi, how_found) values
	('${CLIENT}', 'company', 'Example Dental Group', '${NPIS[0]}', 'referral'),
	('${DOCTOR}', 'person', 'Dr. Example', '${NPIS[1]}', null);
insert into party (id, kind, name) values
	('${AGENT}', 'person', 'Avery Example'),
	('${LENDERS[0]}', 'company', 'Example Bank'), ('${LENDERS[1]}', 'company', 'Example Credit Union'),
	('${BROKERAGES[0]}', 'company', 'Example Realty'), ('${BROKERAGES[1]}', 'company', 'Example Properties');
insert into party_role values ('${CLIENT}', 'client'), ('${AGENT}', 'listing_agent');
insert into specialty values ('general_dentistry', 'General dentistry'), ('orthodontics', 'Orthodontics');
insert into party_specialty (person_id, specialty) values ('${DOCTOR}', 'general_dentistry');
insert into do_not_contact (party_id, reason) values ('${AGENT}', 'Example asked not to be contacted');
insert into outside_id (source, value, party_id) values ('salesforce', 'a0EXAMPLE0000001', '${CLIENT}');
insert into party_company (person_id, company_id, title, started_on, ended_on) values
	('${AGENT}', '${BROKERAGES[0]}', 'Associate', '2020-01-06', '2025-12-31'),
	('${AGENT}', '${BROKERAGES[1]}', 'Senior associate', '2026-01-05', null);
insert into party_email (party_id, address, label, is_primary) values
	('${AGENT}', 'avery@example.com', 'work', true), ('${AGENT}', 'avery.example@example.net', 'personal', false);
insert into party_phone (party_id, number, extension, label, is_primary) values
	('${AGENT}', '+12175550100', '12', 'work', true), ('${AGENT}', '+12175550101', null, 'mobile', false);
insert into phase (slug, label) values ('negotiation', 'Negotiating'), ('legal', 'Legal'), ('dead', 'Dead');
insert into property (id, address) values
	('${PROPERTY}', '100 Example Way, Springfield'), ('${ELSEWHERE}', '200 Example Way, Springfield');
insert into deal_kind values ('lease', 'Lease'), ('purchase', 'Purchase');
insert into deal_reason values ('start_up', 'Start-up'), ('relocation', 'Relocation');
insert into deal (id, name, kind, reason, owner_user_id) values
	('${DEAL}', 'Example Dental Springfield Deal', 'lease', 'relocation', '${USER}'),
	('${LENDER_DEAL}', 'Example Loan Deal', null, null, '${TEAMMATE}');
insert into deal_property values ('${DEAL}', '${PROPERTY}');
insert into deal_party values ('${DEAL}', '${CLIENT}', 'client'), ('${DEAL}', '${AGENT}', 'listing_agent');
insert into deal_phase_change values
	('${DEAL}', '2026-03-02T15:00:00+00:00', 'negotiation', null),
	('${DEAL}', '2026-03-20T15:00:00+00:00', 'legal', 'LOI accepted');
insert into activity (id, kind, happened_at, from_party_id, summary) values
	('${EMAIL}', 'email', '2026-03-09T14:00:00+00:00', '${AGENT}', null),
	('${CALL}', 'call', '2026-03-10T16:00:00+00:00', '${CLIENT}', 'Example asks for a shorter term'),
	('${NOTE}', 'note', '2026-03-11T16:00:00+00:00', null, 'Example prefers mornings');
insert into email (activity_id, message_id, sender, subject, body) values
	('${EMAIL}', '<counter-2@example.com>', 'avery@example.com', 'Counter to your LOI', 'Our counter is attached.');
insert into activity_about (activity_id, deal_id, party_id) values
	('${EMAIL}', '${DEAL}', null), ('${EMAIL}', null, '${AGENT}'),
	('${CALL}', '${DEAL}', null), ('${NOTE}', null, '${CLIENT}');
insert into next_step (id, what, owner_party_id, due_on, done_at, deal_id, party_id) values
	('${id(400)}', 'Start the lease draft', null, '2026-03-20', null, '${DEAL}', null),
	('${id(401)}', 'Send the signed LOI', '${CLIENT}', '2026-03-13', '2026-03-13T18:00:00+00:00', '${DEAL}', null),
	('${id(402)}', 'Ask about a second location', null, null, null, null, '${CLIENT}');
`;
const phases = [
	{
		happened_at: "2026-03-02T15:00:00+00:00",
		phase: "negotiation",
		reason: null,
	},
	{
		happened_at: "2026-03-20T15:00:00+00:00",
		phase: "legal",
		reason: "LOI accepted",
	},
];

// Our LOI, the landlord's counter, our response, and their acceptance of it.
// biome-ignore format: one row per round
const ROUNDS = [
	["client", CLIENT, "2026-03-02", "countered", 32, 9, 60, 40, 3, "2026-07-01", null, null],
	["listing_agent", AGENT, "2026-03-09", "countered", 34.5, 9.5, 84, 25, 2, null, 90, null],
	["client", CLIENT, "2026-03-12", "accepted", 33.5, 9.5, 84, 30, 2, null, 90, "Example exclusive use"],
] as const;
const rounds = ROUNDS.map(
	(
		[
			from_role,
			from_party_id,
			day,
			status,
			rent,
			nnn,
			term,
			ti,
			free,
			start,
			days,
			other,
		],
		i,
	) => ({
		id: id(100 + i),
		property_id: PROPERTY,
		round: i + 1,
		answers_round: i || null,
		from_party_id,
		from_role,
		offered_at: `${day}T15:00:00+00:00`,
		status,
		expires_on: null,
		rent_per_sf_yr: rent,
		nnn_per_sf_yr: nnn,
		term_months: term,
		ti_per_sf: ti,
		free_rent_months: free,
		escalation_pct: 3,
		commencement_on: start,
		commencement_days_after_delivery: days,
		other_terms: other,
		documents: [
			{
				id: id(200 + i),
				name: `LOI round ${i + 1}.pdf`,
				r2_key: `example/loi-${i + 1}.pdf`,
				content_type: null,
				// The counter arrived as an attachment to the agent's email.
				email_activity_id: i === 1 ? EMAIL : null,
			},
		],
	}),
);

const offer = (
	round: number,
	answers: number,
	from: string,
	role: string,
	terms: Record<string, string | number> = {},
) => {
	const row = { property_id: PROPERTY, rent_per_sf_yr: 30, ...terms };
	return `insert into offer (deal_id, round, answers_round, from_party_id, from_role, offered_at, ${Object.keys(row)})
	values ('${DEAL}', ${round}, ${answers}, '${from}', '${role}', now(), ${Object.values(row).map((value) => `'${value}'`)})`;
};
const NEXT_ROUND = offer(4, 3, AGENT, "listing_agent");
// Runs the checks commit would run, inside a transaction the test still rolls back.
// Later statements in the transaction are then checked as they run.
const CHECK_AT_COMMIT = "set constraints all immediate";
const newEmail = (activity: string, messageId = `<${activity}@example.com>`) =>
	`insert into activity (id, kind, happened_at) values ('${activity}', 'email', now());
	insert into email (activity_id, message_id, sender, subject, body)
	values ('${activity}', '${messageId}', 'avery@example.com', 'Example', 'Example')`;
const TERMS = [
	"rent_per_sf_yr",
	"nnn_per_sf_yr",
	"term_months",
	"ti_per_sf",
	"free_rent_months",
	"escalation_pct",
	"commencement_days_after_delivery",
];

// Only the owner adds users.
const USERS = `insert into party (id, kind, name) values
	('${USER}', 'person', 'Jordan Example'), ('${TEAMMATE}', 'person', 'Riley Example');
insert into app_user (id) values ('${USER}'), ('${TEAMMATE}')`;
const asUser = (user: string) =>
	`select set_config('engine.user_id', '${user}', true), set_config('engine.job', '', true)`;
const asJob = (job: string, forUser = "") =>
	`select set_config('engine.user_id', '${forUser}', true), set_config('engine.job', '${job}', true)`;
// The agent's duplicate, and an older duplicate of that one.
const DUPLICATE = id(13);
const OLD = id(14);
const MERGED = `insert into party (id, kind, name) values
	('${DUPLICATE}', 'person', 'A. Example'), ('${OLD}', 'person', 'Avery E. Example');
select merge_party('${DUPLICATE}', '${AGENT}')`;
const LINKEDIN = id(500);
const X = id(501);
const INSTAGRAM = id(502);
const RENT_IDEA = id(510);
const CHECKLIST_IDEA = id(511);
const STAT_CARD = id(520);
const PHOTO = id(521);
const post = (n: number) => id(530 + n);
const PHOTO_FILE = id(540);
const PDF_FILE = id(541);
// Review closes an hour before a post's time, judged by the real clock.
const OPEN = post(13);
const CLOSED = post(14);
const ENGINE_FROM = "2026-06-08T05:00:00+00:00";
const POST_ROWS = [
	[1, LINKEDIN, RENT_IDEA, STAT_CARD, "2026-06-01", "published"],
	[2, LINKEDIN, CHECKLIST_IDEA, PHOTO, "2026-06-03", "published"],
	[3, LINKEDIN, RENT_IDEA, PHOTO, "2026-06-05", "published"],
	[4, X, CHECKLIST_IDEA, STAT_CARD, "2026-06-02", "published"],
	[5, X, RENT_IDEA, null, "2026-06-20", "published"],
	[6, X, CHECKLIST_IDEA, null, "2026-06-04", "published"],
	[7, X, RENT_IDEA, STAT_CARD, "2026-06-06", "failed"],
	[8, LINKEDIN, CHECKLIST_IDEA, PHOTO, "2026-06-30", "scheduled"],
	[9, INSTAGRAM, CHECKLIST_IDEA, PHOTO, "2026-06-07", "published"],
	[10, INSTAGRAM, RENT_IDEA, STAT_CARD, "2026-06-08", "published"],
] as const;
// Hours after publishing and the numbers read then; null was not measured.
const READINGS: [number, number, Record<string, number | null>][] = [
	[1, 48, { views: 500, reactions: 10, comments: 2, shares: 1 }],
	[1, 168, { views: 1000, reactions: 30, comments: 10, shares: 10 }],
	[1, 336, { views: 2000, reactions: 100, comments: 20, shares: 10 }],
	[2, 168, { views: 1000, reactions: 40, comments: 20, shares: 10, clicks: 3 }],
	[3, 48, { views: 1000, reactions: 20, comments: 5, shares: 2 }],
	[3, 168, { views: 2000, reactions: null, comments: 10, shares: 5 }],
	[4, 160, { views: 500 }],
	[4, 166, { reactions: 10, comments: 5, shares: 5 }],
	[5, 72, { views: 800, reactions: 40, comments: 0, shares: 0 }],
	[6, 168, { views: 0, reactions: 0, comments: 0, shares: 0 }],
	[9, 168, { views: 1000, reactions: 50, comments: 10, shares: 5, saves: 25 }],
	[10, 168, { views: 1000, reactions: 10, comments: 0, shares: 0 }],
];
const MARKETING_SEED = `
insert into social_account (id, platform, owner_party_id, handle, platform_account_id) values
	('${LINKEDIN}', 'linkedin', '${USER}', 'jordan-example', 'example-person-1'),
	('${X}', 'x', '${USER}', 'jordanexample', null), ('${INSTAGRAM}', 'instagram', '${USER}', 'jordan.example', null);
-- Only the owner sets when the engine starts publishing for an account.
set role none;
update social_account set engine_publishes_from = '${ENGINE_FROM}' where id = '${LINKEDIN}';
set role engine;
insert into social_sign_in values ('${LINKEDIN}', 'example-person-1', '${USER}',
	'2026-06-01T15:00:00+00:00', '2026-07-31T15:00:00+00:00', '{openid,profile,w_member_social}');
insert into idea (id, angle, hook, pillar) values
	('${RENT_IDEA}', 'Example rents rose this year', 'number', 'local_market'),
	('${CHECKLIST_IDEA}', 'Five example lease questions', 'checklist', 'education');
insert into design_template (id, name) values ('${STAT_CARD}', 'Example stat card'), ('${PHOTO}', 'Example photo backdrop');
insert into post (id, social_account_id, platform, format, idea_id, design_template_id, scheduled_at, status, reason,
	platform_post_id, published_at)
values ${POST_ROWS.map(
	([n, account, idea, template, day, status]) =>
		`('${post(n)}', '${account}', (select platform from social_account where id = '${account}'),
		'${template ? "photo" : "text"}', '${idea}', ${template && `'${template}'`}, '${day}T15:00:00+00:00', '${status}',
		${status === "failed" ? "'Example: the platform refused it'" : "null"}, ${
			status === "published"
				? `'example-${n}', '${day}T15:00:00+00:00'`
				: "null, null"
		})`,
)};
insert into document (id, name, r2_key, content_type) values
	('${PHOTO_FILE}', 'Example photo.jpg', '${PHOTO_FILE}', 'image/jpeg'),
	('${PDF_FILE}', 'Example carousel.pdf', '${PDF_FILE}', 'application/pdf');
insert into post_media (post_id, format, position, document_id, content_type)
values ('${post(8)}', 'photo', 1, '${PHOTO_FILE}', 'image/jpeg');
insert into post (id, social_account_id, platform, format, scheduled_at) values
	('${OPEN}', '${LINKEDIN}', 'linkedin', 'photo', now() + interval '2 hours'),
	('${CLOSED}', '${LINKEDIN}', 'linkedin', 'photo', now() + interval '30 minutes');
insert into post_text (post_id, version, body) values ('${OPEN}', 1, 'Five example lease questions');
insert into measurement (post_id, platform, metric, taken_at, source, value, not_measured_reason)
select p.id, p.platform, r.metric, p.published_at + make_interval(hours => r.hours), 'example_source', r.value,
	case when r.value is null then 'Example: no number came back' end
from post p join (values ${READINGS.flatMap(([n, hours, values]) =>
	Object.entries(values).map(
		([metric, value]) =>
			`('${post(n)}'::uuid, ${hours}, '${metric}', ${value}::bigint)`,
	),
)}) r (post_id, hours, metric, value) on r.post_id = p.id;
`;
// Made-up places: states 90 and 91 are unassigned FIPS codes, and the base is open ocean.
const TERRITORY_SEED = `
insert into party (id, kind, name) values ('${VENDOR}', 'company', 'Example Title Company');
insert into market (id, name) values ('${BAY}', 'Example Bay');
insert into market_county values ('${BAY}', '90001'), ('${BAY}', '90003');
insert into territory (id, name) values ('${HOME}', 'Example home turf'), ('${STATEWIDE}', 'Example State');
insert into territory_piece (territory_id, state_fips, market_id, base_latitude, base_longitude, miles) values
	('${HOME}', null, '${BAY}', null, null, null), ('${HOME}', null, null, 10, -150, 60),
	('${STATEWIDE}', '91', null, null, null, null);
update deal set market_id = '${BAY}' where id = '${DEAL}';
insert into party_territory (party_id, territory_id, started_on, ended_on) values
	('${USER}', '${HOME}', '2024-01-01', null),
	('${VENDOR}', '${HOME}', '2024-01-01', '2025-06-30'), ('${VENDOR}', '${STATEWIDE}', '2025-07-01', null);
-- A degree of latitude is about 69 miles: the second is also 14 miles from the base, the third 35 and the fourth 69.
insert into property (id, address, county_fips, latitude, longitude) values
	('${IN_STATE}', '1 Example Road', '91005', null, null), ('${IN_MARKET}', '2 Example Road', '90003', 10.2, -150),
	('${IN_REACH}', '3 Example Road', null, 10.5, -150), ('${OUTSIDE}', '4 Example Road', '90007', 11, -150);
`;
const VENDOR_SEED = `
insert into stage values ('vendor', 'warm', 'Example warm'), ('client', 'warm', 'Example warm client');
insert into party_role (party_id, role, stage, relationship_level) values
	('${VENDOR}', 'vendor', 'warm', 1), ('${VENDOR}', 'title', null, null);
insert into introduction (id, vendor_id, made_by, introduced_party_id, introduced_on, deal_id) values
	('${INTRODUCTION}', '${VENDOR}', 'vendor', '${CLIENT}', '2026-02-02', '${DEAL}');
`;
const LEAD_SEED = `
insert into stage values
	('lead', 'new', 'New'), ('lead', 'engaged', 'Engaged'), ('lead', 'nurture', 'Nurture'), ('lead', 'opportunity', 'Opportunity');
insert into party (id, kind, name, how_found) values ('${LEAD}', 'person', 'Dr. Example Lead', 'public_records');
insert into party_role (party_id, role, stage, owner_user_id) values ('${LEAD}', 'lead', 'nurture', '${TEAMMATE}');
`;
const newIntroduction = (row: Record<string, string | null>) =>
	insert("introduction", {
		vendor_id: VENDOR,
		made_by: "team",
		introduced_by_user_id: USER,
		introduced_party_id: CLIENT,
		...row,
	});
const insert = (table: string, row: Record<string, string | number | null>) =>
	`insert into ${table} (${Object.keys(row)}) values (${Object.values(row).map(
		(value) => (value === null ? "null" : `'${value}'`),
	)})`;
const newPost = (row: Record<string, string>) =>
	insert("post", {
		social_account_id: LINKEDIN,
		platform: "linkedin",
		format: "photo",
		scheduled_at: "2026-06-09",
		...row,
	});
const PUBLISHED = {
	status: "published",
	platform_post_id: "example-new",
	published_at: "2026-06-09",
};
const newReading = (row: Record<string, string | number | null>) =>
	insert("measurement", {
		post_id: post(1),
		platform: "linkedin",
		metric: "views",
		taken_at: "2026-06-20T15:00:00+00:00",
		source: "example_source",
		value: 1,
		not_measured_reason: null,
		...row,
	});
const NEW_ACCOUNT = `insert into social_account (id, platform, owner_party_id, handle)
	values ('${id(503)}', 'facebook', '${USER}', 'example-page')`;
const CLAIM = `update post set status = 'publishing' where id = '${post(8)}'`;
const newText = (row: Record<string, string | number | null>) =>
	insert("post_text", {
		post_id: OPEN,
		version: 2,
		body: "Six example lease questions",
		...row,
	});
const newMedium = (row: Record<string, string | number>) =>
	insert("post_media", {
		post_id: post(8),
		format: "photo",
		position: 1,
		document_id: PHOTO_FILE,
		content_type: "image/jpeg",
		...row,
	});
const newReview = (row: Record<string, string | number | null>) =>
	insert("post_review", { post_id: OPEN, ...row });
const EDITED = `${newText({})}; ${newReview({ outcome: "edited", text_version: 2 })}`;
const NO_RESPONSE = { post_id: CLOSED, outcome: "no_response" };
const noResponse = (row: Record<string, string> = {}) =>
	`${asJob("review_close")}; ${newReview({ ...NO_RESPONSE, ...row })}`;
const cancel = (post: string) =>
	`update post set status = 'cancelled', reason = 'Example: the rent number changed' where id = '${post}'`;
const newSignIn = (row: Record<string, string>) =>
	insert("social_sign_in", {
		social_account_id: LINKEDIN,
		platform_account_id: "example-person-1",
		signed_in_by_user_id: USER,
		signed_in_at: "2026-07-30T15:00:00+00:00",
		expires_at: "2026-09-28T15:00:00+00:00",
		scopes: "{w_member_social}",
		...row,
	});
const NOT_MEASURED = {
	value: null,
	not_measured_reason: "Example: no number came back",
};
const DAY_7 = "2026-06-25T00:00:00+00:00";
// Per account: how many posts compared, then the best and the worst.
const compared = async (client = db) =>
	(
		await client.query("select posts_at_day_7($1) as read", [DAY_7])
	).rows[0].read.accounts.map(
		(account: {
			platform: string;
			posts: number;
			best: { id: string };
			worst: { id: string };
		}) => [account.platform, account.posts, account.best.id, account.worst.id],
	);

// Every table whose rows a user or a job adds or changes.
const STAMPED = [
	"lead_contact_draft",
	"client_type",
	"client",
	"national_account",
	"client_brand",
	"national_account_owner",
	"role",
	"stage",
	"phase",
	"deal_kind",
	"deal_reason",
	"how_found",
	"party",
	"merged_party",
	"party_email",
	"party_phone",
	"party_role",
	"party_company",
	"do_not_contact",
	"specialty",
	"party_specialty",
	"outside_id",
	"property",
	"market",
	"market_county",
	"territory",
	"territory_piece",
	"party_territory",
	"deal",
	"introduction",
	"deal_phase_change",
	"deal_property",
	"deal_party",
	"activity",
	"activity_about",
	"next_step",
	"document",
	"email",
	"offer",
	"offer_document",
	"lease",
	"lease_option",
	"critical_date",
	"social_account",
	"idea",
	"design_template",
	"post",
	"post_text",
	"post_media",
	"post_review",
	"measurement",
	"change",
];
const newAddress = (row: Record<string, string>) =>
	insert("party_email", {
		party_id: AGENT,
		address: "avery@example.com",
		label: "work",
		...row,
	});
const piece = (row: Record<string, string | number>) =>
	insert("territory_piece", { territory_id: HOME, ...row });
const newPhone = (row: Record<string, string | null>) =>
	insert("party_phone", {
		party_id: AGENT,
		number: "+12175550100",
		extension: null,
		label: "work",
		...row,
	});

// The engine's role lacks the privilege, so PostgreSQL refuses before any row is touched.
const notGranted = (table: string) => ({
	code: "42501",
	message: `permission denied for table ${table}`,
});
const STORED_AT = [
	"lead_contact_draft",
	"client",
	"national_account",
	"client_brand",
	"national_account_owner",
	"party",
	"party_email",
	"party_phone",
	"do_not_contact",
	"party_specialty",
	"property",
	"market",
	"market_county",
	"territory",
	"territory_piece",
	"party_territory",
	"deal",
	"party_role",
	"party_company",
	"deal_property",
	"deal_party",
	"activity_about",
	"offer_document",
	"next_step",
	"document",
	"social_account",
	"idea",
	"design_template",
	"post_media",
	"introduction",
];

// A constraint's name, or the error PostgreSQL raises.
type Refusal = string | { code?: string; message: string };
const expected = (refusal: Refusal) =>
	typeof refusal === "string" ? { constraint: refusal } : refusal;

const SCHEMA = await readFile(
	new URL("../schema/next.sql", import.meta.url),
	"utf8",
);

type Case = [sql: string, refusal: Refusal];
const LEASE = id(700);
const newLease = (row: Record<string, string | number | null> = {}) =>
	insert("lease", {
		id: LEASE,
		deal_id: DEAL,
		property_id: PROPERTY,
		version: 1,
		offer_id: id(102),
		document_id: PDF_FILE,
		executed_on: "2026-04-01",
		commencement_on: "2026-07-01",
		expiration_on: "2033-06-30",
		...row,
	});
const newOption = (row: Record<string, string | number | null> = {}) =>
	insert("lease_option", {
		lease_id: LEASE,
		number: 1,
		kind: "renewal",
		notice_on: "2032-12-31",
		terms: "Example five-year renewal",
		...row,
	});
const DATE = id(710);
const newCriticalDate = (row: Record<string, string | null> = {}) =>
	insert("critical_date", {
		id: DATE,
		deal_id: DEAL,
		kind: "due_diligence",
		due_on: "2026-06-01",
		source: "Example signed agreement",
		...row,
	});
const DRAFT = id(740);
const newLeadDraft = (row: Record<string, string | null> = {}) =>
	insert("lead_contact_draft", {
		id: DRAFT,
		party_id: LEAD,
		owner_user_id: USER,
		subject: "Example space plans",
		body: "Example first contact",
		scheduled_for: "2030-01-01T12:00:00Z",
		time_zone: "UTC",
		...row,
	});
const RULES: Record<string, Case[]> = {
	"critical dates start proposed and only a user confirms or resolves them": [
		[newCriticalDate({ status: "open" }), "critical_date_starts_proposed"],
		[
			newCriticalDate({ confirmed_by_user_id: USER }),
			"critical_date_starts_proposed",
		],
		[newCriticalDate({ kind: "unknown" }), "critical_date_kind_check"],
		[newCriticalDate({ source: " " }), "critical_date_source_check"],
		[
			newCriticalDate({ offer_id: id(102), document_id: PDF_FILE }),
			"critical_date_one_source",
		],
		[newCriticalDate({ option_number: "1" }), "critical_date_option_on_lease"],
		[
			`${newLease()}; ${newCriticalDate({ lease_id: LEASE, deal_id: LENDER_DEAL })}`,
			"critical_date_lease_id_deal_id_fkey",
		],
		[
			`${newLease()}; ${newCriticalDate({ lease_id: LEASE, option_number: "1" })}`,
			"critical_date_lease_id_option_number_fkey",
		],
		[
			`${newCriticalDate()}; update critical_date set status = 'open'; ${asJob("agent", USER)}; update critical_date set status = 'done', resolution_reason = 'Example completed'`,
			"critical_date_user_decides",
		],
		[newCriticalDate({ deal_id: MISSING }), "critical_date_deal_id_fkey"],
		[
			newCriticalDate({ offer_id: id(102), deal_id: LENDER_DEAL }),
			"critical_date_offer_id_deal_id_fkey",
		],
		[
			`${newCriticalDate()}; ${asJob("agent", USER)}; update critical_date set status = 'open'`,
			"critical_date_user_decides",
		],
		[
			`${newCriticalDate()}; update critical_date set status = 'done', resolution_reason = 'Example completed'`,
			"critical_date_status_moves",
		],
		[
			`${newCriticalDate()}; update critical_date set status = 'open'; update critical_date set status = 'done'`,
			"critical_date_resolution_whole",
		],
		[
			`${newCriticalDate()}; update critical_date set status = 'open'; update critical_date set status = 'done', resolution_reason = 'Example completed';
			update critical_date set status = 'open'`,
			"critical_date_status_moves",
		],
		[
			"update critical_date set confirmed_at = now()",
			notGranted("critical_date"),
		],
		[
			"update critical_date set due_on = current_date",
			notGranted("critical_date"),
		],
		["delete from critical_date", notGranted("critical_date")],
	],
	"leases preserve sourced terms and a consecutive history on their deal": [
		[newLease({ version: 0 }), "lease_version_check"],
		[newLease({ version: 2 }), "lease_deal_id_previous_version_fkey"],
		[
			newLease({ property_id: ELSEWHERE, offer_id: null }),
			"lease_deal_id_property_id_fkey",
		],
		[newLease({ document_id: MISSING }), "lease_document_id_fkey"],
		[
			newLease({ document_id: null }),
			{
				code: "23502",
				message:
					'null value in column "document_id" of relation "lease" violates not-null constraint',
			},
		],
		[newLease({ offer_id: id(100) }), "lease_from_accepted_offer"],
		[
			`${newLease()}; insert into deal_property values ('${DEAL}', '${ELSEWHERE}');
			${newLease({ id: id(701), version: 2, property_id: ELSEWHERE })}`,
			"lease_offer_id_deal_id_property_id_fkey",
		],
		[
			`${newLease()}; ${newLease({ id: id(701) })}`,
			"lease_deal_id_version_key",
		],
		...[
			"rent_per_sf_yr",
			"nnn_per_sf_yr",
			"ti_per_sf",
			"free_rent_months",
			"escalation_pct",
			"rent_days_after_delivery",
		].map((field): Case => [newLease({ [field]: -1 }), `lease_${field}_check`]),
		[newLease({ term_months: 0 }), "lease_term_months_check"],
		[newLease({ expiration_on: "2026-07-01" }), "lease_dates_in_order"],
		[newLease({ executed_on: "2034-01-01" }), "lease_dates_in_order"],
		[
			newLease({ rent_starts_on: "2026-07-01", rent_days_after_delivery: 30 }),
			"lease_rent_date_or_days",
		],
		[newLease({ expense_structure: " " }), "lease_expense_structure_check"],
		...[
			"update lease set version = 2",
			"delete from lease",
			"truncate lease",
		].map((sql): Case => [sql, notGranted("lease")]),
	],
	"lease options have a kind, exact notice deadline and terms, and remain history":
		[
			[newOption(), "lease_option_lease_id_fkey"],
			[
				`${newLease()}; ${newOption({ notice_on: "2040-01-01" })}`,
				"lease_option_before_expiration",
			],
			[
				`${newLease()}; ${newOption({ kind: "other" })}`,
				"lease_option_kind_check",
			],
			[
				`${newLease()}; ${newOption({ number: 0 })}`,
				"lease_option_number_check",
			],
			[
				`${newLease()}; ${newOption({ terms: " " })}`,
				"lease_option_terms_check",
			],
			[`${newLease()}; ${newOption()}; ${newOption()}`, "lease_option_pkey"],
			[
				`${newLease()}; ${newOption({ notice_on: null })}`,
				{
					code: "23502",
					message:
						'null value in column "notice_on" of relation "lease_option" violates not-null constraint',
				},
			],
			...[
				"update lease_option set notice_on = current_date",
				"delete from lease_option",
				"truncate lease_option",
			].map((sql): Case => [sql, notGranted("lease_option")]),
		],
	"a link to a record that does not exist is refused": [
		[
			`insert into deal_party values ('${DEAL}', '${MISSING}', 'client')`,
			"deal_party_party_id_fkey",
		],
		[newPost({ idea_id: MISSING }), "post_idea_id_fkey"],
		[`delete from party where id = '${AGENT}'`, "party_role_party_id_fkey"],
	],
	"the role list refuses a role it does not hold": [
		[
			`insert into party_role values ('${AGENT}', 'mayor')`,
			"party_role_role_fkey",
		],
		[
			`insert into deal_party values ('${DEAL}', '${AGENT}', 'mayor')`,
			"deal_party_role_fkey",
		],
	],
	"the same link is stored once": [
		[
			`insert into deal_party values ('${DEAL}', '${AGENT}', 'listing_agent')`,
			"deal_party_pkey",
		],
	],
	"a person or company has a known kind": [
		[
			"insert into party (kind, name) values ('household', 'Example')",
			"party_kind_check",
		],
	],
	"an NPI is ten digits ending in its check digit, and is held by one person or company":
		[
			...[
				"900000001",
				"90000000150",
				"9000000016",
				"900000001x",
				" 900000001",
				"9000000015\n",
			].map(
				(npi): Case => [
					`update party set npi = '${npi}' where id = '${AGENT}'`,
					"npi_shape",
				],
			),
			[
				`update party set npi = '${NPIS[0]}' where id = '${AGENT}'`,
				"party_npi_key",
			],
		],
	"a specialty is a person's, from the specialty list, each once": [
		[
			`insert into party_specialty (person_id, specialty) values ('${CLIENT}', 'orthodontics')`,
			"party_specialty_person_id_person_kind_fkey",
		],
		[
			`insert into party_specialty (person_id, specialty) values ('${DOCTOR}', 'podiatry')`,
			"party_specialty_specialty_fkey",
		],
		[
			`insert into party_specialty (person_id, specialty) values ('${DOCTOR}', 'general_dentistry')`,
			"party_specialty_pkey",
		],
	],
	"do not contact is set once per person or company, with a reason that never changes":
		[
			[
				`insert into do_not_contact (party_id, reason) values ('${MISSING}', 'Example')`,
				"do_not_contact_party_id_fkey",
			],
			[
				`insert into do_not_contact (party_id, reason) values ('${CLIENT}', ' \t')`,
				"do_not_contact_reason_check",
			],
			[
				`insert into do_not_contact (party_id, reason) values ('${AGENT}', 'Example')`,
				"do_not_contact_pkey",
			],
			[
				"update do_not_contact set reason = 'Example'",
				notGranted("do_not_contact"),
			],
		],
	"an outside id is import history for one person, company or deal, once per source":
		[
			...[`'${CLIENT}', '${DEAL}'`, "null, null"].map(
				(records): Case => [
					`insert into outside_id (source, value, party_id, deal_id) values ('salesforce', 'a0EXAMPLE0000002', ${records})`,
					"outside_id_one_record",
				],
			),
			[
				`insert into outside_id (source, value, deal_id) values ('salesforce', 'a0EXAMPLE0000001', '${DEAL}')`,
				"outside_id_pkey",
			],
			[
				`insert into outside_id (source, value, deal_id) values ('Sales Force', 'a0EXAMPLE0000002', '${DEAL}')`,
				"outside_id_source_check",
			],
			[
				`insert into outside_id (source, value, deal_id) values ('roster', ' 12', '${DEAL}')`,
				"outside_id_value_check",
			],
			[
				"update outside_id set value = 'a0EXAMPLE0000002'",
				notGranted("outside_id"),
			],
			["delete from outside_id", notGranted("outside_id")],
		],
	"a merge joins two live records of one kind, keeps users and refuses two NPIs":
		[
			...[
				[LENDERS[1], AGENT],
				[AGENT, AGENT],
				[OLD, DUPLICATE],
				[AGENT, DUPLICATE],
			].map(
				([from, into]): Case => [
					`${MERGED}; select merge_party('${from}', '${into}')`,
					"merge_party_two_of_a_kind",
				],
			),
			[`select merge_party('${USER}', '${AGENT}')`, "merge_party_keeps_users"],
			// A caller's own table must not stand in for the schema's.
			[
				`create temp table app_user (id uuid); select merge_party('${USER}', '${TEAMMATE}')`,
				"merge_party_keeps_users",
			],
			[
				`update party set npi = '${NPIS[2]}' where id = '${AGENT}'; select merge_party('${DOCTOR}', '${AGENT}')`,
				"merge_party_one_npi",
			],
		],
	"nothing new points at a merged-away record, and it never comes back": [
		[
			`${MERGED}; insert into party_role values ('${DUPLICATE}', 'client')`,
			"party_role_party_id_fkey",
		],
		[
			`${MERGED}; insert into party (id, kind, name) values ('${DUPLICATE}', 'person', 'Example')`,
			"party_never_merged",
		],
	],
	"a person works at a company, ending no earlier than they started, linked once":
		[
			[
				`insert into party_company (person_id, company_id) values ('${CLIENT}', '${BROKERAGES[0]}')`,
				"party_company_person_id_person_kind_fkey",
			],
			[
				`insert into party_company (person_id, company_id) values ('${AGENT}', '${AGENT}')`,
				"party_company_company_id_company_kind_fkey",
			],
			[
				`insert into party_company (person_id, company_id, started_on, ended_on)
				values ('${AGENT}', '${BROKERAGES[0]}', '2026-02-02', '2026-02-01')`,
				"party_company_check",
			],
			[
				`insert into party_company (person_id, company_id, started_on) values ('${AGENT}', '${BROKERAGES[0]}', '2020-01-06')`,
				"party_company_person_id_company_id_started_on_key",
			],
			[
				`insert into party_company (person_id, company_id)
				values ('${AGENT}', '${CLIENT}'), ('${AGENT}', '${CLIENT}')`,
				"party_company_person_id_company_id_started_on_key",
			],
		],
	"an email is kept once per person or company, in one form, with one primary":
		[
			[newAddress({}), "party_email_address_party_id_key"],
			...[
				"Avery@example.com",
				"Avery Example <avery@example.com>",
				"avery@example.com, avery@example.net",
				"avery @example.com",
				"avery@example",
				"avery\u00a0@example.com",
				"avery\u200b@example.com",
			].map(
				(address): Case => [newAddress({ address }), "email_address_shape"],
			),
			[
				newAddress({ address: "avery@example.org", label: "mobile" }),
				"party_email_label_check",
			],
			[
				newAddress({ address: "avery@example.org", is_primary: "true" }),
				"party_email_one_primary",
			],
			[
				`insert into activity (id, kind, happened_at) values ('${id(303)}', 'email', now());
				insert into email (activity_id, message_id, sender, subject, body)
				values ('${id(303)}', '<sender@example.com>', 'Avery@Example.com', 'Example', 'Example')`,
				"email_address_shape",
			],
		],
	"a phone number is kept once per person or company, in one form, with one primary":
		[
			[
				newPhone({ extension: "12" }),
				"party_phone_number_extension_party_id_key",
			],
			[
				newPhone({ number: "+12175550101", label: "mobile" }),
				"party_phone_number_extension_party_id_key",
			],
			...[
				"(217) 555-0100",
				"+1 217 555 0100",
				"2175550100",
				"+1217555010",
				"+12171550100",
				"+0442079460123",
			].map((number): Case => [newPhone({ number }), "phone_number_shape"]),
			[newPhone({ extension: "x12" }), "party_phone_extension_check"],
			[
				newPhone({ number: "+12175550102", label: "fax" }),
				"party_phone_label_check",
			],
			[
				newPhone({ number: "+12175550102", is_primary: "true" }),
				"party_phone_one_primary",
			],
		],
	"a deal's phase history is kept, comes from the phase list, and a dead deal says why":
		[
			[
				`insert into deal_phase_change values ('${DEAL}', now(), 'dead', null)`,
				"deal_phase_change_dead_has_reason",
			],
			[
				`insert into deal_phase_change values ('${DEAL}', now(), 'paused', null)`,
				"deal_phase_change_phase_fkey",
			],
			[
				"update deal_phase_change set reason = 'Example'",
				notGranted("deal_phase_change"),
			],
			["delete from deal_phase_change", notGranted("deal_phase_change")],
			["truncate deal_phase_change", notGranted("deal_phase_change")],
		],
	"a deal's kind and reason each come from their own list": [
		[`update deal set kind = 'sublease'`, "deal_kind_fkey"],
		[`update deal set kind = 'start_up'`, "deal_kind_fkey"],
		[`update deal set reason = 'lease'`, "deal_reason_fkey"],
	],
	"a deal has exactly one deal owner, a user": [
		[
			"insert into deal (name) values ('Example')",
			{
				code: "23502",
				message:
					'null value in column "owner_user_id" of relation "deal" violates not-null constraint',
			},
		],
		[`update deal set owner_user_id = '${CLIENT}'`, "deal_owner_user_id_fkey"],
	],
	"a deal's market comes from the market list, and its closed value is more than zero":
		[
			[`update deal set market_id = '${MISSING}'`, "deal_market_id_fkey"],
			["update deal set closed_value = 0", "deal_closed_value_check"],
		],
	"a parked deal says why, and only a parked deal has a note, never blank": [
		["update deal set parking_reason = 'on_hold'", "deal_parking_reason_check"],
		[
			"update deal set parking_note = 'Example note'",
			"deal_parking_note_when_parked",
		],
		[
			"update deal set parking_reason = 'other', parking_note = ' '",
			"deal_parking_note_check",
		],
	],
	"a job alone never parks, revives or flags a deal": [
		[
			`${asJob("mail_capture")}; update deal set parking_reason = 'other'`,
			"deal_parked_or_flagged_by_a_user",
		],
		[
			`${asJob("mail_capture")}; update deal set needs_attention = true`,
			"deal_parked_or_flagged_by_a_user",
		],
		[
			`${asJob("old_system")}; insert into deal (name, owner_user_id, parking_reason) values ('Example', '${USER}', 'other')`,
			"deal_parked_or_flagged_by_a_user",
		],
	],
	"a deal needs attention or not, never unknown": [
		[
			"update deal set needs_attention = null",
			{
				code: "23502",
				message:
					'null value in column "needs_attention" of relation "deal" violates not-null constraint',
			},
		],
	],
	"a round number is used once per deal and answers an earlier round": [
		[offer(3, 2, AGENT, "listing_agent"), "offer_deal_id_round_key"],
		[offer(4, 4, AGENT, "listing_agent"), "offer_answers_earlier_round"],
		[offer(9, 8, AGENT, "listing_agent"), "offer_deal_id_answers_round_fkey"],
	],
	"a round comes from someone on the deal about a property it is considering": [
		[
			offer(4, 3, CLIENT, "listing_agent"),
			"offer_deal_id_from_party_id_from_role_fkey",
		],
		[
			offer(4, 3, AGENT, "listing_agent", { property_id: ELSEWHERE }),
			"offer_deal_id_property_id_fkey",
		],
	],
	"a round's terms are never negative": TERMS.map((term) => [
		offer(4, 3, AGENT, "listing_agent", { [term]: -1 }),
		`offer_${term}_check`,
	]),
	"rent starts on a date or a number of days after delivery, never both": [
		[
			offer(4, 3, AGENT, "listing_agent", {
				commencement_on: "2026-09-01",
				commencement_days_after_delivery: 90,
			}),
			"offer_commencement_date_or_days",
		],
	],
	"an activity is an email, call, meeting or note, and each about link names one record once":
		[
			[
				"insert into activity (kind, happened_at) values ('fax', now())",
				"activity_kind_check",
			],
			[
				`insert into activity_about (activity_id, deal_id, party_id) values ('${CALL}', '${DEAL}', '${CLIENT}')`,
				"activity_about_one_record",
			],
			[
				`insert into activity_about (activity_id) values ('${CALL}')`,
				"activity_about_one_record",
			],
			[
				`insert into activity_about (activity_id, deal_id) values ('${CALL}', '${DEAL}')`,
				"activity_about_activity_id_deal_id_party_id_property_id_key",
			],
		],
	"an email is stored once, belongs to an email activity, and is about a record":
		[
			[newEmail(id(303), "<counter-2@example.com>"), "email_message_id_key"],
			[newEmail(id(303), " <padded@example.com>"), "email_message_id_check"],
			[
				`insert into email (activity_id, message_id, sender, subject, body)
				values ('${CALL}', '<call@example.com>', 'avery@example.com', 'Example', 'Example')`,
				"email_activity_id_activity_kind_fkey",
			],
			[
				`insert into document (name, r2_key, email_activity_id) values ('Example.pdf', 'example/x.pdf', '${CALL}')`,
				"document_email_activity_id_fkey",
			],
			[`${newEmail(id(303))}; ${CHECK_AT_COMMIT}`, "email_about_a_record"],
			[
				`delete from activity_about where activity_id = '${EMAIL}'; ${CHECK_AT_COMMIT}`,
				"email_about_a_record",
			],
			["truncate activity_about", notGranted("activity_about")],
			[
				`update activity_about set activity_id = '${CALL}' where activity_id = '${EMAIL}'`,
				notGranted("activity_about"),
			],
			[`update email set activity_id = '${CALL}'`, notGranted("email")],
		],
	"a next step is about exactly one record": [
		[
			`insert into next_step (what, deal_id, party_id) values ('Example', '${DEAL}', '${CLIENT}')`,
			"next_step_one_record",
		],
		["insert into next_step (what) values ('Example')", "next_step_one_record"],
	],
	"a change names the user or the job that made it": [
		[
			`${asUser("")}; insert into deal (name) values ('Example')`,
			"change_names_who_made_it",
		],
		[
			`${asUser("")}; update deal set name = 'Example'`,
			"change_names_who_made_it",
		],
		[
			`${asJob("mailroom")}; update deal set name = 'Example'`,
			"deal_changed_by_job_fkey",
		],
		[
			`${asJob("mail_capture", CLIENT)}; update deal set name = 'Example'`,
			"deal_changed_for_user_id_fkey",
		],
		["insert into job values ('mailroom', 'Example')", notGranted("job")],
		[
			`${asUser(CLIENT)}; update deal set name = 'Example'`,
			"deal_changed_by_user_id_fkey",
		],
		[
			`${asUser(AGENT)}; insert into party (kind, name) values ('person', 'Example'); ${CHECK_AT_COMMIT}`,
			"party_changed_by_user_id_fkey",
		],
		[`insert into app_user (id) values ('${AGENT}')`, notGranted("app_user")],
	],
	"a round is never rewritten or removed, and one round per deal is accepted": [
		[
			"update offer set rent_per_sf_yr = 30 where round = 1",
			notGranted("offer"),
		],
		["delete from offer where round = 3", notGranted("offer")],
		["truncate offer cascade", notGranted("offer")],
		[
			`delete from offer_document where document_id = '${id(200)}'`,
			notGranted("offer_document"),
		],
		[
			`${NEXT_ROUND}; update offer set status = 'accepted' where round = 4`,
			"offer_one_accepted_per_deal",
		],
	],
	"a round's status moves only out of open, or from accepted to superseded": [
		[
			"update offer set status = 'accepted' where round = 1",
			"offer_status_moves",
		],
		["update offer set status = 'open' where round = 3", "offer_status_moves"],
		[
			"update offer set status = 'superseded' where round = 3; update offer set status = 'accepted' where round = 3",
			"offer_status_moves",
		],
		[
			`${NEXT_ROUND}; update offer set status = 'superseded' where round = 4`,
			"offer_status_moves",
		],
	],
	"a round is superseded only when a later round of its deal is accepted": [
		[
			`update offer set status = 'superseded' where round = 3; ${CHECK_AT_COMMIT}`,
			"offer_superseded_by_later_acceptance",
		],
		[
			`update offer set status = 'superseded' where round = 3; ${NEXT_ROUND}; ${CHECK_AT_COMMIT}`,
			"offer_superseded_by_later_acceptance",
		],
		[
			`${offer(4, 3, AGENT, "listing_agent", { status: "superseded" })}; ${CHECK_AT_COMMIT}`,
			"offer_superseded_by_later_acceptance",
		],
	],
	"a social account is on a known platform, once per handle in any case": [
		[
			`insert into social_account (platform, owner_party_id, handle) values ('myspace', '${USER}', 'example')`,
			"social_account_platform_check",
		],
		[
			`insert into social_account (platform, owner_party_id, handle) values ('x', '${USER}', 'JordanExample')`,
			"social_account_one_per_handle",
		],
		[
			`insert into social_account (platform, owner_party_id, handle) values ('x', '${USER}', '\t')`,
			"social_account_handle_check",
		],
	],
	"a social account's platform id is never blank, used once per platform, and fixed once someone signed in as it":
		[
			[
				`insert into social_account (platform, owner_party_id, handle, platform_account_id)
				values ('linkedin', '${USER}', 'another-example', 'example-person-1')`,
				"social_account_platform_platform_account_id_key",
			],
			[
				`update social_account set platform_account_id = ' ' where id = '${X}'`,
				"social_account_platform_account_id_check",
			],
			[
				`update social_account set platform_account_id = 'example-person-2' where id = '${LINKEDIN}'`,
				"social_sign_in_social_account_id_platform_account_id_fkey",
			],
		],
	"a sign-in is as its account's own platform id, expires after it starts, and is never rewritten or removed":
		[
			[
				newSignIn({ platform_account_id: "example-person-2" }),
				"social_sign_in_social_account_id_platform_account_id_fkey",
			],
			[
				newSignIn({ expires_at: "2026-07-30T15:00:00+00:00" }),
				"social_sign_in_check",
			],
			[
				"update social_sign_in set expires_at = null",
				notGranted("social_sign_in"),
			],
			["delete from social_sign_in", notGranted("social_sign_in")],
		],
	"only the schema adds a platform's metrics or formats": [
		[
			"insert into platform_metric values ('x', 'saves')",
			notGranted("platform_metric"),
		],
		[
			"insert into platform_format values ('x', 'document')",
			notGranted("platform_format"),
		],
	],
	"a post's format is one its platform offers": [
		[newPost({ format: "reel" }), "post_platform_format_fkey"],
		[
			newPost({
				...PUBLISHED,
				social_account_id: INSTAGRAM,
				platform: "instagram",
				format: "document",
			}),
			"post_platform_format_fkey",
		],
	],
	"a post's status is known, only a published post has its platform id and time, and a failed or cancelled one says why":
		[
			[newPost({ platform: "x" }), "post_social_account_id_platform_fkey"],
			[newPost({ status: "removed" }), "post_status_check"],
			[newPost({ status: "publishing" }), "post_status_moves"],
			[
				newPost({ status: "cancelled", reason: "Example" }),
				"post_status_moves",
			],
			[newPost({ status: "failed" }), "post_failed_or_cancelled_says_why"],
			[newPost({ reason: "Example" }), "post_failed_or_cancelled_says_why"],
			[newPost({ status: "failed", reason: " " }), "post_reason_check"],
			[
				newPost({ status: "published", platform_post_id: "example-9" }),
				"post_published_has_id_and_time",
			],
			[
				newPost({ status: "published", published_at: "2026-06-09" }),
				"post_published_has_id_and_time",
			],
			[
				newPost({
					status: "failed",
					reason: "Example",
					platform_post_id: "example-9",
				}),
				"post_published_has_id_and_time",
			],
			[
				newPost({ ...PUBLISHED, platform_post_id: "example-1" }),
				"post_social_account_id_platform_post_id_key",
			],
		],
	"a post moves from scheduled to publishing or cancelled, and from publishing to published or failed":
		[
			[
				`update post set status = 'published', platform_post_id = 'example-8', published_at = now()
				where id = '${post(8)}'`,
				"post_status_moves",
			],
			[
				`update post set status = 'failed', reason = 'Example' where id = '${post(8)}'`,
				"post_status_moves",
			],
			[
				`${CLAIM}; update post set status = 'scheduled' where id = '${post(8)}'`,
				"post_status_moves",
			],
			[
				`${CLAIM}; update post set status = 'cancelled', reason = 'Example' where id = '${post(8)}'`,
				"post_status_moves",
			],
		],
	"the engine holds only posts scheduled from its account's engine_publishes_from, and none means never":
		[
			[
				`insert into social_account (platform, owner_party_id, handle, engine_publishes_from)
				values ('facebook', '${USER}', 'example-page', now())`,
				notGranted("social_account"),
			],
			[
				`${NEW_ACCOUNT}; delete from social_account where id = '${id(503)}'; ${NEW_ACCOUNT};
				${newPost({ social_account_id: id(503), platform: "facebook" })}`,
				"post_engine_publishes_from",
			],
			[
				newPost({ scheduled_at: "2026-06-08T04:59:59+00:00" }),
				"post_engine_publishes_from",
			],
			[
				newPost({ social_account_id: X, platform: "x" }),
				"post_engine_publishes_from",
			],
		],
	"a post is never removed, and published, failed or cancelled is final": [
		["delete from post where status = 'failed'", notGranted("post")],
		["truncate post cascade", notGranted("post")],
		[
			"update post set reason = 'Another example' where status = 'failed'",
			"post_final",
		],
		[
			`update post set status = 'cancelled', reason = 'Example' where id = '${post(8)}';
		update post set reason = 'Another example' where id = '${post(8)}'`,
			"post_final",
		],
		[`update post set status = 'failed' where id = '${post(1)}'`, "post_final"],
		[
			`update post set published_at = published_at - interval '1 day' where id = '${post(1)}'`,
			"post_final",
		],
		[
			`update post set platform_post_id = 'example-99' where id = '${post(1)}'`,
			"post_final",
		],
	],
	"a post's text is edited as the next version by a user, while it is scheduled and until review closes":
		[
			[newText({ version: 1 }), "post_text_pkey"],
			[newText({ version: 0 }), "post_text_version_check"],
			[newText({ version: 3 }), "post_text_post_id_previous_version_fkey"],
			[newText({ body: " \n" }), "post_text_body_check"],
			[`${asJob("agent")}; ${newText({})}`, "post_text_edit_by_a_user"],
			[newText({ post_id: CLOSED }), "post_text_before_review_closes"],
			[`${cancel(OPEN)}; ${newText({})}`, "post_text_before_review_closes"],
			["update post_text set body = 'Example'", notGranted("post_text")],
			["delete from post_text", notGranted("post_text")],
		],
	"a post's media fit its format, in order, are the files' own type, and never change":
		[
			[
				newMedium({ post_id: post(5), format: "text" }),
				"post_media_fits_format",
			],
			[newMedium({ position: 2 }), "post_media_fits_format"],
			[
				`${newPost({ id: post(12), format: "photo_set" })};
			${newMedium({ post_id: post(12), format: "photo_set", position: 21 })}`,
				"post_media_position_check",
			],
			[
				newMedium({
					post_id: post(1),
					format: "document",
					document_id: PDF_FILE,
					content_type: "application/pdf",
				}),
				"post_media_post_id_format_fkey",
			],
			[newMedium({}), "post_media_pkey"],
			[
				`${newPost({ id: post(12) })}; ${newMedium({ post_id: post(12), document_id: PDF_FILE })}`,
				"post_media_document_id_content_type_fkey",
			],
			[
				`${newPost({ id: post(12) })}; ${newMedium({ post_id: post(12), document_id: PDF_FILE, content_type: "application/pdf" })}`,
				"post_media_type_fits_format",
			],
			["update post_media set position = 2", notGranted("post_media")],
			["delete from post_media", notGranted("post_media")],
		],
	"a review is a user's edit or cancel before review closes, or no response alone at its close, each once":
		[
			[newReview({ outcome: "approved" }), "post_review_outcome_check"],
			[newReview({ outcome: "edited" }), "post_review_edit_names_its_text"],
			[
				newReview({ outcome: "edited", text_version: 1 }),
				"post_review_text_version_check",
			],
			[
				newReview({ outcome: "edited", text_version: 5 }),
				"post_review_post_id_text_version_fkey",
			],
			[newReview(NO_RESPONSE), "post_review_by_a_user"],
			[
				`${asJob("review_close", USER)}; ${newReview(NO_RESPONSE)}`,
				"post_review_by_a_user",
			],
			[
				`${cancel(OPEN)}; ${asJob("agent")}; ${newReview({ outcome: "cancelled" })}`,
				"post_review_by_a_user",
			],
			[
				`${cancel(CLOSED)}; ${newReview({ post_id: CLOSED, outcome: "cancelled" })}`,
				"post_review_in_window",
			],
			[noResponse({ post_id: OPEN }), "post_review_in_window"],
			[newReview({ outcome: "cancelled" }), "post_review_matches_the_post"],
			[`${cancel(CLOSED)}; ${noResponse()}`, "post_review_matches_the_post"],
			[`${noResponse()}; ${noResponse()}`, "post_review_once"],
			[
				`${EDITED}; update post_review set changed_by_user_id = null`,
				notGranted("post_review"),
			],
			[`${EDITED}; delete from post_review`, notGranted("post_review")],
		],
	"a post's edit, a review and a sign-in name a user": [
		[`${asUser(AGENT)}; ${newText({})}`, "post_text_changed_by_user_id_fkey"],
		[
			`${cancel(OPEN)}; ${asUser(AGENT)}; ${newReview({ outcome: "cancelled" })}`,
			"post_review_changed_by_user_id_fkey",
		],
		[
			newSignIn({ signed_in_by_user_id: AGENT }),
			"social_sign_in_signed_in_by_user_id_fkey",
		],
	],
	"a reading is a metric its post's platform reports, names its source, is never negative, and not measured is a reason, never a zero":
		[
			[newReading({ metric: "saves" }), "measurement_platform_metric_fkey"],
			[newReading({ platform: "x" }), "measurement_post_id_platform_fkey"],
			[newReading({ value: -1 }), "measurement_value_check"],
			[newReading({ value: null }), "measurement_value_or_reason"],
			[
				newReading({ value: 0, not_measured_reason: "Example" }),
				"measurement_value_or_reason",
			],
			[newReading({ source: "\n" }), "measurement_source_check"],
			[
				newReading({ ...NOT_MEASURED, not_measured_reason: " \t\n" }),
				"measurement_not_measured_reason_check",
			],
		],
	"a reading is of a published post, taken no earlier than it was published": [
		[newReading({ post_id: post(8) }), "measurement_after_publishing"],
		[
			newReading({ post_id: post(7), platform: "x" }),
			"measurement_after_publishing",
		],
		[
			newReading({ taken_at: "2026-06-01T14:59:59+00:00" }),
			"measurement_after_publishing",
		],
	],
	"a reading is stored once and never rewritten or removed": [
		[
			`insert into measurement select * from measurement limit 1`,
			"measurement_pkey",
		],
		["update measurement set value = 1", notGranted("measurement")],
		["delete from measurement", notGranted("measurement")],
		["truncate measurement", notGranted("measurement")],
	],
	"a territory piece is exactly one of a whole state, a named market or a distance from a base":
		[
			[piece({}), "territory_piece_one_kind"],
			[piece({ state_fips: "91", market_id: BAY }), "territory_piece_one_kind"],
			[
				piece({
					market_id: BAY,
					base_latitude: 10,
					base_longitude: -150,
					miles: 30,
				}),
				"territory_piece_one_kind",
			],
			[piece({ miles: 30 }), "territory_piece_distance_from_a_base"],
			[
				piece({ state_fips: "91", base_latitude: 10, base_longitude: -150 }),
				"territory_piece_distance_from_a_base",
			],
			[
				piece({ base_latitude: 10, base_longitude: -150, miles: 0 }),
				"territory_piece_miles_check",
			],
			[
				`insert into territory_piece (territory_id, market_id) values ('${HOME}', '${MISSING}')`,
				"territory_piece_market_id_fkey",
			],
		],
	"a state is two digits and a county five, as the Census codes them": [
		[piece({ state_fips: "XA" }), "state_fips_shape"],
		[
			`insert into market_county values ('${BAY}', '9001')`,
			"county_fips_shape",
		],
		[
			`update property set county_fips = '90 01' where id = '${IN_STATE}'`,
			"county_fips_shape",
		],
	],
	"a point is on the earth and has both its latitude and longitude": [
		[
			`update property set latitude = 91 where id = '${IN_REACH}'`,
			"latitude_range",
		],
		[
			`update property set longitude = 181 where id = '${IN_REACH}'`,
			"longitude_range",
		],
		[
			`update property set latitude = null where id = '${IN_REACH}'`,
			"property_point_whole",
		],
		[
			piece({ base_latitude: -91, base_longitude: -150, miles: 30 }),
			"latitude_range",
		],
	],
	"a market's and a territory's name is never blank, and a market's is used once":
		[
			["insert into market (name) values (' ')", "market_name_check"],
			["insert into market (name) values ('Example Bay')", "market_name_key"],
			["insert into territory (name) values ('')", "territory_name_check"],
		],
	"a market's county, a territory's piece and who serves it are each stored once":
		[
			[
				`insert into market_county values ('${BAY}', '90001')`,
				"market_county_pkey",
			],
			[
				piece({ territory_id: STATEWIDE, state_fips: "91" }),
				"territory_piece_once",
			],
			[
				`insert into party_territory (party_id, territory_id, started_on) values ('${USER}', '${HOME}', '2024-01-01')`,
				"party_territory_party_id_territory_id_started_on_key",
			],
			[
				`insert into party_territory (party_id, territory_id) values ('${VENDOR}', '${HOME}'), ('${VENDOR}', '${HOME}')`,
				"party_territory_party_id_territory_id_started_on_key",
			],
		],
	"someone serves a territory that exists, ending no earlier than they started":
		[
			[
				`update party_territory set ended_on = '2023-12-31' where party_id = '${USER}'`,
				"party_territory_check",
			],
			[
				`insert into party_territory (party_id, territory_id) values ('${VENDOR}', '${MISSING}')`,
				"party_territory_territory_id_fkey",
			],
		],
	"a stage comes from its own role's list, and is stored once": [
		[
			`update party_role set stage = 'cold' where role = 'vendor'`,
			"party_role_role_stage_fkey",
		],
		[
			`update party_role set stage = 'warm' where role = 'listing_agent'`,
			"party_role_role_stage_fkey",
		],
		[
			"insert into stage values ('mayor', 'warm', 'Example')",
			"stage_role_fkey",
		],
		["insert into stage values ('vendor', 'warm', 'Example')", "stage_pkey"],
	],
	"a relationship level is a vendor's, from the four levels, which only a schema change adds or renames":
		[
			[
				"update party_role set relationship_level = 1 where role = 'title'",
				"party_role_level_on_vendor",
			],
			[
				"update party_role set relationship_level = 4 where role = 'vendor'",
				"party_role_relationship_level_fkey",
			],
			[
				"insert into relationship_level values (4, 'Example', 'Example')",
				notGranted("relationship_level"),
			],
			[
				"update relationship_level set label = 'Example'",
				notGranted("relationship_level"),
			],
		],
	"a disposition and a target are a vendor's, and a parked or avoided vendor has a reason":
		[
			[
				"update party_role set disposition = 'retired', disposition_reason = 'Example' where role = 'vendor'",
				"party_role_disposition_check",
			],
			[
				"update party_role set disposition = 'avoid', disposition_reason = 'Example' where role = 'title'",
				"party_role_disposition_on_vendor",
			],
			[
				"update party_role set disposition = 'avoid' where role = 'vendor'",
				"party_role_ruling_has_a_reason",
			],
			[
				"update party_role set disposition_reason = 'Example' where role = 'vendor'",
				"party_role_ruling_has_a_reason",
			],
			[
				"update party_role set disposition = 'parked', disposition_reason = ' \n' where role = 'vendor'",
				"party_role_disposition_reason_check",
			],
			[
				"update party_role set disposition = 'avoid', disposition_reason = 'Example', is_target = true where role = 'vendor'",
				"party_role_avoid_not_target",
			],
			[
				"update party_role set is_target = true where role = 'title'",
				"party_role_target_on_vendor",
			],
			[
				"update party_role set is_target = null where role = 'vendor'",
				{
					code: "23502",
					message:
						'null value in column "is_target" of relation "party_role" violates not-null constraint',
				},
			],
		],
	"a vendor's category is a role, held only by a vendor, and stays a category":
		[
			[
				"insert into role values ('sba_lender', 'SBA lender', 'lender')",
				"role_category_of_check",
			],
			[
				`insert into party_role values ('${AGENT}', 'title'); ${CHECK_AT_COMMIT}`,
				"party_role_category_of_a_vendor",
			],
			[
				`insert into party_role values ('${LENDERS[0]}', 'vendor'), ('${LENDERS[0]}', 'lender');
				delete from party_role where party_id = '${LENDERS[0]}' and role = 'vendor'; ${CHECK_AT_COMMIT}`,
				"party_role_category_of_a_vendor",
			],
			[
				"update role set category_of = null where slug = 'lender'",
				notGranted("role"),
			],
		],
	"an introduction is between a vendor and someone else, made by the vendor or the team, and who it joins never changes":
		[
			[
				newIntroduction({ vendor_id: AGENT }),
				"introduction_vendor_id_vendor_role_fkey",
			],
			[
				newIntroduction({ vendor_role: "title" }),
				"introduction_vendor_role_check",
			],
			[newIntroduction({ made_by: "partner" }), "introduction_made_by_check"],
			[
				newIntroduction({ introduced_by_user_id: null }),
				"introduction_team_names_its_user",
			],
			[
				newIntroduction({ made_by: "vendor" }),
				"introduction_team_names_its_user",
			],
			[
				newIntroduction({ introduced_by_user_id: CLIENT }),
				"introduction_introduced_by_user_id_fkey",
			],
			[
				newIntroduction({ introduced_party_id: VENDOR }),
				"introduction_of_someone_else",
			],
			[
				newIntroduction({ introduced_party_id: MISSING }),
				"introduction_introduced_party_id_fkey",
			],
			[newIntroduction({ deal_id: MISSING }), "introduction_deal_id_fkey"],
			[newIntroduction({ note: " \n" }), "introduction_note_check"],
			[
				`delete from party_role where party_id = '${VENDOR}' and role = 'vendor'`,
				"introduction_vendor_id_vendor_role_fkey",
			],
			[
				`update introduction set introduced_party_id = '${AGENT}'`,
				notGranted("introduction"),
			],
			[
				`select merge_party('${CLIENT}', '${VENDOR}')`,
				"introduction_of_someone_else",
			],
		],
	"a lead has a stage, and only a lead has an owner, who is a user": [
		[
			"update party_role set stage = null where role = 'lead'",
			"party_role_lead_has_a_stage",
		],
		[
			`update party_role set owner_user_id = '${USER}' where role = 'vendor'`,
			"party_role_owner_on_lead",
		],
		[
			`update party_role set owner_user_id = '${CLIENT}' where role = 'lead'`,
			"party_role_owner_user_id_fkey",
		],
	],
	"a lead or client says how they were found, from the list": [
		[
			`insert into party (id, kind, name) values ('${id(661)}', 'person', 'Example');
			insert into party_role (party_id, role, stage) values ('${id(661)}', 'lead', 'new'); ${CHECK_AT_COMMIT}`,
			"lead_or_client_how_found",
		],
		[
			`insert into party_role values ('${AGENT}', 'client'); ${CHECK_AT_COMMIT}`,
			"lead_or_client_how_found",
		],
		[
			`update party set how_found = null where id = '${LEAD}'`,
			"lead_or_client_how_found",
		],
		[
			`update party set how_found = 'billboard' where id = '${LEAD}'`,
			"party_how_found_fkey",
		],
	],
	"someone a deal is opened for is a client": [
		[
			`insert into deal_party values ('${DEAL}', '${LEAD}', 'client'); ${CHECK_AT_COMMIT}`,
			"deal_party_client_is_a_client",
		],
		[
			`delete from party_role where party_id = '${CLIENT}' and role = 'client'; ${CHECK_AT_COMMIT}`,
			"deal_party_client_is_a_client",
		],
	],
	"history is never added, rewritten or removed by hand": [
		[
			"select erase_change(1, array['summary'])",
			{ code: "42501", message: "permission denied for function erase_change" },
		],

		[
			`insert into change (table_name, record, action) values ('deal', '{}', 'insert')`,
			notGranted("change"),
		],
		["update change set action = 'insert'", notGranted("change")],
		["delete from change", notGranted("change")],
		["truncate change", notGranted("change")],
		[
			`create temp table deal (id uuid primary key);
			create trigger forged after insert on pg_temp.deal for each row execute function record_change('id')`,
			{
				code: "42501",
				message: "permission denied for function record_change",
			},
		],
	],
	"a removal names the user or the job that made it": [
		[
			`select set_config('engine.user_id', '', true); delete from next_step where id = '${id(402)}'`,
			"change_names_who_made_it",
		],
	],
	"a record or link keeps when it was stored": STORED_AT.map((table) => [
		`update ${table} set created_at = now()`,
		notGranted(table),
	]),
};
const RELOAD = `create schema again; set local search_path = again; ${SCHEMA}`;
const TOO_MUCH = { message: "role engine holds rights beyond its grants" };
// Rules on paths only the schema's owner can take.
const OWNER_RULES: Record<string, Case[]> = {
	"historical critical date loads still require a whole confirmation": [
		[
			`alter table critical_date disable trigger critical_date_transition; ${newCriticalDate({ confirmed_by_user_id: USER })}`,
			"critical_date_confirmation_whole",
		],
		[
			`alter table critical_date disable trigger critical_date_transition; ${newCriticalDate({ status: "open" })}`,
			"critical_date_confirmed_when_real",
		],
	],
	"a user is a person": [
		[`insert into app_user (id) values ('${CLIENT}')`, "app_user_id_kind_fkey"],
	],
	"a merged-away record points at a live one, so merges never chain": [
		[
			`${MERGED}; insert into merged_party (id, survivor_id) values ('${OLD}', '${DUPLICATE}')`,
			"merged_party_survivor_id_fkey",
		],
	],
	"a row loaded with the stamp turned off still names a user or a job, never both":
		[
			[
				`alter table deal disable trigger stamp_change;
			insert into deal (name, owner_user_id, changed_at) values ('Example', '${USER}', now())`,
				"deal_changed_by_a_user_or_a_job",
			],
			[
				`alter table post disable trigger stamp_change;
			update post set changed_by_job = 'old_system' where id = '${post(8)}'`,
				"post_changed_by_a_user_or_a_job",
			],
			[
				`alter table deal disable trigger stamp_change;
			update deal set changed_for_user_id = '${TEAMMATE}' where id = '${DEAL}'`,
				"deal_changed_by_a_user_or_a_job",
			],
		],
	"a platform reports metrics from the known lists, each once": [
		[
			"insert into platform_metric values ('myspace', 'views')",
			"platform_metric_platform_check",
		],
		[
			"insert into platform_metric values ('x', 'likes')",
			"platform_metric_metric_check",
		],
		[
			"insert into platform_metric values ('x', 'views')",
			"platform_metric_pkey",
		],
	],
	"no response is a post's only review, even when its time moves": [
		[
			`${EDITED}; update post set scheduled_at = now() + interval '30 minutes' where id = '${OPEN}';
			set local role engine; ${noResponse({ post_id: OPEN })}`,
			"post_review_in_window",
		],
		[
			`${noResponse()}; ${asUser(USER)}; update post set scheduled_at = now() + interval '2 hours' where id = '${CLOSED}';
			set local role engine; ${cancel(CLOSED)}; ${newReview({ post_id: CLOSED, outcome: "cancelled" })}`,
			"post_review_in_window",
		],
	],
	"the engine claims no post once its account's engine_publishes_from moves past it":
		[
			[
				`update social_account set engine_publishes_from = '2026-07-01' where id = '${LINKEDIN}';
			set local role engine; ${CLAIM}`,
				"post_engine_publishes_from",
			],
		],
	"a platform offers formats from the known lists, each once": [
		[
			"insert into platform_format values ('myspace', 'text')",
			"platform_format_platform_check",
		],
		[
			"insert into platform_format values ('x', 'reel')",
			"platform_format_format_check",
		],
		[
			"insert into platform_format values ('x', 'text')",
			"platform_format_pkey",
		],
	],
	"a change is an insert, an update or a delete": [
		[
			`insert into change (table_name, record, action) values ('deal', '{}', 'merge')`,
			"change_action_check",
		],
	],
	"loading the schema refuses an engine role with rights beyond its grants": [
		[`grant pg_write_all_data to engine; ${RELOAD}`, TOO_MUCH],
		[`alter role engine bypassrls; ${RELOAD}`, TOO_MUCH],
	],
};
// What the engine may change; every other column, and every row of history, stays as stored.
const CHANGEABLE: Record<string, string[]> = {
	lead_contact_draft: [
		"approved",
		"body",
		"owner_user_id",
		"scheduled_for",
		"subject",
		"time_zone",
	],
	client_type: ["label"],
	client: ["client_type", "status"],
	client_brand: ["ended_on", "started_on"],
	national_account_owner: ["ended_on", "started_on"],
	role: ["label"],
	do_not_contact: ["until_date"],
	stage: ["label"],
	how_found: ["label"],
	party_role: [
		"disposition",
		"disposition_reason",
		"is_target",
		"owner_user_id",
		"relationship_level",
		"stage",
	],
	introduction: ["deal_id", "introduced_on", "note"],
	phase: ["label"],
	deal_kind: ["label"],
	deal_reason: ["label"],
	specialty: ["label"],
	party: ["how_found", "name", "npi"],
	property: ["address", "county_fips", "latitude", "longitude"],
	market: ["name"],
	territory: ["name"],
	party_territory: ["ended_on", "started_on"],
	deal: [
		"closed_value",
		"kind",
		"market_id",
		"name",
		"needs_attention",
		"owner_user_id",
		"parking_note",
		"parking_reason",
		"reason",
	],
	party_company: ["ended_on", "started_on", "title"],
	party_email: ["is_primary", "label"],
	party_phone: ["is_primary", "label"],
	activity: ["from_party_id", "happened_at", "summary"],
	next_step: ["done_at", "due_on", "owner_party_id", "what"],
	document: ["name"],
	offer: ["status"],
	critical_date: ["resolution_reason", "status"],
	social_account: ["handle", "platform_account_id"],
	idea: ["angle", "hook", "pillar"],
	design_template: ["name"],
	post: ["platform_post_id", "published_at", "reason", "status"],
};
// Columns the engine leaves to their default when it adds a row.
const DEFAULTED: Record<string, string[]> = {
	social_account: [
		"changed_at",
		"changed_by_job",
		"changed_by_user_id",
		"changed_for_user_id",
		"engine_publishes_from",
	],
};
const REMOVABLE = [
	...STORED_AT.filter(
		(table) => !["offer_document", "post_media"].includes(table),
	),
	"activity",
	"email",
];

// Each case runs in a transaction it rolls back, so a broken rule leaves nothing behind.
async function rolledBack(run: () => Promise<unknown>) {
	await db.query("begin");
	try {
		await run();
	} finally {
		await db.query("rollback");
	}
}
// Each case runs in its own owner's transaction, rolled back.
async function asOwner(cases: Case[]) {
	const owner = await connect("none");
	try {
		for (const [sql, refusal] of cases) {
			await owner.query("begin");
			try {
				await assert.rejects(owner.query(sql), expected(refusal));
			} finally {
				await owner.query("rollback");
			}
		}
	} finally {
		await owner.end();
	}
}
// When a row was stored or changed is the clock's, so reads are compared without it, and who changed it has its own test.
const unstamped = (read: unknown) =>
	JSON.parse(
		JSON.stringify(read, (key, value) =>
			[
				"created_at",
				"changed_at",
				"changed_by_user_id",
				"changed_by_job",
				"changed_for_user_id",
			].includes(key)
				? undefined
				: value,
		),
	);
const readDeal = async () =>
	unstamped(
		(await db.query("select everything_about_deal($1) as deal", [DEAL])).rows[0]
			.deal,
	);

const url = process.env.TEST_DATABASE_URL;
if (!url)
	throw new Error("Run npm run check to restore the test database first");
// Its own database, because this schema's trigger would change the count database.test.ts reads.
const name = `engine_next_${randomUUID().replaceAll("-", "")}`;
const target = new URL(url);
target.pathname = `/${name}`;
// Every test works as the engine; only loading the schema needs its owner (role none).
const connect = async (role = "engine") => {
	const client = new pg.Client({
		connectionString: target.href,
		options: `-c search_path=next -c TimeZone=UTC -c role=${role} -c engine.user_id=${USER}`,
	});
	await client.connect();
	return client;
};
let db: pg.Client;

before(async () => {
	await asAdmin(`create database "${name}" template template0`);
	db = await connect("none");
	await db.query(`create schema next; ${SCHEMA}`);
	await db.query(USERS);
	await db.query(
		`set role engine; ${SEED} ${MARKETING_SEED} ${TERRITORY_SEED} ${VENDOR_SEED} ${LEAD_SEED}`,
	);
	for (const { documents, ...round } of rounds) {
		await db.query(
			"insert into offer select * from jsonb_populate_record(null::offer, $1)",
			[{ ...round, deal_id: DEAL, status: "open" }],
		);
		for (const document of documents)
			await db.query(
				`with saved as (insert into document (id, name, r2_key, email_activity_id)
					select id, name, r2_key, email_activity_id
					from jsonb_populate_record(null::document, $1) returning id)
				insert into offer_document select $2, id from saved`,
				[document, round.id],
			);
		if (round.answers_round)
			await db.query("update offer set status = 'countered' where round = $1", [
				round.answers_round,
			]);
	}
	await db.query("update offer set status = 'accepted' where round = 3");
});

after(async () => {
	await db.end();
	await asAdmin(`drop database "${name}" with (force)`);
});

test("everything about the LOI deal comes back in one read, each list in order", async () => {
	assert.deepEqual(await readDeal(), {
		deal: {
			id: DEAL,
			name: "Example Dental Springfield Deal",
			kind: "lease",
			reason: "relocation",
			owner_user_id: USER,
			market_id: BAY,
			closed_value: null,
			parking_reason: null,
			parking_note: null,
			needs_attention: false,
		},
		phases,
		properties: [
			{
				id: PROPERTY,
				address: "100 Example Way, Springfield",
				county_fips: null,
				latitude: null,
				longitude: null,
			},
		],
		parties: [
			{
				id: CLIENT,
				kind: "company",
				name: "Example Dental Group",
				npi: NPIS[0],
				how_found: "referral",
				role: "client",
			},
			{
				id: AGENT,
				kind: "person",
				name: "Avery Example",
				npi: null,
				how_found: null,
				role: "listing_agent",
			},
		],
		offers: rounds,
		activity: [
			{
				id: EMAIL,
				kind: "email",
				happened_at: "2026-03-09T14:00:00+00:00",
				from_party_id: AGENT,
				summary: null,
				email: {
					message_id: "<counter-2@example.com>",
					sender: "avery@example.com",
					subject: "Counter to your LOI",
					body: "Our counter is attached.",
					documents: [rounds[1]?.documents[0]],
				},
			},
			{
				id: CALL,
				kind: "call",
				happened_at: "2026-03-10T16:00:00+00:00",
				from_party_id: CLIENT,
				summary: "Example asks for a shorter term",
				email: null,
			},
		],
		next_steps: [
			{
				id: id(401),
				what: "Send the signed LOI",
				owner_party_id: CLIENT,
				due_on: "2026-03-13",
				done_at: "2026-03-13T18:00:00+00:00",
			},
			{
				id: id(400),
				what: "Start the lease draft",
				owner_party_id: null,
				due_on: "2026-03-20",
				done_at: null,
			},
		],
	});
});

for (const [rule, cases] of Object.entries(RULES))
	test(rule, async () => {
		for (const [sql, refusal] of cases)
			await rolledBack(() => assert.rejects(db.query(sql), expected(refusal)));
	});

for (const [rule, cases] of Object.entries(OWNER_RULES))
	test(rule, () => asOwner(cases));

test("the engine adds, changes and removes only what its grants name, and empties no table", async () => {
	const { rows } = await db.query(
		`select c.relname as table,
			array_agg(a.attname::text order by a.attname)
				filter (where has_column_privilege(c.oid, a.attnum, 'update')) as changeable,
			has_any_column_privilege(c.oid, 'insert') as addable,
			array_agg(a.attname::text order by a.attname) filter (where has_any_column_privilege(c.oid, 'insert')
				and not has_column_privilege(c.oid, a.attnum, 'insert')) as defaulted,
			has_table_privilege(c.oid, 'delete') as removable,
			has_table_privilege(c.oid, 'truncate') as emptied
		from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
		where c.relnamespace = 'next'::regnamespace and c.relkind = 'r'
		group by c.oid order by c.relname`,
	);
	assert.deepEqual(
		rows,
		rows.map(({ table }) => ({
			table,
			changeable: CHANGEABLE[table] ?? null,
			addable: ![
				"app_user",
				"job",
				"merged_party",
				"change",
				"platform_metric",
				"platform_format",
				"relationship_level",
			].includes(table),
			defaulted: DEFAULTED[table] ?? null,
			removable: REMOVABLE.includes(table),
			emptied: false,
		})),
	);
});

test("every table a user or a job changes records who changed it and when", async () => {
	const { rows } = await db.query(
		`select array_agg(t.tgrelid::regclass::text order by t.tgrelid::regclass::text collate "C") as stamped
		from pg_trigger t
		join pg_attribute stamp_at on stamp_at.attrelid = t.tgrelid and stamp_at.attname = 'changed_at' and stamp_at.attnotnull
		join pg_constraint one on one.conrelid = t.tgrelid and one.conname = t.tgrelid::regclass::text || '_changed_by_a_user_or_a_job'
		where t.tgname = 'stamp_change' and t.tgfoid = 'stamp_change'::regproc`,
	);
	assert.deepEqual(rows[0].stamped, STAMPED.toSorted());
});

test("each change records the user who made it and when, whatever the statement says", () =>
	rolledBack(async () => {
		await db.query(`${asUser(TEAMMATE)}; update deal set name = 'Example' where id = '${DEAL}';
			insert into deal (id, name, owner_user_id, changed_by_user_id, changed_at)
			values ('${id(11)}', 'Example', '${USER}', '${USER}', '2020-01-01')`);
		const { rows } = await db.query(
			"select id, changed_by_user_id, changed_at = now() as now from deal order by id",
		);
		assert.deepEqual(rows, [
			{ id: DEAL, changed_by_user_id: TEAMMATE, now: true },
			{ id: LENDER_DEAL, changed_by_user_id: USER, now: false },
			{ id: id(11), changed_by_user_id: TEAMMATE, now: true },
		]);
	}));

test("a job's change names the job and the user it works for, and a user who settles a stuck post is named", () =>
	rolledBack(async () => {
		await db.query(`${asJob("publisher")}; ${CLAIM};
			${asJob("mail_capture", TEAMMATE)}; update activity set summary = 'Example' where id = '${EMAIL}';
			${asUser(TEAMMATE)}; update post set status = 'failed', reason = 'Example: sent twice?' where id = '${post(8)}'`);
		const { rows } = await db.query(
			`select changed_by_user_id, changed_by_job, changed_for_user_id from activity where id = $1
			union all select changed_by_user_id, changed_by_job, changed_for_user_id from post where id = $2`,
			[EMAIL, post(8)],
		);
		assert.deepEqual(rows, [
			{
				changed_by_user_id: null,
				changed_by_job: "mail_capture",
				changed_for_user_id: TEAMMATE,
			},
			{
				changed_by_user_id: TEAMMATE,
				changed_by_job: null,
				changed_for_user_id: null,
			},
		]);
	}));

test("a statement that changes nothing keeps who last changed the row, even on a published post", () =>
	rolledBack(async () => {
		await db.query(`${asJob("publisher")}; update post set reason = reason where id = '${post(1)}';
			update deal set name = name where id = '${DEAL}'; update party_company set title = title`);
		const { rows } = await db.query(
			`select changed_by_user_id, changed_at < now() as before from post where id = $1
			union all select changed_by_user_id, changed_at < now() from deal where id = $2
			union all select changed_by_user_id, changed_at < now() from party_company`,
			[post(1), DEAL],
		);
		assert.deepEqual(rows, [
			{ changed_by_user_id: USER, before: true },
			{ changed_by_user_id: USER, before: true },
			{ changed_by_user_id: USER, before: true },
			{ changed_by_user_id: USER, before: true },
		]);
	}));

test("every row a user or a job changes keeps its history", async () => {
	const { rows } = await db.query(
		`select array_agg(tgrelid::regclass::text order by tgrelid::regclass::text collate "C") as recorded
		from pg_trigger where tgname = 'record_change' and tgfoid = 'record_change'::regproc`,
	);
	assert.deepEqual(
		rows[0].recorded,
		STAMPED.filter((table) => table !== "change").toSorted(),
	);
});

// This transaction's history, without the times rows were stored.
const history = async (client = db) =>
	(
		await client.query(
			`select table_name, record - 'created_at' as record, action, old_value - 'created_at' as old_value,
				new_value - 'created_at' as new_value, changed_by_user_id, changed_by_job, changed_for_user_id, merge_of
			from change where changed_at = now() order by id`,
		)
	).rows;

test("each insert, update and delete leaves history: the record, its fields from what to what, and who made it", () =>
	rolledBack(async () => {
		await db.query(`${asUser(TEAMMATE)}; insert into deal (id, name, owner_user_id) values ('${id(11)}', 'Example', '${USER}');
			${asJob("mail_capture", TEAMMATE)}; update deal set name = 'Example renamed' where id = '${id(11)}';
			${asJob("agent")}; delete from party_specialty where person_id = '${DOCTOR}';
			update deal set name = name`);
		const by = (
			user: string | null,
			job: string | null,
			forUser: string | null = null,
		) => ({
			changed_by_user_id: user,
			changed_by_job: job,
			changed_for_user_id: forUser,
			merge_of: null,
		});
		assert.deepEqual(await history(), [
			{
				table_name: "deal",
				record: { id: id(11) },
				action: "insert",
				old_value: null,
				new_value: {
					id: id(11),
					name: "Example",
					kind: null,
					reason: null,
					owner_user_id: USER,
					market_id: null,
					closed_value: null,
					parking_reason: null,
					parking_note: null,
					needs_attention: false,
				},
				...by(TEAMMATE, null),
			},
			{
				table_name: "deal",
				record: { id: id(11) },
				action: "update",
				old_value: { name: "Example" },
				new_value: { name: "Example renamed" },
				...by(null, "mail_capture", TEAMMATE),
			},
			{
				table_name: "party_specialty",
				record: { person_id: DOCTOR, specialty: "general_dentistry" },
				action: "delete",
				old_value: {
					person_id: DOCTOR,
					person_kind: "person",
					specialty: "general_dentistry",
				},
				new_value: null,
				...by(null, "agent"),
			},
		]);
	}));

test("a deal's new deal owner is history: who held it before, who moved it and when", () =>
	rolledBack(async () => {
		await db.query(
			`${asUser(TEAMMATE)}; update deal set owner_user_id = '${TEAMMATE}' where id = '${DEAL}'`,
		);
		assert.deepEqual(await history(), [
			{
				table_name: "deal",
				record: { id: DEAL },
				action: "update",
				old_value: { owner_user_id: USER },
				new_value: { owner_user_id: TEAMMATE },
				changed_by_user_id: TEAMMATE,
				changed_by_job: null,
				changed_for_user_id: null,
				merge_of: null,
			},
		]);
	}));

test("a parked deal stays in its phase and is revived to it, and history keeps who parked it, why and when", () =>
	rolledBack(async () => {
		await db.query(`${asUser(TEAMMATE)};
			update deal set parking_reason = 'client_paused', parking_note = 'Example pause' where id = '${DEAL}';
			${asUser(USER)}; update deal set parking_reason = null, parking_note = null where id = '${DEAL}'`);
		assert.deepEqual((await readDeal()).phases, phases);
		const parked = {
			parking_reason: "client_paused",
			parking_note: "Example pause",
		};
		const active = { parking_reason: null, parking_note: null };
		const by = (user: string) => ({
			table_name: "deal",
			record: { id: DEAL },
			action: "update",
			changed_by_user_id: user,
			changed_by_job: null,
			changed_for_user_id: null,
			merge_of: null,
		});
		assert.deepEqual(await history(), [
			{ ...by(TEAMMATE), old_value: active, new_value: parked },
			{ ...by(USER), old_value: parked, new_value: active },
		]);
	}));

test("a user, or an agent working for one, flags a deal as needing attention, and a job alone still renames it", () =>
	rolledBack(async () => {
		await db.query(
			`${asJob("agent", TEAMMATE)}; update deal set needs_attention = true where id = '${DEAL}';
			${asJob("old_system")}; update deal set name = 'Example renamed', needs_attention = true where id = '${DEAL}'`,
		);
		assert.deepEqual(await history(), [
			{
				table_name: "deal",
				record: { id: DEAL },
				action: "update",
				old_value: { needs_attention: false },
				new_value: { needs_attention: true },
				changed_by_user_id: null,
				changed_by_job: "agent",
				changed_for_user_id: TEAMMATE,
				merge_of: null,
			},
			{
				table_name: "deal",
				record: { id: DEAL },
				action: "update",
				old_value: { name: "Example Dental Springfield Deal" },
				new_value: { name: "Example renamed" },
				changed_by_user_id: null,
				changed_by_job: "old_system",
				changed_for_user_id: null,
				merge_of: null,
			},
		]);
	}));

test("an agent working for a user edits and cancels a post as that user's", () =>
	rolledBack(() =>
		db.query(`${asJob("agent", TEAMMATE)}; ${EDITED}; ${cancel(OPEN)};
			${newReview({ outcome: "cancelled" })}`),
	));

test("a property falls in a territory by a whole state, a named market or a distance from its base", async () => {
	const { rows } = await db.query(
		"select property_id, territory_id from property_territory where property_id = any($1) order by property_id",
		[[PROPERTY, IN_STATE, IN_MARKET, IN_REACH, OUTSIDE]],
	);
	assert.deepEqual(rows, [
		{ property_id: IN_STATE, territory_id: STATEWIDE },
		{ property_id: IN_MARKET, territory_id: HOME },
		{ property_id: IN_REACH, territory_id: HOME },
	]);
});

test("a distance is miles along the earth's surface", async () => {
	const { rows } = await db.query(
		`select round(miles_between(10, -150, 11, -150)::numeric, 1) as north,
			round(miles_between(60, 0, 60, 1)::numeric, 1) as east_at_60,
			round(miles_between(8, 0, -8, 180)::numeric) as half_way_round`,
	);
	assert.deepEqual(rows, [
		{ north: "69.1", east_at_60: "34.5", half_way_round: "12437" },
	]);
});

test("who serves a property today, while a vendor that left keeps its history", async () => {
	const { rows } = await db.query(
		`select t.property_id, s.party_id, s.ended_on is null as today
		from property_territory t join party_territory s using (territory_id)
		where t.property_id = any($1) order by t.property_id, s.party_id`,
		[[IN_STATE, IN_MARKET]],
	);
	assert.deepEqual(rows, [
		{ property_id: IN_STATE, party_id: VENDOR, today: true },
		{ property_id: IN_MARKET, party_id: USER, today: true },
		{ property_id: IN_MARKET, party_id: VENDOR, today: false },
	]);
});

test("a vendor's track record counts the deals it worked and the deals its introductions led to", () =>
	rolledBack(async () => {
		await db.query(`insert into phase values ('closed', 'Closed');
			insert into deal (id, name, owner_user_id) values
				('${CLOSED_DEAL}', 'Example Closed Deal', '${USER}'), ('${DEAD_DEAL}', 'Example Dead Deal', '${USER}');
			insert into deal_phase_change values
				('${CLOSED_DEAL}', '2026-04-01T15:00:00+00:00', 'negotiation', null),
				('${CLOSED_DEAL}', '2026-05-01T15:00:00+00:00', 'closed', null),
				('${DEAD_DEAL}', '2026-04-01T15:00:00+00:00', 'dead', 'Example: the client stayed put');
			insert into party_role (party_id, role) values ('${LENDERS[0]}', 'vendor'), ('${VENDOR}', 'client');
			insert into deal_party values
				('${DEAL}', '${VENDOR}', 'title'), ('${CLOSED_DEAL}', '${VENDOR}', 'title'), ('${CLOSED_DEAL}', '${VENDOR}', 'lender'),
				('${DEAD_DEAL}', '${VENDOR}', 'vendor'), ('${LENDER_DEAL}', '${VENDOR}', 'client'),
				('${LENDER_DEAL}', '${LENDERS[1]}', 'lender');
			${newIntroduction({ made_by: "vendor", introduced_by_user_id: null, deal_id: DEAL })}; ${newIntroduction({ deal_id: DEAD_DEAL })};
			${newIntroduction({ deal_id: CLOSED_DEAL, introduced_party_id: AGENT })}; ${newIntroduction({})}`);
		const { rows } = await db.query(
			"select * from vendor_track_record order by party_id",
		);
		assert.deepEqual(rows, [
			{
				party_id: LENDERS[0],
				deals_worked: "0",
				deals_closed: "0",
				deals_dead: "0",
				deals_it_introduced: "0",
				deals_we_introduced: "0",
			},
			{
				party_id: VENDOR,
				deals_worked: "3",
				deals_closed: "1",
				deals_dead: "1",
				deals_it_introduced: "1",
				deals_we_introduced: "2",
			},
		]);
	}));

test("a merge moves a vendor's introductions, keeps avoid and clears target, and fills missing stage and level", () =>
	rolledBack(async () => {
		await db.query(`insert into party (id, kind, name) values ('${DUPLICATE}', 'company', 'Example Title Co');
			insert into party_role (party_id, role, relationship_level, disposition, disposition_reason, is_target) values
				('${DUPLICATE}', 'vendor', 3, 'avoid', 'Example: slow to close', false), ('${LENDERS[0]}', 'vendor', null, null, null, false);
			update party_role set disposition = 'parked', disposition_reason = 'Example: drip only', is_target = true
			where party_id = '${VENDOR}' and role = 'vendor';
			${newIntroduction({ vendor_id: DUPLICATE })};
			select merge_party('${DUPLICATE}', '${VENDOR}');
			select merge_party('${VENDOR}', '${LENDERS[0]}');
			select merge_party('${LENDERS[0]}', '${LENDERS[1]}')`);
		const { rows } = await db.query(
			`select (select count(*) from introduction where vendor_id = $1) as introductions,
				jsonb_agg(jsonb_build_array(role, stage, relationship_level, disposition, disposition_reason, is_target)
					order by role) as roles
			from party_role where party_id = $1`,
			[LENDERS[1]],
		);
		assert.deepEqual(rows, [
			{
				introductions: "2",
				roles: [
					["title", null, null, null, null, false],
					["vendor", "warm", 1, "avoid", "Example: slow to close", false],
				],
			},
		]);
	}));

// How a party was found, its roles with each one's stage and owner, and the deals it is the client of.
const asLeadOrClient = async (party: string) =>
	(
		await db.query(
			`select how_found,
				(select jsonb_agg(jsonb_build_array(role, stage, owner_user_id) order by role) from party_role where party_id = $1)
					as roles,
				(select array_agg(deal_id order by deal_id) from deal_party where party_id = $1 and role = 'client') as deals
			from party where id = $1`,
			[party],
		)
	).rows;

test("a lead becomes a client when a deal is opened for them, and keeps its stage, owner and how it was found", () =>
	rolledBack(async () => {
		await db.query(`insert into deal (id, name, owner_user_id) values ('${id(662)}', 'Example Lead Deal', '${TEAMMATE}');
			insert into deal_party values ('${id(662)}', '${LEAD}', 'client');
			insert into party_role (party_id, role) values ('${LEAD}', 'client'); ${CHECK_AT_COMMIT}`);
		assert.deepEqual(await asLeadOrClient(LEAD), [
			{
				how_found: "public_records",
				roles: [
					["client", null, null],
					["lead", "nurture", TEAMMATE],
				],
				deals: [id(662)],
			},
		]);
	}));

test("a merge keeps the survivor's lead owner and how it was found, filled from the duplicate's, and moves its deals as client", () =>
	rolledBack(async () => {
		await db.query(`insert into party (id, kind, name, how_found) values
				('${DUPLICATE}', 'person', 'Dr. E. Lead', 'vendor'), ('${OLD}', 'person', 'Dr. Lead', null);
			insert into party_role (party_id, role, stage, owner_user_id) values
				('${DUPLICATE}', 'lead', 'engaged', '${USER}'), ('${DUPLICATE}', 'client', null, null),
				('${OLD}', 'lead', 'new', null);
			insert into deal_party values ('${LENDER_DEAL}', '${DUPLICATE}', 'client');
			select merge_party('${DUPLICATE}', '${LEAD}');
			select merge_party('${LEAD}', '${OLD}'); ${CHECK_AT_COMMIT}`);
		assert.deepEqual(await asLeadOrClient(OLD), [
			{
				how_found: "public_records",
				roles: [
					["client", null, null],
					["lead", "new", TEAMMATE],
				],
				deals: [LENDER_DEAL],
			},
		]);
	}));

test("an email's sender is matched to its people through their email rows", async () => {
	const { rows } = await db.query(
		"select party_id from email join party_email on address = sender where activity_id = $1",
		[EMAIL],
	);
	assert.deepEqual(rows, [{ party_id: AGENT }]);
});

test("emails and phone numbers the rules allow are kept", () =>
	rolledBack(() =>
		db.query(`update party_email set is_primary = false where party_id = '${AGENT}';
			update party_email set is_primary = true where address = 'avery.example@example.net';
			${newAddress({ party_id: CLIENT, address: "o''brien+loi@example.com", is_primary: "true" })};
			${newAddress({ party_id: CLIENT, address: "first.last_2@example.co.uk" })};
			-- A front desk shares its address and line.
			${newAddress({ party_id: CLIENT })};
			${newPhone({ party_id: CLIENT, extension: "12", is_primary: "true" })};
			${newPhone({ number: "+442079460123", label: "mobile" })}`),
	));

test("the engine claims a scheduled post, then publishes it", () =>
	rolledBack(() =>
		db.query(`${CLAIM}; update post set status = 'published', platform_post_id = 'example-8',
			published_at = now() where id = '${post(8)}'`),
	));

test("a user's edit and cancel are reviewed before review closes, and an untouched post gets no response", () =>
	rolledBack(() =>
		db.query(`${EDITED}; ${cancel(OPEN)}; ${newReview({ outcome: "cancelled" })};
			${noResponse()}`),
	));

test("a review holds its post until it is saved", async () => {
	const [user, job] = [await connect(), await connect()];
	try {
		await user.query(`begin; ${EDITED}`);
		await job.query("begin; set local lock_timeout = '100ms'");
		await assert.rejects(
			job.query("select from post where id = $1 for no key update", [OPEN]),
			{ code: "55P03" },
		);
	} finally {
		for (const client of [user, job]) {
			await client.query("rollback");
			await client.end();
		}
	}
});

test("an account's engine_publishes_from waits while the engine claims one of its posts", async () => {
	const [engine, owner] = [await connect(), await connect("none")];
	try {
		await engine.query(`begin; ${CLAIM}`);
		await owner.query("begin; set local lock_timeout = '100ms'");
		await assert.rejects(
			owner.query(
				"update social_account set engine_publishes_from = null where id = $1",
				[LINKEDIN],
			),
			{ code: "55P03" },
		);
	} finally {
		for (const client of [engine, owner]) {
			await client.query("rollback");
			await client.end();
		}
	}
});

test("posts compare at day 7, best and worst per account", async () => {
	const ranked = (
		n: number,
		idea: string,
		template: string,
		rate: number,
		age = 168,
	) => ({
		id: post(n),
		published_at: `${POST_ROWS[n - 1]?.[4]}T15:00:00+00:00`,
		idea_id: idea,
		design_template_id: template,
		engagement_per_view: rate,
		reading_age_hours: age,
	});
	const account = (
		id: string,
		platform: string,
		handle: string,
		...posts: ReturnType<typeof ranked>[]
	) => ({
		id,
		platform,
		owner_party_id: USER,
		handle,
		platform_account_id: id === LINKEDIN ? "example-person-1" : null,
		engine_publishes_from: id === LINKEDIN ? ENGINE_FROM : null,
		posts: posts.length,
		best: posts[0],
		worst: posts.at(-1),
	});
	const { rows } = await db.query("select posts_at_day_7($1) as read", [DAY_7]);
	const checklistOnStatCard = ranked(4, CHECKLIST_IDEA, STAT_CARD, 0.04, 160);
	assert.deepEqual(unstamped(rows[0].read), {
		accounts: [
			account(
				INSTAGRAM,
				"instagram",
				"jordan.example",
				ranked(9, CHECKLIST_IDEA, PHOTO, 0.09),
			),
			account(
				LINKEDIN,
				"linkedin",
				"jordan-example",
				ranked(2, CHECKLIST_IDEA, PHOTO, 0.07),
				ranked(1, RENT_IDEA, STAT_CARD, 0.05),
			),
			account(X, "x", "jordanexample", checklistOnStatCard),
		],
	});
});

test("at one instant, a measured reading wins over one that was not measured", () =>
	rolledBack(async () => {
		await db.query(
			newReading({
				...NOT_MEASURED,
				post_id: post(2),
				taken_at: "2026-06-10T15:00:00+00:00",
				source: "another_source",
			}),
		);
		assert.deepEqual((await compared())[1], ["linkedin", 2, post(2), post(1)]);
	}));

test("a metric added later is asked only of posts published since", async () => {
	const owner = await connect("none");
	try {
		await owner.query("begin");
		await owner.query(`insert into platform_metric (platform, metric) values ('x', 'saves');
			insert into platform_metric values ('linkedin', 'saves', '2026-06-02T00:00:00+00:00')`);
		assert.deepEqual(await compared(owner), [
			["instagram", 1, post(9), post(9)],
			["linkedin", 1, post(1), post(1)],
			["x", 1, post(4), post(4)],
		]);
	} finally {
		await owner.query("rollback");
		await owner.end();
	}
});

test("day 7 is 168 hours after publishing, even across a clock change", () =>
	rolledBack(async () => {
		await db.query("set local time zone 'America/Chicago'");
		await db.query(
			`insert into post (id, social_account_id, platform, format, scheduled_at, status, platform_post_id, published_at)
			values ($1, $2, 'x', 'text', $3, 'published', 'example-clock', $3)`,
			[post(11), X, "2026-10-29T15:00:00+00:00"],
		);
		await db.query(
			`insert into measurement (post_id, platform, metric, taken_at, source, value)
			select $1, 'x', metric, $2, 'example_source', value
			from unnest(array['views', 'reactions', 'comments', 'shares'], array[100, 10, 0, 0]) as r (metric, value)`,
			[post(11), "2026-11-05T15:00:00+00:00"],
		);
		const { rows } = await db.query("select posts_at_day_7($1) as read", [
			"2026-11-05T15:00:00+00:00",
		]);
		const x = rows[0].read.accounts.find(
			(account: { platform: string }) => account.platform === "x",
		);
		assert.equal(x.best.id, post(11));
	}));

test("a deal that dies after acceptance keeps its accepted round, and a revival accepts a new one", () =>
	rolledBack(async () => {
		await db.query(
			`insert into deal_phase_change values
				($1, '2026-05-01T15:00:00+00:00', 'negotiation', 'Talks restarted'),
				($1, '2026-04-01T15:00:00+00:00', 'dead', 'Example financing fell through')`,
			[DEAL],
		);
		assert.equal((await readDeal()).offers[2].status, "accepted");
		await db.query("update offer set status = 'superseded' where round = 3");
		await db.query(NEXT_ROUND);
		await db.query("update offer set status = 'accepted' where round = 4");
		await db.query(CHECK_AT_COMMIT);
		const deal = await readDeal();
		assert.deepEqual(
			deal.offers.map(({ status }: { status: string }) => status),
			["countered", "countered", "superseded", "accepted"],
		);
		assert.deepEqual(
			deal.phases.map(({ phase }: { phase: string }) => phase),
			["negotiation", "legal", "dead", "negotiation"],
		);
	}));

test("two users adding different lenders to one deal at once both keep them", async () => {
	const writers = [await connect(), await connect()];
	try {
		for (const writer of writers) await writer.query("begin");
		await writers[1]?.query("set local lock_timeout = '1s'");
		for (const [i, writer] of writers.entries())
			await writer.query("insert into deal_party values ($1, $2, 'lender')", [
				LENDER_DEAL,
				LENDERS[i],
			]);
		for (const writer of writers) await writer.query("commit");
		const { rows } = await db.query(
			"select party_id from deal_party where deal_id = $1 order by party_id",
			[LENDER_DEAL],
		);
		assert.deepEqual(
			rows.map((row) => row.party_id),
			LENDERS,
		);
	} finally {
		await Promise.all(writers.map((writer) => writer.end()));
	}
});

// Everything each record holds, as a merge would move it.
const holdings = async (party: string | undefined) =>
	(
		await db.query(
			`select
				(select array_agg(role order by role) from party_role where party_id = $1) as roles,
				(select jsonb_agg(jsonb_build_array(address, label, is_primary) order by address collate "C")
					from party_email where party_id = $1) as emails,
				(select jsonb_agg(jsonb_build_array(number, extension, label, is_primary) order by number)
					from party_phone where party_id = $1) as phones,
				(select reason from do_not_contact where party_id = $1) as do_not_contact,
				(select array_agg(specialty order by specialty) from party_specialty where person_id = $1) as specialties,
				(select array_agg(title order by title) from party_company where person_id = $1) as titles,
				(select array_agg(value) from outside_id where party_id = $1) as outside_ids,
				(select jsonb_agg(jsonb_build_array(deal_id, role) order by deal_id, role) from deal_party where party_id = $1)
					as deals,
				(select jsonb_agg(jsonb_build_array(round, changed_by_user_id) order by round) from offer where from_party_id = $1)
					as rounds,
				(select array_agg(id order by id) from activity where from_party_id = $1) as sent,
				(select array_agg(activity_id order by activity_id) from activity_about where party_id = $1) as about,
				(select array_agg(what) from next_step where owner_party_id = $1 and party_id = $1) as next_steps,
				(select array_agg(handle) from social_account where owner_party_id = $1) as social_accounts,
				(select array_agg(territory_id order by territory_id) from party_territory where party_id = $1) as territories`,
			[party],
		)
	).rows[0];

test("a merge moves everything to the survivor, whose own row wins where both hold one", () =>
	rolledBack(async () => {
		await db.query(`insert into party (id, kind, name) values
				('${DUPLICATE}', 'person', 'A. Example'), ('${OLD}', 'person', 'Avery E. Example');
			insert into party_role values ('${DUPLICATE}', 'listing_agent'), ('${DUPLICATE}', 'lender');
			insert into party_email (party_id, address, label, is_primary) values
				('${DUPLICATE}', 'avery@example.com', 'personal', false), ('${OLD}', 'a.example@example.org', 'work', true);
			insert into party_phone (party_id, number, extension, label, is_primary) values
				('${DUPLICATE}', '+12175550100', '12', 'mobile', false), ('${DUPLICATE}', '+12175550102', null, 'home', true);
			insert into do_not_contact (party_id, reason) values ('${DUPLICATE}', 'Example duplicate');
			insert into party_specialty (person_id, specialty) values
				('${AGENT}', 'orthodontics'), ('${DUPLICATE}', 'orthodontics'), ('${DUPLICATE}', 'general_dentistry');
			insert into party_company (person_id, company_id, title, started_on) values
				('${DUPLICATE}', '${BROKERAGES[1]}', 'Broker', '2026-01-05');
			insert into outside_id (source, value, party_id) values ('roster', 'EXAMPLE-1', '${OLD}');
			insert into deal_party values ('${DEAL}', '${DUPLICATE}', 'listing_agent'), ('${DEAL}', '${DUPLICATE}', 'lender');
			${offer(4, 3, DUPLICATE, "listing_agent")}; ${offer(5, 4, DUPLICATE, "lender")};
			insert into activity (id, kind, happened_at, from_party_id) values ('${id(303)}', 'call', now(), '${DUPLICATE}');
			insert into activity_about (activity_id, party_id) values ('${EMAIL}', '${DUPLICATE}'), ('${id(303)}', '${DUPLICATE}');
			insert into next_step (what, owner_party_id, party_id) values ('Example follow-up', '${DUPLICATE}', '${DUPLICATE}');
			insert into social_account (platform, owner_party_id, handle) values ('facebook', '${DUPLICATE}', 'example-duplicate');
			insert into party_territory (party_id, territory_id, started_on) values
				('${AGENT}', '${HOME}', '2024-01-01'), ('${DUPLICATE}', '${HOME}', '2024-01-01'), ('${DUPLICATE}', '${HOME}', '2025-01-01'),
				('${DUPLICATE}', '${STATEWIDE}', null);
			${asUser(TEAMMATE)}; set local search_path = public;
			select next.merge_party('${OLD}', '${DUPLICATE}');
			select next.merge_party('${DUPLICATE}', '${AGENT}');
			set local search_path = next`);
		assert.deepEqual(await holdings(AGENT), {
			roles: ["lender", "listing_agent"],
			emails: [
				["a.example@example.org", "work", false],
				["avery.example@example.net", "personal", false],
				["avery@example.com", "work", true],
			],
			phones: [
				["+12175550100", "12", "work", true],
				["+12175550101", null, "mobile", false],
				["+12175550102", null, "home", false],
			],
			do_not_contact: "Example asked not to be contacted",
			specialties: ["general_dentistry", "orthodontics"],
			titles: ["Associate", "Senior associate"],
			outside_ids: ["EXAMPLE-1"],
			deals: [
				[DEAL, "lender"],
				[DEAL, "listing_agent"],
			],
			rounds: [
				[2, USER],
				[4, TEAMMATE],
				[5, TEAMMATE],
			],
			sent: [EMAIL, id(303)],
			about: [EMAIL, id(303)],
			next_steps: ["Example follow-up"],
			social_accounts: ["example-duplicate"],
			territories: [HOME, HOME, STATEWIDE],
		});
		const { rows } = await db.query(
			"select id, survivor_id, changed_by_user_id, exists (select from party p where p.id = m.id) as listed from merged_party m order by id",
		);
		assert.deepEqual(
			rows,
			[DUPLICATE, OLD].map((merged) => ({
				id: merged,
				survivor_id: AGENT,
				changed_by_user_id: TEAMMATE,
				listed: false,
			})),
		);
	}));

test("a merge takes the duplicate's NPI and do not contact when the survivor has none", () =>
	rolledBack(async () => {
		await db.query(`insert into party (id, kind, name) values ('${DUPLICATE}', 'person', 'A. Example');
			insert into do_not_contact (party_id, reason) values ('${DOCTOR}', 'Example asked not to be contacted');
			select merge_party('${DOCTOR}', '${DUPLICATE}')`);
		const { rows } = await db.query(
			"select npi, reason from party join do_not_contact on party_id = id order by npi",
		);
		assert.deepEqual(rows, [
			{ npi: NPIS[1], reason: "Example asked not to be contacted" },
			{ npi: null, reason: "Example asked not to be contacted" },
		]);
	}));

test("a survivor with no primary takes the duplicate's, even on an address or number both hold", () =>
	rolledBack(async () => {
		await db.query(`insert into party_email (party_id, address, label, is_primary) values
				('${LENDERS[0]}', 'loans@example.com', 'work', false), ('${LENDERS[1]}', 'loans@example.com', 'personal', true);
			insert into party_phone (party_id, number, extension, label, is_primary) values
				('${LENDERS[0]}', '+12175550103', null, 'work', false), ('${LENDERS[1]}', '+12175550103', null, 'mobile', true),
				('${LENDERS[1]}', '+12175550103', '7', 'work', false);
			select merge_party('${LENDERS[1]}', '${LENDERS[0]}')`);
		const { emails, phones } = await holdings(LENDERS[0]);
		assert.deepEqual(
			{ emails, phones },
			{
				emails: [["loans@example.com", "work", true]],
				phones: [
					["+12175550103", null, "work", true],
					["+12175550103", "7", "work", false],
				],
			},
		);
	}));

test("a company's merge keeps one link per person and start date", () =>
	rolledBack(async () => {
		await db.query(`insert into party_company (person_id, company_id, started_on) values
				('${AGENT}', '${BROKERAGES[0]}', '2026-01-05'), ('${AGENT}', '${BROKERAGES[1]}', '2027-01-04');
			select merge_party('${BROKERAGES[1]}', '${BROKERAGES[0]}')`);
		const { rows } = await db.query(
			"select company_id, title, started_on::text from party_company order by started_on",
		);
		assert.deepEqual(rows, [
			{
				company_id: BROKERAGES[0],
				title: "Associate",
				started_on: "2020-01-06",
			},
			{ company_id: BROKERAGES[0], title: null, started_on: "2026-01-05" },
			{ company_id: BROKERAGES[0], title: null, started_on: "2027-01-04" },
		]);
	}));

test("a merge moves what a table added later points at", async () => {
	const owner = await connect("none");
	try {
		await owner.query("begin");
		await owner.query(`create table later (party_id uuid references party);
			insert into party (id, kind, name) values ('${DUPLICATE}', 'person', 'A. Example');
			insert into later values ('${DUPLICATE}');
			select merge_party('${DUPLICATE}', '${AGENT}')`);
		const { rows } = await owner.query("select party_id from later");
		assert.deepEqual(rows, [{ party_id: AGENT }]);
	} finally {
		await owner.query("rollback");
		await owner.end();
	}
});

test("a merge's moves are history told as that merge's", () =>
	rolledBack(async () => {
		await db.query(`insert into party (id, kind, name) values ('${DUPLICATE}', 'person', 'A. Example');
			insert into party_role values ('${DUPLICATE}', 'listing_agent'), ('${DUPLICATE}', 'lender');
			insert into activity_about (activity_id, party_id) values ('${CALL}', '${DUPLICATE}');
			select merge_party('${DUPLICATE}', '${AGENT}');
			update deal set name = 'Example' where id = '${DEAL}'`);
		const told = async (merge: string | null) =>
			(
				await db.query(
					`select table_name, action, record - 'created_at' as record, case action when 'update'
						then jsonb_build_array(old_value, new_value) end as moved
					from change where changed_at = now() and merge_of is not distinct from $1
					order by table_name, action, record::text`,
					[merge],
				)
			).rows;
		const row = (
			table_name: string,
			action: string,
			record: object,
			moved: object[] | null = null,
		) => ({ table_name, action, record, moved });
		const roles = ["lender", "listing_agent"].map((role) => ({
			party_id: DUPLICATE,
			role,
		}));
		const about = {
			activity_id: CALL,
			deal_id: null,
			party_id: DUPLICATE,
			property_id: null,
		};
		assert.deepEqual(await told(DUPLICATE), [
			row("activity_about", "update", about, [
				{ party_id: DUPLICATE },
				{ party_id: AGENT },
			]),
			row("merged_party", "insert", { id: DUPLICATE }),
			row("party", "delete", { id: DUPLICATE }),
			// The survivor already holds this role, so the duplicate's row goes.
			row("party_role", "delete", roles[1] as object),
			row("party_role", "update", roles[0] as object, [
				{ party_id: DUPLICATE },
				{ party_id: AGENT },
			]),
		]);
		// Before the merge, and after it ends.
		assert.deepEqual(await told(null), [
			row("activity_about", "insert", about),
			row("deal", "update", { id: DEAL }, [
				{ name: "Example Dental Springfield Deal" },
				{ name: "Example" },
			]),
			row("party", "insert", { id: DUPLICATE }),
			...roles.map((role) => row("party_role", "insert", role)),
		]);
	}));

test("a setting alone never tells a change as a merge's", async () => {
	const owner = await connect("none");
	try {
		await owner.query("begin");
		await owner.query(`insert into merged_party (id, survivor_id, created_at) values ('${OLD}', '${AGENT}', '2026-01-01');
			set local role engine; select set_config('engine.merge', '${OLD}', true);
			update deal set name = 'Example' where id = '${DEAL}'`);
		assert.deepEqual(
			(await history(owner)).map((change) => [
				change.table_name,
				change.merge_of,
			]),
			[
				["merged_party", null],
				["deal", null],
			],
		);
	} finally {
		await owner.query("rollback");
		await owner.end();
	}
});

test("only the engine and the owner run a merge", async () => {
	const { rows } = await db.query(
		`select has_function_privilege('public', 'merge_party(uuid, uuid)', 'execute') as anyone,
			has_function_privilege('engine', 'merge_party(uuid, uuid)', 'execute') as engine`,
	);
	assert.deepEqual(rows, [{ anyone: false, engine: true }]);
});

// A merge would repeat these keys, so merge_party keeps the survivor's row and removes the duplicate's first, or refuses a user.
const COLLAPSED = [
	"activity_about_activity_id_deal_id_party_id_property_id_key",
	"app_user_pkey",
	"deal_party_pkey",
	"do_not_contact_pkey",
	"lead_contact_draft_party_id_key",
	"national_account_pkey",
	"party_company_person_id_company_id_started_on_key",
	"party_email_address_party_id_key",
	"party_email_one_primary",
	"party_phone_number_extension_party_id_key",
	"party_phone_one_primary",
	"party_role_pkey",
	"party_specialty_pkey",
	"party_territory_party_id_territory_id_started_on_key",
];
test("every unique key that holds a party is one a merge collapses", async () => {
	const { rows } = await db.query(
		`select array_agg(distinct i.indexrelid::regclass::text order by i.indexrelid::regclass::text) as keys
		from pg_constraint c
		join pg_attribute target on target.attrelid = c.confrelid and target.attname = 'id'
		join pg_index i on i.indrelid = c.conrelid and i.indisunique
			and c.conkey[array_position(c.confkey, target.attnum)] = any (i.indkey)
		where c.contype = 'f' and c.confrelid = 'party'::regclass`,
	);
	assert.deepEqual(rows[0].keys, COLLAPSED);
});

for (const [sql, refusal] of [
	[
		newLeadDraft({ requires_human_send: "false" }),
		"lead_contact_draft_requires_human_send_check",
	],
	[
		newLeadDraft({ dispatchable: "true" }),
		"lead_contact_draft_dispatchable_check",
	],
	[newLeadDraft({ approved: "true" }), "lead_contact_draft_starts_unapproved"],
	[newLeadDraft({ subject: " " }), "lead_contact_draft_subject_check"],
	[newLeadDraft({ body: " " }), "lead_contact_draft_body_check"],
	[newLeadDraft({ time_zone: " " }), "lead_contact_draft_time_zone_check"],
	[
		newLeadDraft({ owner_user_id: CLIENT }),
		"lead_contact_draft_owner_user_id_fkey",
	],
	[
		`${newLeadDraft({ party_id: DOCTOR })}; ${CHECK_AT_COMMIT}`,
		"lead_contact_draft_party_id_role_fkey",
	],
	[
		`${newLeadDraft()}; ${newLeadDraft({ id: id(741) })}`,
		"lead_contact_draft_party_id_key",
	],
	[
		`${newLeadDraft()}; ${asJob("agent")}; update lead_contact_draft set approved = true`,
		"lead_contact_draft_user_approves",
	],
	[
		"update lead_contact_draft set dispatchable = true",
		notGranted("lead_contact_draft"),
	],
	[
		"update lead_contact_draft set revision = 5",
		notGranted("lead_contact_draft"),
	],
] satisfies Case[]) {
	test(`outreach draft refuses ${refusal}`, () =>
		rolledBack(async () => {
			await assert.rejects(db.query(sql), expected(refusal));
		}));
}

test("editing an approved outreach draft clears approval and increments its revision", () =>
	rolledBack(async () => {
		await db.query(`${asJob("agent", USER)}; ${newLeadDraft()}; update lead_contact_draft set approved = true;
		update lead_contact_draft set body = 'Example revised contact', approved = true`);
		assert.deepEqual(
			(
				await db.query(
					"select approved, revision, requires_human_send, dispatchable from lead_contact_draft",
				)
			).rows,
			[
				{
					approved: false,
					revision: 2,
					requires_human_send: true,
					dispatchable: false,
				},
			],
		);
		await db.query(
			`update lead_contact_draft set approved = true where revision = 1`,
		);
		assert.equal(
			(await db.query("select approved from lead_contact_draft")).rows[0]
				.approved,
			false,
		);
		await db.query(
			`${asUser(USER)}; update lead_contact_draft set approved = true where revision = 2`,
		);
		assert.equal(
			(await db.query("select approved from lead_contact_draft")).rows[0]
				.approved,
			true,
		);
	}));

test("a merge keeps the survivor's draft and retains the other in change history", () =>
	rolledBack(async () => {
		await db.query(`${newLeadDraft()};
		insert into party (id, kind, name, how_found) values ('${OLD}', 'person', 'Example Other', 'public_records');
		insert into party_role (party_id, role, stage) values ('${OLD}', 'lead', 'new');
		${newLeadDraft({ id: id(741), party_id: OLD, body: "Example other draft" })};
		select merge_party('${OLD}', '${LEAD}'); ${CHECK_AT_COMMIT}`);
		assert.deepEqual(
			(await db.query("select id, body from lead_contact_draft")).rows,
			[{ id: DRAFT, body: "Example first contact" }],
		);
		assert.equal(
			(
				await db.query(
					"select count(*) from change where table_name = 'lead_contact_draft' and action = 'delete'",
				)
			).rows[0].count,
			"1",
		);
	}));

test("a lone approved draft moves with its lead without losing approval or revision", () =>
	rolledBack(async () => {
		await db.query(`insert into party (id, kind, name, how_found) values ('${OLD}', 'person', 'Example Other', 'public_records');
		insert into party_role (party_id, role, stage) values ('${OLD}', 'lead', 'new');
		${newLeadDraft({ party_id: OLD })}; update lead_contact_draft set approved = true;
		${asJob("agent", USER)}; select merge_party('${OLD}', '${LEAD}'); ${CHECK_AT_COMMIT}`);
		assert.deepEqual(
			(
				await db.query(
					"select party_id, approved, revision from lead_contact_draft",
				)
			).rows,
			[{ party_id: LEAD, approved: true, revision: 1 }],
		);
	}));

// Last, because it commits.
test("a merge waits for one that moves rows onto its duplicate, then moves them on", async () => {
	await db.query(
		`insert into party (id, kind, name) values ('${DUPLICATE}', 'person', 'A. Example')`,
	);
	const merges = [await connect(), await connect()];
	try {
		const [first, second] = merges as [pg.Client, pg.Client];
		const { pid } = (await second.query("select pg_backend_pid() as pid"))
			.rows[0];
		await first.query("begin");
		await first.query(`select merge_party('${DOCTOR}', '${DUPLICATE}')`);
		let settled = false;
		const waiting = second
			.query(`select merge_party('${DUPLICATE}', '${AGENT}')`)
			.finally(() => {
				settled = true;
			});
		const blocked = async () =>
			(await db.query("select pg_blocking_pids($1) <> '{}' as blocked", [pid]))
				.rows[0].blocked;
		while (!settled && !(await blocked()));
		await first.query("commit");
		await waiting;
		const { rows } = await db.query(
			"select id, survivor_id from merged_party order by id",
		);
		assert.deepEqual(rows, [
			{ id: DOCTOR, survivor_id: AGENT },
			{ id: DUPLICATE, survivor_id: AGENT },
		]);
	} finally {
		await Promise.all(merges.map((merge) => merge.end()));
	}
});

// Last, because it commits.
test("an import of a duplicate's id that waits on its merge is refused", async () => {
	await db.query(
		`insert into party (id, kind, name) values ('${OLD}', 'person', 'Avery E. Example')`,
	);
	const sessions = [await connect(), await connect()];
	try {
		const [merge, reimport] = sessions as [pg.Client, pg.Client];
		const { pid } = (await reimport.query("select pg_backend_pid() as pid"))
			.rows[0];
		await merge.query("begin");
		await merge.query(`select merge_party('${OLD}', '${AGENT}')`);
		let settled = false;
		const waiting = reimport
			.query(
				`insert into party (id, kind, name) values ('${OLD}', 'person', 'Avery E. Example')`,
			)
			.finally(() => {
				settled = true;
			});
		const blocked = async () =>
			(await db.query("select pg_blocking_pids($1) <> '{}' as blocked", [pid]))
				.rows[0].blocked;
		// Handled from the start, because the refusal can arrive before the commit's reply.
		const refused = assert.rejects(waiting, {
			constraint: "party_never_merged",
		});
		while (!settled && !(await blocked()));
		await merge.query("commit");
		await refused;
	} finally {
		await Promise.all(sessions.map((session) => session.end()));
	}
});

const BRAND = id(700);
const NEXT_BRAND = id(701);
const CLIENT_PROFILE = `
insert into role (slug, label) values ('national_account', 'National account');
insert into client_type values ('franchise', 'Franchise'), ('independent', 'Independent');
insert into client (party_id, status, client_type) values ('${CLIENT}', 'engaged', 'franchise');
insert into party (id, kind, name) values
	('${BRAND}', 'company', 'Example Brand'), ('${NEXT_BRAND}', 'company', 'Example Next Brand');
insert into party_role (party_id, role) values ('${BRAND}', 'national_account');
insert into national_account (party_id) values ('${BRAND}');
insert into client_brand (id, location_id, brand_id, started_on, ended_on)
values ('${id(702)}', '${CLIENT}', '${BRAND}', '2020-01-01', '2026-01-01');
insert into national_account_owner (id, account_id, owner_id, started_on, ended_on)
values ('${id(703)}', '${BRAND}', '${AGENT}', '2020-01-01', '2026-01-01');
`;

test("clients derive active and past status from deals, keeping the manual status", async () => {
	await rolledBack(async () => {
		await db.query(CLIENT_PROFILE);
		await db.query(`update party set how_found = 'referral' where id = '${NEXT_BRAND}';
		insert into party_role (party_id, role) values ('${NEXT_BRAND}', 'client');
		insert into client (party_id, status) values ('${NEXT_BRAND}', 'engaged')`);
		await db.query(`insert into deal (id, name, owner_user_id) values ('${id(710)}', 'Example new work', '${USER}');
		insert into deal_party (deal_id, party_id, role) values ('${id(710)}', '${NEXT_BRAND}', 'client');`);
		const status = async () =>
			(
				await db.query(
					`select status from client_status where party_id = '${NEXT_BRAND}'`,
				)
			).rows[0].status;
		assert.equal(await status(), "active_deal");
		await db.query(`insert into phase (slug, label) values ('closed', 'Closed');
		insert into deal_phase_change values ('${id(710)}', '2026-04-01', 'closed', null)`);
		assert.equal(await status(), "past_client");
		await db.query(`insert into deal_phase_change values ('${id(710)}', '2026-05-01', 'dead', 'Example');
		update client set status = 'paused', client_type = 'independent' where party_id = '${NEXT_BRAND}'`);
		assert.equal(await status(), "past_client");
		await db.query(
			`insert into deal_phase_change values ('${id(710)}', '2026-06-01', 'legal', null)`,
		);
		assert.equal(await status(), "active_deal");
		await db.query(
			`delete from deal_party where deal_id = '${id(710)}' and role = 'client'`,
		);
		assert.equal(await status(), "paused");
	});
});

test("a rebrand and a new outside owner keep the previous dated membership", async () => {
	await rolledBack(async () => {
		await db.query(CLIENT_PROFILE);
		await db.query(`insert into client_brand (location_id, brand_id, started_on)
		values ('${CLIENT}', '${NEXT_BRAND}', '2026-01-01');
		insert into national_account_owner (account_id, owner_id, started_on)
		values ('${BRAND}', '${USER}', '2026-01-01');
		update client_brand set started_on = '2026-02-01', ended_on = '2027-01-01' where brand_id = '${NEXT_BRAND}';
		update national_account_owner set started_on = '2026-02-01', ended_on = '2027-01-01' where owner_id = '${USER}';
		update client_type set label = 'Example franchise' where slug = 'franchise'`);
		for (const [date, national] of [
			["2025-12-31", true],
			["2026-01-01", false],
		] as const) {
			const { rows } = await db.query(
				`select exists (select from client_brand b join national_account n
			on n.party_id = b.brand_id where b.location_id = '${CLIENT}'
			and daterange(b.started_on, b.ended_on) @> $1::date) as national`,
				[date],
			);
			assert.equal(rows[0].national, national);
		}
		assert.deepEqual(
			(
				await db.query(
					`select owner_id from national_account_owner order by started_on`,
				)
			).rows,
			[{ owner_id: AGENT }, { owner_id: USER }],
		);
	});
});

// biome-ignore format: one row per refusal
const CLIENT_REFUSALS: Case[] = [
	[`update client set status = 'active_deal'`, "client_status_check"],
	[`update client set status = 'past_client'`, "client_status_check"],
	[`update client set client_type = 'unknown'`, "client_client_type_fkey"],
	[`insert into client (party_id) values ('${AGENT}')`, "client_party_id_role_fkey"],
	[`insert into client (party_id, role) values ('${AGENT}', 'listing_agent')`, "client_role_check"],
	[`insert into party_role (party_id, role) values ('${USER}', 'national_account');
	insert into national_account (party_id) values ('${USER}')`, "national_account_party_id_kind_fkey"],
	[`insert into national_account (party_id) values ('${NEXT_BRAND}')`, "national_account_party_id_role_fkey"],
	[`insert into national_account (party_id, role) values ('${CLIENT}', 'client')`, "national_account_role_check"],
	[`insert into client_brand (location_id, brand_id, started_on) values ('${CLIENT}', '${CLIENT}', '2026-01-01')`, "client_brand_different_companies"],
	[`insert into client_brand (location_id, brand_id, started_on) values ('${CLIENT}', '${AGENT}', '2026-01-01')`, "client_brand_brand_id_brand_kind_fkey"],
	[`insert into client_brand (location_id, brand_id, started_on) values ('${NEXT_BRAND}', '${BRAND}', '2026-01-01')`, "client_brand_location_id_fkey"],
	[`insert into party_role (party_id, role) values ('${USER}', 'client');
	insert into client (party_id) values ('${USER}');
	insert into client_brand (location_id, brand_id, started_on) values ('${USER}', '${BRAND}', '2026-01-01')`, "client_brand_location_id_location_kind_fkey"],
	[`update client_brand set ended_on = '2020-01-01'`, "client_brand_check"],
	[`update national_account_owner set ended_on = '2020-01-01'`, "national_account_owner_check"],
	[`insert into national_account_owner (account_id, owner_id, started_on) values ('${BRAND}', '${CLIENT}', '2026-01-01')`, "national_account_owner_owner_id_owner_kind_fkey"],
	[`insert into national_account_owner (account_id, owner_id, started_on) values ('${NEXT_BRAND}', '${AGENT}', '2026-01-01')`, "national_account_owner_account_id_fkey"],
	...(["client_brand", "national_account_owner"] as const).flatMap(
		(table): Case[] => {
			const columns =
				table === "client_brand"
					? "location_id, brand_id"
					: "account_id, owner_id";
			const values =
				table === "client_brand"
					? `'${CLIENT}', '${NEXT_BRAND}'`
					: `'${BRAND}', '${USER}'`;
			return [
				[
					`insert into ${table} (${columns}, started_on) values (${values}, '2025-01-01')`,
					`${table}_${table === "client_brand" ? "location_id" : "account_id"}_daterange_excl`,
				],
				[
					`insert into ${table} (${columns}, started_on) values (${values}, '2026-01-01'); update ${table} set ended_on = '2027-01-01' where started_on = '2020-01-01'`,
					`${table}_${table === "client_brand" ? "location_id" : "account_id"}_daterange_excl`,
				],
			];
		},
	),
];
for (const [sql, refusal] of CLIENT_REFUSALS) {
	test(`client rule refuses ${sql}`, async () => {
		await rolledBack(async () => {
			await db.query(CLIENT_PROFILE);
			await assert.rejects(db.query(sql), expected(refusal));
		});
	});
}

test("a merge carries a client and its brand, and refuses conflicting profiles", async () => {
	await rolledBack(async () => {
		await db.query(CLIENT_PROFILE);
		await db.query(`select merge_party('${BRAND}', '${NEXT_BRAND}')`);
		assert.equal(
			(await db.query(`select brand_id from client_brand`)).rows[0].brand_id,
			NEXT_BRAND,
		);
		assert.equal(
			(await db.query(`select account_id from national_account_owner`)).rows[0]
				.account_id,
			NEXT_BRAND,
		);
		await db.query(`update party set how_found = 'referral' where id = '${NEXT_BRAND}';
		insert into party_role (party_id, role) values ('${NEXT_BRAND}', 'client');
		insert into client (party_id) values ('${NEXT_BRAND}')`);
		await assert.rejects(
			db.query(`select merge_party('${CLIENT}', '${NEXT_BRAND}')`),
			expected("merge_party_client_profiles"),
		);
	});
});

test("a merge refuses two national account profiles", async () => {
	await rolledBack(async () => {
		await db.query(CLIENT_PROFILE);
		await db.query(`insert into party_role (party_id, role) values ('${NEXT_BRAND}', 'national_account');
		insert into national_account (party_id) values ('${NEXT_BRAND}')`);
		await assert.rejects(
			db.query(`select merge_party('${BRAND}', '${NEXT_BRAND}')`),
			expected("merge_party_client_profiles"),
		);
	});
});

for (const table of ["client_brand", "national_account_owner"]) {
	test(`${table} serializes concurrent overlapping saves`, async () => {
		const [first, second] = [await connect(), await connect()];
		try {
			await first.query(`begin; ${CLIENT_PROFILE}`);
			await first.query("commit; begin");
			const columns =
				table === "client_brand"
					? "location_id, brand_id"
					: "account_id, owner_id";
			const values =
				table === "client_brand"
					? `'${CLIENT}', '${NEXT_BRAND}'`
					: `'${BRAND}', '${USER}'`;
			const save = `insert into ${table} (${columns}, started_on) values (${values}, '2026-01-01')`;
			await first.query(save);
			await second.query("begin isolation level repeatable read");
			const { pid } = (await second.query("select pg_backend_pid() as pid"))
				.rows[0];
			let settled = false;
			const refusal = assert.rejects(
				second.query(save).finally(() => {
					settled = true;
				}),
				{ code: "23P01" },
			);
			while (
				!settled &&
				!(
					await db.query("select pg_blocking_pids($1) <> '{}' as blocked", [
						pid,
					])
				).rows[0].blocked
			);
			await first.query("commit");
			await refusal;
		} finally {
			await first.query("rollback");
			await second.query("rollback");
			await Promise.all([first.end(), second.end()]);
			// These fixtures committed only to let a second session see the same parents.
			const owner = await connect("none");
			await owner.query(`delete from client_brand; delete from national_account_owner;
			delete from national_account; delete from client; delete from client_type;
			delete from party_role where role = 'national_account'; delete from role where slug = 'national_account';
			delete from party where id in ('${BRAND}', '${NEXT_BRAND}')`);
			await owner.end();
		}
	});
}

test("a merge moves lone profiles onto bare roles even after foreign keys are recreated", async () => {
	const owner = await connect("none");
	try {
		await owner.query(`begin; ${CLIENT_PROFILE}
		set constraints all immediate;
		alter table party_role drop constraint party_role_party_id_fkey;
		alter table party_role add foreign key (party_id) references party;
		set constraints all deferred;
		update party set how_found = 'referral' where id = '${BROKERAGES[0]}';
		insert into party_role (party_id, role) values ('${BROKERAGES[0]}', 'client');
		select merge_party('${BRAND}', '${NEXT_BRAND}');
		insert into party_role (party_id, role) values ('${BROKERAGES[1]}', 'national_account');
		select merge_party('${NEXT_BRAND}', '${BROKERAGES[1]}');
		select merge_party('${CLIENT}', '${BROKERAGES[0]}');
		set constraints all immediate`);
		assert.deepEqual(
			(await owner.query("select location_id, brand_id from client_brand"))
				.rows,
			[{ location_id: BROKERAGES[0], brand_id: BROKERAGES[1] }],
		);
		assert.equal(
			(await owner.query("select account_id from national_account_owner"))
				.rows[0].account_id,
			BROKERAGES[1],
		);
	} finally {
		await owner.query("rollback");
		await owner.end();
	}
});

test("outreach respects an indefinite stop and a pause through its end date", () =>
	rolledBack(async () => {
		await db.query(`insert into do_not_contact (party_id, reason, until_date) values ('${CLIENT}', 'Example pause', current_date);
   update do_not_contact set until_date = current_date - 1 where party_id = '${AGENT}'`);
		assert.deepEqual(
			(await db.query("select party_id from active_do_not_contact")).rows,
			[{ party_id: CLIENT }],
		);
		await db.query(
			`update do_not_contact set until_date = null where party_id = '${AGENT}'`,
		);
		assert.equal(
			(await db.query("select count(*) from active_do_not_contact")).rows[0]
				.count,
			"2",
		);
	}));
for (const [left, right] of [
	[true, false],
	[false, true],
]) {
	test(`a vendor merge keeps a target from either side: ${left}, ${right}`, () =>
		rolledBack(async () => {
			await db.query(`insert into party (id, kind, name) values ('${id(980)}', 'company', 'Example vendor');
    insert into party_role (party_id, role, is_target) values ('${id(980)}', 'vendor', ${left});
    update party_role set is_target = ${right} where party_id = '${VENDOR}' and role = 'vendor';
    select merge_party('${id(980)}', '${VENDOR}')`);
			assert.equal(
				(
					await db.query(
						"select is_target from party_role where party_id = $1 and role = 'vendor'",
						[VENDOR],
					)
				).rows[0].is_target,
				true,
			);
		}));
}
for (const [first, second, expected] of [
	["null", "current_date", null],
	["current_date", "null", null],
	["current_date", "current_date + 1", 1],
	["current_date + 1", "current_date", 1],
] as const) {
	test(`a merge keeps the longest stop: ${first}, ${second}`, () =>
		rolledBack(async () => {
			await db.query(`insert into party (id, kind, name) values ('${id(980)}', 'company', 'Example one'), ('${id(981)}', 'company', 'Example two');
    insert into do_not_contact (party_id, reason, until_date) values ('${id(980)}', 'Example one', ${first}), ('${id(981)}', 'Example two', ${second});
    select merge_party('${id(980)}', '${id(981)}')`);
			assert.deepEqual(
				(
					await db.query(
						"select reason, until_date - current_date as days from do_not_contact where party_id = $1",
						[id(981)],
					)
				).rows,
				[
					{
						reason:
							(expected === null && first === "null") ||
							first === "current_date + 1"
								? "Example one"
								: "Example two",
						days: expected,
					},
				],
			);
		}));
}

test("only the owner erases a removed record's values, keeping who and when and recording the erase", async () => {
	const owner = await connect("none");
	try {
		await owner.query(`begin; ${asUser(TEAMMATE)}`);
		await owner.query(`insert into activity (id, kind, happened_at, summary) values ('${id(982)}', 'note', now(), 'Example private note');
   update activity set summary = 'Example corrected note' where id = '${id(982)}';
   delete from activity where id = '${id(982)}'`);
		await owner.query(`insert into activity (id, kind, happened_at) values ('${id(983)}', 'email', now());
			insert into activity_about (activity_id, party_id) values ('${id(983)}', '${CLIENT}');
			insert into email (activity_id, message_id, sender, subject, body)
			values ('${id(983)}', '<erase@example.com>', 'erase@example.com', 'Example subject', 'Example private body');
			delete from email where activity_id = '${id(983)}';
			select erase_change((select max(id) from change where table_name = 'email' and action = 'delete' and record = jsonb_build_object('activity_id', '${id(983)}')), array['subject', 'body'])`);
		assert.equal(
			(
				await owner.query(
					"select count(*) from change where table_name = 'email' and record = $1 and (old_value ?| array['subject','body'] or new_value ?| array['subject','body'])",
					[{ activity_id: id(983) }],
				)
			).rows[0].count,
			"0",
		);
		const before = (
			await owner.query(
				"select id, table_name, record, action, changed_by_user_id, changed_at, merge_of from change where record = $1 order by id",
				[{ id: id(982) }],
			)
		).rows;
		const removed = before.at(-1);
		assert.ok(removed);
		await owner.query("savepoint invalid_erase");
		await assert.rejects(
			owner.query("select erase_change($1, array['summary'])", [before[0].id]),
			{ code: "P0002" },
		);
		await owner.query("rollback to invalid_erase");
		for (const fields of [[], ["happened_at"], ["id"], ["missing"], [null]]) {
			await assert.rejects(
				owner.query("select erase_change($1, $2)", [removed.id, fields]),
				{ code: "23514", constraint: "erase_only_text_fields" },
			);
			await owner.query("rollback to invalid_erase");
		}

		await owner.query(asUser(USER));
		await owner.query("select erase_change($1, array['summary'])", [
			removed.id,
		]);
		const after = (
			await owner.query(
				"select id, table_name, record, action, changed_by_user_id, changed_at, merge_of, old_value, new_value from change where record = $1 order by id",
				[{ id: id(982) }],
			)
		).rows;
		assert.deepEqual(
			after.slice(0, -1).map(({ old_value, new_value, ...metadata }) => {
				assert.equal(old_value?.summary, undefined);
				assert.equal(new_value?.summary, undefined);
				return metadata;
			}),
			before,
		);
		assert.equal(after.at(-1).action, "erase");
		assert.deepEqual(after.at(-1).new_value, { fields: ["summary"] });
		assert.equal(after[0].new_value.kind, "note");
		assert.ok(after[0].new_value.happened_at);
		assert.equal(after.at(-1).changed_by_user_id, USER);
		assert.ok(after.at(-1).changed_at);
		await owner.query("select erase_change($1, array['summary'])", [
			removed.id,
		]);
		assert.equal(
			(
				await owner.query("select count(*) from change where record = $1", [
					{ id: id(982) },
				])
			).rows[0].count,
			"4",
		);
		assert.equal(
			(
				await owner.query(
					"select new_value->>'summary' as summary from change where table_name = 'activity' and record = $1 and action = 'insert'",
					[{ id: NOTE }],
				)
			).rows[0].summary,
			"Example prefers mornings",
		);
		await owner.query(
			`insert into activity (id, kind, happened_at, summary) values ('${id(982)}', 'note', now(), 'Example recreated note')`,
		);
		await assert.rejects(
			owner.query("select erase_change($1, array['summary'])", [removed.id]),
			{
				code: "23514",
				constraint: "erase_only_removed",
			},
		);
	} finally {
		await owner.query("rollback");
		await owner.end();
	}
});

test("a lease amendment preserves earlier terms and options while the ending list uses the latest version", async () => {
	await rolledBack(async () => {
		await db.query(`${newLease({ rent_per_sf_yr: 35, term_months: 84 })}; ${newOption()};
			${newOption({ number: 2, kind: "expansion" })}; ${newOption({ number: 3, kind: "early_termination" })}`);
		await db.query(
			newLease({
				id: id(701),
				version: 2,
				offer_id: null,
				expiration_on: "2034-06-30",
			}),
		);
		const { rows } = await db.query(
			`select version, expiration_on::text from current_lease where deal_id = '${DEAL}'`,
		);
		assert.deepEqual(rows, [{ version: 2, expiration_on: "2034-06-30" }]);
		assert.equal(
			(await db.query(`select count(*) from lease where deal_id = '${DEAL}'`))
				.rows[0].count,
			"2",
		);
		assert.equal(
			(
				await db.query(
					`select count(*) from lease_option where lease_id = '${LEASE}'`,
				)
			).rows[0].count,
			"3",
		);
		assert.equal(
			(
				await db.query(
					`select changed_by_user_id from lease where id = '${LEASE}'`,
				)
			).rows[0].changed_by_user_id,
			USER,
		);
		assert.equal(
			(
				await db.query(
					"select count(*) from change where table_name in ('lease', 'lease_option')",
				)
			).rows[0].count,
			"5",
		);
	});
});

test("signed terms survive a later accepted round on the deal", async () => {
	await rolledBack(async () => {
		await db.query(newLease({ rent_per_sf_yr: 35 }));
		await db.query(`update offer set status = 'superseded' where id = '${id(102)}';
			insert into offer (deal_id, property_id, round, from_party_id, from_role, offered_at, status)
			values ('${DEAL}', '${PROPERTY}', 4, '${CLIENT}', 'client', now(), 'accepted');
			${CHECK_AT_COMMIT}`);
		assert.deepEqual(
			(
				await db.query(
					`select offer_id, rent_per_sf_yr from current_lease where id = '${LEASE}'`,
				)
			).rows,
			[{ offer_id: id(102), rent_per_sf_yr: "35.00" }],
		);
	});
});

test("sourced options can be extracted later for a historical lease version", async () => {
	await rolledBack(async () => {
		await db.query(
			`${newLease()}; ${newLease({ id: id(701), version: 2, offer_id: null })}; ${newOption()}`,
		);
		assert.equal(
			(await db.query(`select lease_id from lease_option`)).rows[0].lease_id,
			LEASE,
		);
	});
});

test("lease and LOI dates are repeatable proposals, then a user's confirmation survives resolution", async () => {
	await rolledBack(async () => {
		await db.query(`${newLease({ rent_starts_on: "2026-07-01" })}; ${newOption()};
			insert into offer (deal_id, property_id, round, from_party_id, from_role, offered_at, expires_on)
			values ('${DEAL}', '${PROPERTY}', 4, '${CLIENT}', 'client', now(), '2026-06-10');
			select propose_critical_dates('${DEAL}'); select propose_critical_dates('${DEAL}')`);
		assert.deepEqual(
			(
				await db.query(
					"select kind, status, due_on::text from critical_date order by kind",
				)
			).rows,
			[
				{ kind: "lease_end", status: "proposed", due_on: "2033-06-30" },
				{ kind: "loi_expiry", status: "proposed", due_on: "2026-06-10" },
				{ kind: "option_notice", status: "proposed", due_on: "2032-12-31" },
				{ kind: "rent_start", status: "proposed", due_on: "2026-07-01" },
			],
		);
		await db.query("update critical_date set status = 'open'");
		await db.query(
			`${asUser(TEAMMATE)}; update critical_date set status = 'done', resolution_reason = 'Example completed'`,
		);
		const { rows } = await db.query(
			"select distinct confirmed_by_user_id, resolved_by_user_id, confirmed_at = transaction_timestamp() as confirmed_now from critical_date",
		);
		assert.deepEqual(rows, [
			{
				confirmed_by_user_id: USER,
				resolved_by_user_id: TEAMMATE,
				confirmed_now: true,
			},
		]);
	});
});

for (const [start, end] of [
	["proposed", "dropped"],
	["open", "dropped"],
	["open", "passed"],
]) {
	test(`a user moves a critical date from ${start} to ${end}`, async () => {
		await rolledBack(async () => {
			await db.query(newCriticalDate());
			if (start === "open")
				await db.query("update critical_date set status = 'open'");
			await db.query(
				`update critical_date set status = '${end}', resolution_reason = 'Example decision'`,
			);
			assert.deepEqual(
				(
					await db.query(
						"select status, confirmed_by_user_id, resolved_by_user_id from critical_date",
					)
				).rows,
				[
					{
						status: end,
						confirmed_by_user_id: start === "open" ? USER : null,
						resolved_by_user_id: USER,
					},
				],
			);
		});
	});
}

test("distinct manually sourced deadlines may share their kind and day", async () => {
	await rolledBack(async () => {
		await db.query(
			`${newCriticalDate()}; ${newCriticalDate({ id: id(711), source: "Another example agreement" })}`,
		);
		assert.equal(
			(await db.query("select count(*) from critical_date")).rows[0].count,
			"2",
		);
	});
});
