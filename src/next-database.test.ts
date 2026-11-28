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
// Referenced only by its role, so removing it can break exactly one link.
const ROLE_ONLY = id(15);
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
insert into document_kind values ('loi', 'LOI'), ('lease', 'Lease'), ('amendment', 'Amendment'), ('invoice', 'Invoice'), ('other', 'Other');
insert into role (slug, label, category_of) values
	('client', 'Client', null), ('lead', 'Lead', null), ('listing_agent', 'Listing agent', null), ('vendor', 'Vendor', null),
	('lender', 'Lender', 'vendor'), ('title', 'Title', 'vendor');
insert into how_found values ('referral', 'Referral'), ('vendor', 'Vendor'), ('public_records', 'Public records'),
	('not_recorded', 'Not recorded before this system');
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
insert into claim_type values
	('finality', 'Best and final'), ('authority', 'Authority limit'), ('competing_interest', 'Competing interest');
insert into property (id, address) values
	('${PROPERTY}', '100 Example Way, Springfield'), ('${ELSEWHERE}', '200 Example Way, Springfield');
insert into deal_kind values ('lease', 'Lease'), ('purchase', 'Purchase');
insert into deal_reason values ('start_up', 'Start-up'), ('relocation', 'Relocation'), ('renewal', 'Renewal');
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
insert into next_step (id, what, owner_party_id, due_on, resolution, done_at, deal_id, party_id) values
	('${id(400)}', 'Start the lease draft', null, '2026-03-20', null, null, '${DEAL}', null),
	('${id(401)}', 'Send the signed LOI', '${CLIENT}', '2026-03-13', 'done', '2026-03-13T18:00:00+00:00', '${DEAL}', null),
	('${id(402)}', 'Ask about a second location', null, null, null, null, null, '${CLIENT}');
-- Quiet hours may run past midnight.
insert into user_preference (user_id, time_zone, quiet_from, quiet_until, push_to_device) values
	('${USER}', 'America/Chicago', '21:00', '07:00', true);
insert into home_mark (user_id, next_step_id, disposition, snoozed_until, waiting_on_party_id, waiting_reason) values
	('${USER}', '${id(400)}', 'snoozed', '2026-03-21T14:00:00+00:00', null, null),
	('${TEAMMATE}', '${id(400)}', null, null, '${CLIENT}', 'Example: waiting on the signed LOI');
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
		// Not recorded on our LOI; tight once another tenant was looking.
		submarket_condition: i ? "tight" : null,
		documents: [
			{
				id: id(200 + i),
				name: `LOI round ${i + 1}.pdf`,
				r2_key: `example/loi-${i + 1}.pdf`,
				r2_bucket: "post_media",
				content_type: null,
				deal_id: null,
				kind: null,
				version: 1,
				supersedes_id: null,
				previous_version: null,
				sha256: null,
				bytes: null,
				note: null,
			},
		],
		// The landlord's counter claims a floor below its own rent, and another tenant.
		claims:
			i === 1
				? [
						{
							claim_type: "authority",
							floor_rent_per_sf_yr: 34,
							quote: "The owner will not go below 34",
							note: null,
						},
						{
							claim_type: "competing_interest",
							floor_rent_per_sf_yr: null,
							quote: "Another tenant is looking at the space",
							note: "Said on the call, not in the counter",
						},
					]
				: [],
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
const newClaim = (row: Record<string, string | number>) =>
	insert("offer_claim", {
		offer_id: id(101),
		claim_type: "finality",
		...row,
	});
// Runs the checks commit would run, inside a transaction the test still rolls back.
// Later statements in the transaction are then checked as they run.
const CHECK_AT_COMMIT = "set constraints all immediate";
const newEmail = (
	activity: string,
	messageId = `<${activity}@example.com>`,
	conversationId: string | null = null,
) =>
	`insert into activity (id, kind, happened_at) values ('${activity}', 'email', now());
	${insert("email", {
		activity_id: activity,
		message_id: messageId,
		conversation_id: conversationId,
		sender: "avery@example.com",
		subject: "Example",
		body: "Example",
	})}`;
// Only today's mail, copied by the owner, may lack its Message-ID.
const emailWithoutId = (activity: string, subject: string, imported: boolean) =>
	`insert into activity (id, kind, happened_at) values ('${activity}', 'email', '2026-03-01');
	insert into email (activity_id, message_id, sender, subject, body${imported ? ", imported" : ""})
	values ('${activity}', null, 'avery@example.com', '${subject}', 'Example'${imported ? ", true" : ""})`;
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
insert into app_user (id, slug) values ('${USER}', 'joe'), ('${TEAMMATE}', 'dell')`;
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
insert into party_link (kind, party_id, other_party_id, started_on, note) values
	('knows', '${AGENT}', '${DOCTOR}', '2024-05-01', 'Example: trained together'),
	('can_introduce', '${VENDOR}', '${DOCTOR}', null, null);
`;
const LEAD_SEED = `
insert into lead_lane (slug, label) values ('renewal_radar', 'Renewal radar'), ('new_entity', 'New entity');
insert into stage values
	('lead', 'qualified', 'Qualified'), ('lead', 'outreach_active', 'Outreach active'), ('lead', 'archived', 'Archived'),
	('lead', 'new', 'New'), ('lead', 'engaged', 'Engaged'), ('lead', 'nurture', 'Nurture'), ('lead', 'opportunity', 'Opportunity');
insert into party (id, kind, name, how_found) values ('${LEAD}', 'person', 'Dr. Example Lead', 'public_records');
insert into party_role (party_id, role, stage, owner_user_id) values ('${LEAD}', 'lead', 'nurture', '${TEAMMATE}');
insert into activity_about (activity_id, party_id) values ('${CALL}', '${LEAD}'), ('${NOTE}', '${LEAD}');
`;
// Made up, so two sessions can race on one commission and one ladder.
const COMMISSION_SEED = `
insert into commission_tier (user_id, from_deal, partner_user_id, closing_share) values
	('${TEAMMATE}', 1, '${USER}', 0.8), ('${TEAMMATE}', 3, '${USER}', 0.6);
insert into commission (deal_id, gross) values ('${LENDER_DEAL}', 1000);
`;
const newIntroduction = (row: Record<string, string | null>) =>
	insert("introduction", {
		vendor_id: VENDOR,
		made_by: "team",
		introduced_by_user_id: USER,
		introduced_party_id: CLIENT,
		...row,
	});
const newMark = (row: Record<string, string | null>) =>
	insert("home_mark", {
		user_id: USER,
		next_step_id: id(402),
		disposition: "snoozed",
		snoozed_until: "2026-03-21T14:00:00+00:00",
		...row,
	});
const newLink = (row: Record<string, string | null>) =>
	insert("party_link", {
		kind: "knows",
		party_id: DOCTOR,
		other_party_id: AGENT,
		started_on: "2024-05-01",
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
	"tour_plan",
	"tour_stop",
	"calendar_agenda",
	"calendar_review_dismissal",
	"email_mailbox",
	"email_recipient",
	"invoice_email",
	"invoice_mailbox",
	"client_vertical",
	"client_research",
	"client_research_fact",
	"vendor_vertical",
	"weekly_review",
	"vendor_loan_program",
	"commission",
	"commission_payment",
	"commission_share",
	"commission_tier",
	"lead_contact_draft",
	"candidate",
	"proposal",
	"reply_draft",
	"reply_draft_document",
	"lease_suite",
	"suite",
	"space_need",
	"building_ownership",
	"lead_lane",
	"client_type",
	"client",
	"national_account",
	"client_brand",
	"national_account_owner",

	"lead_stage_move",
	"role",
	"stage",
	"phase",
	"deal_kind",
	"typical_length",
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
	"market_city",
	"territory",
	"territory_piece",
	"party_territory",
	"party_territory_review",
	"deal",
	"deal_client_website",
	"introduction",
	"party_link",
	"deal_phase_change",
	"deal_plan_date",
	"deal_property",
	"deal_party",
	"imported_deal_party",
	"imported_deal_owner",
	"imported_deal_invoiced",
	"imported_deal_board",
	"activity",
	"activity_about",
	"next_step",
	"user_preference",
	"home_mark",
	"home_update",
	"document",
	"document_extraction",
	"document_kind",
	"party_document",
	"email_document",
	"email",
	"offer",
	"offer_document",
	"claim_type",
	"offer_claim",
	"lease",
	"lease_version",
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
// Reviews a record's membership of a territory; each value is SQL.
const newMembershipReview = ({
	party = VENDOR,
	territory = STATEWIDE,
	hasOffice = "true",
	coverage = "null",
	source = "'Example website'",
} = {}) =>
	`insert into party_territory_review (party_territory_id, has_office, coverage, source)
	select id, ${hasOffice}, ${coverage}, ${source} from party_territory where party_id = '${party}' and territory_id = '${territory}'`;
// Loads every review as the old system's, made at the start of 2024.
const REVIEWED_AT = new Date("2024-01-01T00:00:00Z");
const REVIEWED_BY_OLD_SYSTEM = `set local role none;
	alter table party_territory_review disable trigger user;
	update party_territory_review set reviewed_by_user_id = null, reviewed_by_job = 'old_system',
		reviewed_for_user_id = null, reviewed_at = '${REVIEWED_AT.toISOString()}';
	alter table party_territory_review enable trigger user;
	set local role engine`;
const DUPLICATE_TITLE_COMPANY = `insert into party (id, kind, name) values ('${DUPLICATE}', 'company', 'Example Title Co.')`;
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
	"reply_draft_document",
	"invoice_email",
	"client_vertical",
	"vendor_vertical",
	"vendor_loan_program",
	"lease_suite",
	"suite",
	"space_need",
	"building_ownership",
	"commission",
	"commission_payment",
	"commission_share",
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
	"market_city",
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
	"offer_claim",
	"next_step",
	"user_preference",
	"home_mark",
	"document",
	"document_extraction",
	"party_document",
	"social_account",
	"idea",
	"design_template",
	"post_media",
	"introduction",
	"party_link",
	"party_territory_review",
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
const LEASE_RECORD = id(720);
// The old system's dates, all before the seeded people joined.
const earlierParty = (row: Record<string, string | null> = {}) =>
	insert("imported_deal_party", {
		id: id(9600),
		deal_id: DEAL,
		party_id: AGENT,
		role: "listing_agent",
		started_at: "2025-01-01",
		ended_at: "2025-06-01",
		...row,
	});
const earlierOwner = (row: Record<string, string | null> = {}) =>
	insert("imported_deal_owner", {
		id: id(9610),
		deal_id: DEAL,
		user_id: TEAMMATE,
		started_at: "2025-01-01",
		ended_at: "2025-06-01",
		...row,
	});
const newLease = (row: Record<string, string | number | null> = {}) => {
	const { deal_id = DEAL, property_id = PROPERTY, ...version } = row;
	const record =
		property_id === PROPERTY && deal_id === DEAL ? LEASE_RECORD : id(721);
	return `${insert("lease", { id: record, deal_id, property_id, party_id: CLIENT })} on conflict (id) do nothing;
		${insert("lease_version", {
			id: LEASE,
			lease_id: record,
			version: 1,
			offer_id: id(102),
			document_id: PDF_FILE,
			executed_on: "2026-04-01",
			commencement_on: "2026-07-01",
			expiration_on: "2033-06-30",
			...version,
		})}`;
};
const newOption = (row: Record<string, string | number | null> = {}) =>
	insert("lease_option", {
		lease_version_id: LEASE,
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
const MOVE = id(730);
const newLeadMove = (row: Record<string, string | null> = {}) =>
	insert("lead_stage_move", {
		id: MOVE,
		party_id: LEAD,
		from_stage: "nurture",
		to_stage: "opportunity",
		activity_id: CALL,
		evidence_ref: "example:held-call",
		strength: "weak",
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
const CANDIDATE = id(750);
const newCandidate = (row: Record<string, string | null> = {}) =>
	insert("candidate", {
		id: CANDIDATE,
		source: "example_sweep",
		source_key: "example-1",
		source_row: JSON.stringify({
			license: "example-1",
			email: "example@example.com",
		}),
		name: "Example Candidate",
		qualification: "Example lease window",
		...row,
	});
const buildingFact = (column: string, value: string | number): Case => [
	`update property set ${column} = ${value} where id = '${IN_REACH}'`,
	`property_${column}_check`,
];
const RULES: Record<string, Case[]> = {
	"tours use meetings rather than a separate activity kind": [
		[
			insert("activity", { kind: "tour", happened_at: "2026-04-02T15:00:00Z" }),
			"activity_kind_check",
		],
	],
	"outside leases and renewal deals keep checked identities": [
		[
			`${newLease()}; ${insert("lease", { id: id(722), party_id: CLIENT, property_id: PROPERTY, deal_id: DEAL })}`,
			"lease_deal_id_key",
		],
		[
			`${newLease()}; update deal set reason = 'renewal', renews_lease_id = '${LEASE_RECORD}' where id = '${DEAL}'`,
			"deal_renews_another_lease",
		],
		[
			newLease({ lease_id: MISSING, offer_id: null }),
			"lease_version_lease_id_fkey",
		],
		[
			`${newLease()}; ${insert("deal", { name: "Example Incorrect Reason", owner_user_id: USER, reason: "start_up", renews_lease_id: LEASE_RECORD })}`,
			"deal_renewal_names_lease",
		],
		[
			insert("lease", {
				party_id: CLIENT,
				property_id: PROPERTY,
				client_role: "vendor",
			}),
			"lease_client_role_check",
		],
		[
			insert("lease", { party_id: MISSING, property_id: PROPERTY }),
			"lease_party_id_fkey",
		],
		[
			insert("lease", { party_id: CLIENT, property_id: MISSING }),
			"lease_property_id_fkey",
		],
		[newLease({ deal_id: null }), "lease_from_accepted_offer"],
		[
			insert("lease", {
				party_id: AGENT,
				property_id: PROPERTY,
				deal_id: DEAL,
			}),
			"lease_deal_id_party_id_client_role_fkey",
		],
		["update lease set party_id = null", notGranted("lease")],
		["delete from lease", notGranted("lease")],
		["truncate lease", notGranted("lease")],
		["update deal set reason = 'renewal'", "deal_renewal_names_lease"],
		[
			insert("deal", {
				name: "Example Renewal",
				owner_user_id: USER,
				reason: "renewal",
				renews_lease_id: MISSING,
			}),
			"deal_renews_lease_id_fkey",
		],
	],
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
			`${newLease()}; ${newCriticalDate({ lease_version_id: LEASE, deal_id: LENDER_DEAL })}`,
			"critical_date_lease_on_deal",
		],
		[
			`${newLease()}; ${newCriticalDate({ lease_version_id: LEASE, option_number: "1" })}`,
			"critical_date_lease_version_id_option_number_fkey",
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
		[newLease({ version: 0 }), "lease_version_version_check"],
		[newLease({ version: 2 }), "lease_version_lease_id_previous_version_fkey"],
		[
			newLease({ property_id: ELSEWHERE, offer_id: null }),
			"lease_deal_id_property_id_fkey",
		],
		[newLease({ document_id: MISSING }), "lease_version_document_id_fkey"],
		[
			newLease({ document_id: null }),
			{
				code: "23502",
				message:
					'null value in column "document_id" of relation "lease_version" violates not-null constraint',
			},
		],
		[newLease({ offer_id: id(100) }), "lease_from_accepted_offer"],
		[
			`insert into deal_property values ('${DEAL}', '${ELSEWHERE}');
			${newLease({ property_id: ELSEWHERE })}`,
			"lease_from_accepted_offer",
		],
		[
			`${newLease()}; ${newLease({ id: id(701) })}`,
			"lease_version_lease_id_version_key",
		],
		...[
			"rent_per_sf_yr",
			"nnn_per_sf_yr",
			"ti_per_sf",
			"free_rent_months",
			"escalation_pct",
			"rent_days_after_delivery",
		].map(
			(field): Case => [
				newLease({ [field]: -1 }),
				`lease_version_${field}_check`,
			],
		),
		[newLease({ term_months: 0 }), "lease_version_term_months_check"],
		[newLease({ expiration_on: "2026-07-01" }), "lease_dates_in_order"],
		[newLease({ executed_on: "2034-01-01" }), "lease_dates_in_order"],
		[
			newLease({ rent_starts_on: "2026-07-01", rent_days_after_delivery: 30 }),
			"lease_rent_date_or_days",
		],
		[
			newLease({ expense_structure: " " }),
			"lease_version_expense_structure_check",
		],
		...[
			"update lease_version set version = 2",
			"delete from lease_version",
			"truncate lease_version",
		].map((sql): Case => [sql, notGranted("lease_version")]),
	],
	"lease options have a kind, exact notice deadline and terms, and remain history":
		[
			[newOption(), "lease_option_lease_version_id_fkey"],
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
			`insert into deal_party values ('${LENDER_DEAL}', '${MISSING}', 'client')`,
			"deal_party_party_id_fkey",
		],
		[newPost({ idea_id: MISSING }), "post_idea_id_fkey"],
		[
			`insert into party (id, kind, name) values ('${ROLE_ONLY}', 'person', 'Example');
			insert into party_role values ('${ROLE_ONLY}', 'listing_agent');
			delete from party where id = '${ROLE_ONLY}'`,
			"party_role_party_id_fkey",
		],
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
	"a person or company has a known kind, and a name the engine saves is never blank":
		[
			[
				"insert into party (kind, name) values ('household', 'Example')",
				"party_kind_check",
			],
			[
				`${asUser(USER)}; insert into party (kind, name) values ('person', ' ')`,
				"party_name_saved_nonblank",
			],
			[
				`${asUser(USER)}; update party set name = '' where id = '${AGENT}'`,
				"party_name_saved_nonblank",
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
	"lead attention is never unknown and only a user can set or clear it": [
		[
			`${asJob("old_system")}; update party_role set needs_attention = true where party_id = '${LEAD}' and role = 'lead'`,
			"lead_flagged_by_a_user",
		],
		[
			`update party_role set needs_attention = true where party_id = '${LEAD}' and role = 'lead';
				${asJob("old_system")}; update party_role set needs_attention = false where party_id = '${LEAD}' and role = 'lead'`,
			"lead_flagged_by_a_user",
		],
		[
			`update party_role set needs_attention = true where party_id = '${VENDOR}' and role = 'vendor'`,
			"party_role_attention_only_on_lead",
		],
		[
			`update party_role set needs_attention = null where party_id = '${LEAD}' and role = 'lead'`,
			{
				code: "23502",
				message:
					'null value in column "needs_attention" of relation "party_role" violates not-null constraint',
			},
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
	"a round's submarket, when recorded, is soft, balanced or tight": [
		[
			offer(4, 3, AGENT, "listing_agent", { submarket_condition: "hot" }),
			"offer_submarket_condition_check",
		],
	],
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
				insert("activity_about", { activity_id: CALL, property_id: MISSING }),
				"activity_about_property_id_fkey",
			],
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
				`insert into email_document (email_activity_id, document_id) values ('${CALL}', '${id(201)}')`,
				"email_document_email_activity_id_fkey",
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
			[
				emailWithoutId(id(303), "Example", false),
				"email_message_id_unless_imported",
			],
			[emailWithoutId(id(303), "Example", true), notGranted("email")],
			[newEmail(id(303), ""), "email_message_id_not_blank"],
			[newEmail(id(303), "\t"), "email_message_id_not_blank"],
			...["   ", "", "\t"].map(
				(conversationId): Case => [
					newEmail(id(303), undefined, conversationId),
					"email_conversation_id_not_blank",
				],
			),
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
	"a claim is on a round, of a listed type, once per round, and like the round is never rewritten or removed":
		[
			[newClaim({ offer_id: MISSING }), "offer_claim_offer_id_fkey"],
			[newClaim({ claim_type: "unknown" }), "offer_claim_claim_type_fkey"],
			[
				"insert into claim_type values ('deadline', 'Deadline')",
				"claim_type_slug_check",
			],
			[newClaim({ claim_type: "authority" }), "offer_claim_pkey"],
			[
				newClaim({ floor_rent_per_sf_yr: 0 }),
				"offer_claim_floor_rent_per_sf_yr_check",
			],
			[newClaim({ quote: " \n" }), "offer_claim_quote_check"],
			[newClaim({ note: "" }), "offer_claim_note_check"],
			...[
				"update offer_claim set quote = 'Example'",
				"delete from offer_claim",
				"truncate offer_claim",
			].map((sql): Case => [sql, notGranted("offer_claim")]),
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
	"a building's known name, class and type are never blank, and its year built and stories stay in the old ranges":
		[
			buildingFact("name", "' '"),
			buildingFact("building_class", "''"),
			buildingFact("building_type", "' '"),
			buildingFact("year_built", 1799),
			buildingFact("year_built", 2101),
			buildingFact("stories", 0),
			buildingFact("stories", 61),
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
	"a membership's review names its source and an office or the coverage declared, once per membership":
		[
			[
				newMembershipReview({ hasOffice: "false" }),
				"party_territory_review_says_something",
			],
			[
				newMembershipReview({ hasOffice: "false", coverage: "' '" }),
				"party_territory_review_coverage_check",
			],
			[
				newMembershipReview({ source: "' '" }),
				"party_territory_review_source_check",
			],
			[
				`${newMembershipReview()}; ${newMembershipReview()}`,
				"party_territory_review_pkey",
			],
			[
				`insert into party_territory_review (party_territory_id, has_office, source) values ('${MISSING}', true, 'Example')`,
				"party_territory_review_party_territory_id_fkey",
			],
			[
				`${newMembershipReview()}; delete from party_territory where party_id = '${VENDOR}' and territory_id = '${STATEWIDE}'`,
				"party_territory_review_party_territory_id_fkey",
			],
			[
				`${DUPLICATE_TITLE_COMPANY};
			insert into party_territory (party_id, territory_id, started_on) values ('${DUPLICATE}', '${STATEWIDE}', '2025-07-01');
			${newMembershipReview()}; ${newMembershipReview({ party: DUPLICATE, source: "'Example call'" })};
			select merge_party('${DUPLICATE}', '${VENDOR}')`,
				"party_territory_review_pkey",
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
	"a user's preferences are one row, in a known time zone, with quiet hours that start and end":
		[
			[
				`update user_preference set time_zone = 'Example/Nowhere'`,
				"time_zone_known",
			],
			[
				"update user_preference set quiet_until = null",
				"user_preference_quiet_hours",
			],
			[
				"update user_preference set quiet_from = null",
				"user_preference_quiet_hours",
			],
			[
				"update user_preference set quiet_until = quiet_from",
				"user_preference_quiet_hours",
			],
			[
				`insert into user_preference (user_id, time_zone) values ('${USER}', 'UTC')`,
				"user_preference_pkey",
			],
			[
				`insert into user_preference (user_id, time_zone) values ('${CLIENT}', 'UTC')`,
				"user_preference_user_id_fkey",
			],
			["delete from user_preference", notGranted("user_preference")],
		],
	"a Home mark is one user's, on one item, snoozed until a time, and waiting on someone for a reason":
		[
			[newMark({ disposition: "done" }), "home_mark_disposition_check"],
			[
				newMark({ disposition: "settled", snoozed_until: null }),
				"home_mark_disposition_check",
			],
			[
				newMark({ disposition: "snoozed", drop_reason: "Not needed" }),
				"home_mark_drop_reason",
			],
			[
				newMark({
					disposition: "dropped",
					snoozed_until: null,
					drop_reason: "Not needed",
				}),
				"home_mark_drop_kind",
			],
			[
				newMark({ disposition: "snoozed", snoozed_until: null }),
				"home_mark_snoozed_until",
			],
			[
				newMark({
					disposition: null,
					snoozed_until: "2026-03-21T14:00:00+00:00",
					waiting_on_party_id: CLIENT,
					waiting_reason: "Example",
				}),
				"home_mark_snoozed_until",
			],
			[
				newMark({ waiting_on_party_id: CLIENT }),
				"home_mark_waiting_has_a_reason",
			],
			[
				newMark({ waiting_reason: "Example" }),
				"home_mark_waiting_has_a_reason",
			],
			[
				newMark({ waiting_on_party_id: CLIENT, waiting_reason: " " }),
				"home_mark_waiting_reason_check",
			],
			[
				newMark({ disposition: null, snoozed_until: null }),
				"home_mark_marks_something",
			],
			[newMark({ next_step_id: id(400) }), "home_mark_pkey"],
			[newMark({ user_id: CLIENT }), "home_mark_user_id_fkey"],
			[newMark({ next_step_id: MISSING }), "home_mark_next_step_id_fkey"],
			[
				newMark({ next_step_id: null, call_follow_up_id: id(400) }),
				"home_mark_call_follow_up_id_fkey",
			],
			[newMark({ home_update_id: MISSING }), "home_mark_one_item"],
			[
				newMark({ next_step_id: null, home_update_id: MISSING }),
				"home_mark_home_update_id_user_id_fkey",
			],
			[
				`delete from next_step where id = '${id(400)}'`,
				"home_mark_next_step_id_fkey",
			],
			[
				`update home_mark set next_step_id = '${id(402)}'`,
				notGranted("home_mark"),
			],
		],
	"a knows or can-introduce link joins two different records, ends no earlier than it starts, and a pair has one current link of each kind":
		[
			[newLink({ kind: "introduced" }), "party_link_kind_check"],
			[newLink({ other_party_id: DOCTOR }), "party_link_two_parties"],
			[newLink({ party_id: MISSING }), "party_link_party_id_fkey"],
			[newLink({ other_party_id: MISSING }), "party_link_other_party_id_fkey"],
			[
				newLink({ kind: "can_introduce", ended_on: "2024-01-01" }),
				"party_link_ends_after_it_starts",
			],
			[newLink({ note: " " }), "party_link_note_check"],
			[
				newLink({ party_id: AGENT, other_party_id: DOCTOR }),
				"party_link_knows_once",
			],
			[newLink({}), "party_link_knows_once"],
			[newLink({ started_on: "2025-01-01" }), "party_link_knows_once"],
			[
				newLink({
					kind: "can_introduce",
					party_id: VENDOR,
					started_on: "2025-01-01",
					other_party_id: DOCTOR,
				}),
				"party_link_can_introduce_once",
			],
			[
				`update party_link set ended_on = '2025-01-01' where kind = 'knows';
				${newLink({ started_on: "2025-02-01" })};
				update party_link set ended_on = null where kind = 'knows' and started_on = '2024-05-01'`,
				"party_link_knows_once",
			],
			[
				`update party_link set other_party_id = '${CLIENT}'`,
				notGranted("party_link"),
			],
		],
	"a lead has a stage, and lead or vendor role owners must be users": [
		[
			"update party_role set stage = null where role = 'lead'",
			"party_role_lead_has_a_stage",
		],
		[
			`update party_role set owner_user_id = '${USER}' where role = 'client'`,
			"party_role_owner_on_lead_or_vendor",
		],
		[
			`update party_role set owner_user_id = '${CLIENT}' where role = 'lead'`,
			"party_role_owner_user_id_fkey",
		],
		[
			`update party_role set owner_user_id = '${CLIENT}' where role = 'vendor'`,
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
	"only a record copied from the old system may say how it was found was not recorded":
		[
			[
				`insert into party (id, kind, name, how_found) values ('${id(661)}', 'person', 'Example', 'not_recorded'); ${CHECK_AT_COMMIT}`,
				"how_found_not_recorded_only_imported",
			],
			[
				`update party set how_found = 'not_recorded' where id = '${CLIENT}'; ${CHECK_AT_COMMIT}`,
				"how_found_not_recorded_only_imported",
			],
		],
	"someone a deal is opened for is a client": [
		[
			`insert into deal_party values ('${LENDER_DEAL}', '${LEAD}', 'client'); ${CHECK_AT_COMMIT}`,
			"deal_party_client_is_a_client",
		],
		[
			`delete from party_role where party_id = '${CLIENT}' and role = 'client'; ${CHECK_AT_COMMIT}`,
			"deal_party_client_is_a_client",
		],
	],
	"a deal is for one client, the business": [
		[
			`insert into party_role values ('${DOCTOR}', 'client');
			insert into deal_party values ('${DEAL}', '${DOCTOR}', 'client')`,
			"deal_party_one_client",
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
	"an imported email without its Message-ID is stored once by its sender, sent time and subject":
		[
			[
				`${emailWithoutId(id(303), "Example", true)}; ${emailWithoutId(id(304), "example", true)}`,
				"email_without_message_id_once",
			],
		],
	"only a parked deal has a time it was parked, and a user who parked it only with that time":
		[
			[
				`update deal set parked_at = now() where id = '${DEAL}'`,
				"deal_parked_stamps_when_parked",
			],
			[
				`update deal set parked_by_user_id = '${USER}' where id = '${DEAL}'`,
				"deal_parked_stamps_when_parked",
			],
		],
	"only a parked deal can name automation, which excludes a user as parker": [
		[
			`update deal set parked_automatically = true where id = '${DEAL}'`,
			"deal_automatic_parking_has_no_user",
		],
		[
			`update deal set parking_reason = 'other' where id = '${DEAL}';
			update deal set parked_automatically = true where id = '${DEAL}'`,
			"deal_automatic_parking_has_no_user",
		],
	],
	"loaded outreach drafts still cannot send themselves": [
		[
			newLeadDraft({ requires_human_send: "false" }),
			"lead_contact_draft_requires_human_send_check",
		],
		[
			newLeadDraft({ dispatchable: "true" }),
			"lead_contact_draft_dispatchable_check",
		],
	],
	"a renewal is separate from the deal that negotiated its source lease": [
		[
			`${newLease()}; update deal set reason = 'renewal', renews_lease_id = '${LEASE_RECORD}' where id = '${DEAL}'`,
			"deal_renews_another_lease",
		],
	],
	"an earlier person on a deal left after joining, held the role once at a time and is back only after leaving":
		[
			[
				earlierParty({ ended_at: "2025-01-01" }),
				"imported_deal_party_ends_after_it_starts",
			],
			[
				`${earlierParty()}; ${earlierParty({ id: id(9601), started_at: "2025-05-01", ended_at: "2025-09-01" })}`,
				"imported_deal_party_once_at_a_time",
			],
			[
				`${earlierParty({ started_at: null })}; ${earlierParty({ id: id(9601), started_at: null, ended_at: "2025-09-01" })}`,
				"imported_deal_party_once_at_a_time",
			],
			[
				earlierParty({ ended_at: "2999-01-01" }),
				"deal_party_rejoins_after_leaving",
			],
			[
				`${earlierParty({ party_id: DOCTOR })};
			insert into deal_party (deal_id, party_id, role, created_at) values ('${DEAL}', '${DOCTOR}', 'listing_agent', '2025-03-01')`,
				"deal_party_rejoins_after_leaving",
			],
			[
				`insert into party (id, kind, name) values ('${DUPLICATE}', 'person', 'A. Example');
			${earlierParty()}; ${earlierParty({ id: id(9601), party_id: DUPLICATE })};
			select merge_party('${DUPLICATE}', '${AGENT}')`,
				"imported_deal_party_once_at_a_time",
			],
		],
	"an earlier deal owner held the deal after starting, one owner at a time": [
		[
			earlierOwner({ ended_at: "2025-01-01" }),
			"imported_deal_owner_ends_after_it_starts",
		],
		[
			`${earlierOwner({ started_at: null })}; ${earlierOwner({ id: id(9611), user_id: USER })}`,
			"imported_deal_owner_one_at_a_time",
		],
	],
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
		[
			`insert into app_user (id, slug) values ('${CLIENT}', 'user-${CLIENT}')`,
			"app_user_id_kind_fkey",
		],
	],
	"every user signs in under their own slug": [
		[
			`insert into party (id, kind, name) values ('${DUPLICATE}', 'person', 'A. Example');
			insert into app_user (id) values ('${DUPLICATE}')`,
			{
				code: "23502",
				message:
					'null value in column "slug" of relation "app_user" violates not-null constraint',
			},
		],
		[
			`insert into party (id, kind, name) values ('${DUPLICATE}', 'person', 'A. Example');
			insert into app_user (id, slug) values ('${DUPLICATE}', ' ')`,
			"app_user_slug_check",
		],
		[
			`insert into party (id, kind, name) values ('${DUPLICATE}', 'person', 'A. Example');
			insert into app_user (id, slug) values ('${DUPLICATE}', 'joe')`,
			"app_user_slug_key",
		],
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
		[
			`grant pg_read_all_data to engine_reader; ${RELOAD}`,
			{ message: "role engine_reader holds rights beyond its grants" },
		],
	],
};
// What the engine may change; every other column, and every row of history, stays as stored.
const CHANGEABLE: Record<string, string[]> = {
	tour_plan: ["cancelled_at", "completed_activity_id", "notes", "planned_on"],
	deal_client_website_attempt: ["failed_attempts", "window_started_at"],
	calendar_agenda: ["observed_at", "snapshot"],
	invoice_email: ["deal_id", "payment_id", "status"],
	suite: ["area_basis", "area_sf", "condition", "floor", "label"],
	space_need: [
		"applicability",
		"market_id",
		"max_rate_sf_yr",
		"max_sf",
		"min_sf",
		"must_haves",
		"name",
		"source_ref",
		"source_revision",
		"space_type",
		"vendor_id",
	],
	building_ownership: ["ended_on", "source", "started_on"],
	lead_contact_draft: [
		"approved",
		"body",
		"owner_user_id",
		"scheduled_for",
		"subject",
		"time_zone",
	],
	lead_email_attention: ["acknowledged_at", "acknowledged_by_user_id"],
	candidate: [
		"estimated_lease_on",
		"lease_estimate_source",
		"name",
		"promoted_party_id",
		"qualification",
		"reason",
		"source_row",
		"status",
	],
	lead_lane: ["label"],
	client_type: ["label"],
	client: ["client_type", "status"],
	client_brand: ["ended_on", "started_on"],
	national_account_owner: ["ended_on", "started_on"],

	proposal: [
		"dismiss_reason",
		"filed_deal_id",
		"filed_vendor_id",
		"filing_reason",
		"status",
	],
	reply_draft: [
		"body",
		"cc_address",
		"dismiss_reason",
		"failure_reason",
		"sent_at",
		"sent_item_id",
		"status",
		"subject",
		"to_address",
	],
	commission: ["closing_share", "expected", "gross"],
	commission_payment: ["amount", "due_on", "invoiced_on", "received_on"],
	commission_share: ["share"],
	commission_tier: ["closing_share"],
	role: ["label"],
	do_not_contact: ["until_date"],
	doc_conversation: ["owner_user_id"],
	doc_judgment_job: [
		"claim_id",
		"claim_source_hash",
		"claim_until",
		"result",
		"state",
	],
	doc_link: [
		"backend",
		"credential_hash",
		"issued_at",
		"last_seen_at",
		"readiness",
	],
	doc_turn: [
		"answer",
		"answered_by",
		"claim_id",
		"claim_state",
		"claim_until",
		"confirmation_key",
		"state",
	],
	stage: ["label"],
	how_found: ["label"],
	claim_type: ["label"],
	party_role: [
		"disposition",
		"disposition_reason",
		"estimated_lease_on",
		"is_target",
		"lane",
		"lead_client_id",
		"lease_estimate_confidence",
		"lease_estimate_source",
		"needs_attention",
		"offers",
		"owner_user_id",
		"refers_business",
		"relationship_level",
		"relationship_origin",
		"rivalry_note",
		"seeking",
		"segment",
		"stage",
	],
	introduction: ["deal_id", "introduced_on", "note"],
	party_link: ["ended_on", "note", "started_on"],
	phase: ["label"],
	deal_kind: ["label"],
	typical_length: ["days"],
	deal_reason: ["label"],
	specialty: ["label"],
	party: ["city", "how_found", "how_found_detail", "name", "npi"],
	property: [
		"address",
		"building_class",
		"building_type",
		"county_fips",
		"latitude",
		"longitude",
		"name",
		"stories",
		"year_built",
	],
	market: ["name"],
	territory: ["name"],
	party_territory: ["ended_on", "started_on"],
	party_territory_review: ["coverage", "has_office", "source"],
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
		"renews_lease_id",
	],
	party_company: ["ended_on", "started_on", "title"],
	party_email: ["is_primary", "label"],
	party_phone: ["is_primary", "label"],
	activity: ["from_party_id", "happened_at", "summary"],
	next_step: [
		"done_at",
		"due_on",
		"hold_until",
		"item_bullets",
		"owner_party_id",
		"resolution",
		"resolution_reason",
		"resolved_at",
		"what",
	],
	user_preference: ["push_to_device", "quiet_from", "quiet_until", "time_zone"],
	home_mark: [
		"disposition",
		"drop_reason",
		"snoozed_until",
		"waiting_on_party_id",
		"waiting_reason",
	],
	home_update: ["read_at"],
	deal_attention_alert: ["alerted_at", "owner_user_id", "reason"],
	document: ["bytes", "content_type", "deal_id", "kind", "name", "sha256"],
	document_kind: ["label"],
	offer: ["status"],
	critical_date: ["resolution_reason", "status"],
	email: ["authored", "history"],
	social_account: ["handle", "platform_account_id"],
	idea: ["angle", "hook", "pillar"],
	design_template: ["name"],
	post: ["platform_post_id", "published_at", "reason", "status"],
};
// Columns the engine leaves to their default when it adds a row.
const DEFAULTED: Record<string, string[]> = {
	email: [
		"activity_kind",
		"authored",
		"changed_at",
		"changed_by_job",
		"changed_by_user_id",
		"changed_for_user_id",
		"history",
		"imported",
	],
	next_step: [
		"call_contact_party_id",
		"call_kind",
		"changed_at",
		"changed_by_job",
		"changed_by_user_id",
		"changed_for_user_id",
		"home_call_follow_up_id",
		"home_step_id",
		"resolution_event_id",
		"status",
	],
	invoice_email: [
		"application_id",
		"application_root_id",
		"applied_phase_at",
		"changed_at",
		"changed_by_job",
		"changed_by_user_id",
		"changed_for_user_id",
		"payment_change_id",
		"prior_invoiced_on",
		"prior_phase_at",
		"status",
	],
	offer: [
		"changed_at",
		"changed_by_job",
		"changed_by_user_id",
		"changed_for_user_id",
		"import_id",
		"import_record",
		"import_source",
	],
	lead_contact_draft: [
		"approved",
		"changed_at",
		"changed_by_job",
		"changed_by_user_id",
		"changed_for_user_id",
		"created_at",
		"dispatchable",
		"requires_human_send",
		"revision",
		"role",
	],

	social_account: [
		"changed_at",
		"changed_by_job",
		"changed_by_user_id",
		"changed_for_user_id",
		"engine_publishes_from",
	],
};
const REMOVABLE = [
	"tour_stop",
	"doc_link",
	"deal_client_website_attempt",
	"deal_client_website_grant",
	"deal_attention_alert",
	...STORED_AT.filter(
		(table) =>
			![
				"invoice_email",
				"lease_suite",
				"offer_document",
				"offer_claim",
				"post_media",
				"document",
				"document_extraction",
				"user_preference",
			].includes(table),
	),
	"activity",
	"email",
	"commission_tier",
	"weekly_review",
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
		"insert into invoice_mailbox (address) values ('invoices@example.com')",
	);
	await db.query(
		`set role engine; ${SEED} ${MARKETING_SEED} ${TERRITORY_SEED} ${VENDOR_SEED} ${LEAD_SEED} ${COMMISSION_SEED}`,
	);
	for (const { documents, claims, ...round } of rounds) {
		const columns = Object.keys(round).join(", ");
		await db.query(
			`insert into offer (${columns}, deal_id)
			 select ${columns}, deal_id from jsonb_populate_record(null::offer, $1)`,
			[{ ...round, deal_id: DEAL, status: "open" }],
		);
		for (const document of documents)
			await db.query(
				`with saved as (insert into document (id, name, r2_key)
					select id, name, r2_key
					from jsonb_populate_record(null::document, $1) returning id)
				insert into offer_document select $2, id from saved`,
				[document, round.id],
			);
		for (const claim of claims)
			await db.query(
				`insert into offer_claim (offer_id, claim_type, floor_rent_per_sf_yr, quote, note)
				select $2, claim_type, floor_rent_per_sf_yr, quote, note from jsonb_populate_record(null::offer_claim, $1)`,
				[claim, round.id],
			);
		if (round.answers_round)
			await db.query("update offer set status = 'countered' where round = $1", [
				round.answers_round,
			]);
	}
	await db.query(
		"insert into email_document (email_activity_id, document_id) values ($1, $2)",
		[EMAIL, id(201)],
	);
	await db.query("update offer set status = 'accepted' where round = 3");
});

after(async () => {
	await db.end();
	await asAdmin(`drop database "${name}" with (force)`);
});

const SUBJECT = id(9000);
const COMPANY = id(9001);
const readParty = async (wanted = SUBJECT) =>
	unstamped(
		(await db.query("select everything_about_party($1) as party", [wanted]))
			.rows[0].party,
	);
const withParty = (run: () => Promise<unknown>) =>
	rolledBack(async () => {
		await db.query(`insert into party (id, kind, name, how_found) values
			('${SUBJECT}', 'person', 'Example Reader', 'referral'),
			('${COMPANY}', 'company', 'Example Company', 'referral')`);
		await run();
	});

test("a person with no links returns every empty list; a missing id returns null", async () => {
	await withParty(async () => {
		assert.deepEqual(await readParty(), {
			party: {
				id: SUBJECT,
				kind: "person",
				name: "Example Reader",
				city: null,
				npi: null,
				how_found: "referral",
				how_found_detail: null,
			},
			do_not_contact: null,
			outreach_draft: null,
			brands: [],
			national_account_owners: [],
			leases: [],
			emails: [],
			phones: [],
			companies: [],
			roles: [],
			specialties: [],
			territories: [],
			vendor_verticals: [],
			vendor_loan_programs: [],
			deals: [],
			links: [],
			introductions: [],
			activity: [],
			next_steps: [],
			proposals: [],
			history: unstamped(
				(
					await db.query(
						"select to_jsonb(c) as entry from change c where table_name = 'party' and record = jsonb_build_object('id', $1::uuid)",
						[SUBJECT],
					)
				).rows.map((row) => row.entry),
			),
			imported_history: [],
		});
		assert.equal(await readParty(MISSING), null);
	});
});

test("party history keeps complete native and imported rows in time and id order, excluding children", () =>
	withParty(async () => {
		await db.query(`set constraints all immediate;
			set local role none;
			delete from change where table_name = 'party' and record = '{"id":"${SUBJECT}"}';
			alter table change disable trigger stamp_change;
			alter table imported_change disable trigger stamp_imported_change`);
		const native = [];
		const imported = [];
		for (const [n, day] of [
			[9402, 2],
			[9401, 1],
			[9400, 2],
		] as const) {
			native.push(
				(
					await db.query(
						`insert into change
				(id, table_name, record, action, old_value, new_value, changed_by_job, changed_at)
				overriding system value values ($1, 'party', $2, 'update', '{"name":"Example Before"}',
				'{"name":"Example After"}', 'old_system', $3) returning to_jsonb(change) as entry`,
						[n, { id: SUBJECT }, `2026-01-0${day}T00:00:00Z`],
					)
				).rows[0].entry,
			);
			const event = {
				id: id(n),
				verb: "rename",
				cause: "human",
				actor_id: "example-actor",
				old_value: null,
				new_value: "Example After",
				mutation_order: n,
				occurred_at: `2020-01-0${day}T00:00:00Z`,
				extra: { kept: true },
			};
			imported.push(
				(
					await db.query(
						`insert into imported_change
				(id, table_name, record, old_value_absent, new_value_absent, field, source_event, changed_by_job, changed_at)
				values ($1, 'party', $2, false, false, 'name', $3, 'old_system', $4)
				returning to_jsonb(imported_change) as entry`,
						[id(n), { id: SUBJECT }, event, event.occurred_at],
					)
				).rows[0].entry,
			);
		}
		await db.query(`insert into imported_change
			(id, table_name, record, old_value_absent, new_value_absent, field, source_event, changed_by_job, changed_at)
			select '${id(9403)}', 'party_role', record, true, true, 'stage',
				source_event || '{"id":"${id(9403)}"}', 'old_system', changed_at from imported_change where id = '${id(9400)}';
			alter table change enable trigger stamp_change;
			alter table imported_change enable trigger stamp_imported_change;
			set local role engine;
			insert into party_email (party_id, address, label) values ('${SUBJECT}', 'history@example.com', 'work')`);
		const result = (
			await db.query("select everything_about_party($1) as value", [SUBJECT])
		).rows[0].value;
		assert.deepEqual(result.history, [native[1], native[2], native[0]]);
		assert.deepEqual(result.imported_history, [
			imported[1],
			imported[2],
			imported[0],
		]);
	}));

test("party history follows every merged duplicate, including an earlier merge, from either id", () =>
	withParty(async () => {
		await db.query(`insert into party (id, kind, name) values
			('${id(9410)}', 'person', 'Example Duplicate'), ('${id(9411)}', 'person', 'Example Earlier');
			set local role none;
			insert into imported_change (id, table_name, record, old_value_absent, new_value_absent, field, source_event)
			values ('${id(9412)}', 'party', '{"id":"${id(9411)}"}', true, false, 'name',
				'{"id":"${id(9412)}", "verb":"rename", "cause":"human", "actor_id":"example-actor", "new_value":"Example Earlier"}');
			set local role engine;
			select merge_party('${id(9411)}', '${id(9410)}');
			select merge_party('${id(9410)}', '${SUBJECT}')`);
		const expected = (
			await db.query(`select to_jsonb(c) as entry from change c where table_name = 'party'
			and record in ('{"id":"${SUBJECT}"}', '{"id":"${id(9410)}"}', '{"id":"${id(9411)}"}')
			order by id`)
		).rows.map((row) => row.entry);
		assert.equal(expected.length, 5);
		const imported = (
			await db.query(
				"select to_jsonb(c) as entry from imported_change c where id = $1",
				[id(9412)],
			)
		).rows[0].entry;
		for (const wanted of [SUBJECT, id(9410), id(9411)]) {
			const result = (
				await db.query("select everything_about_party($1) as value", [wanted])
			).rows[0].value;
			assert.deepEqual(result.history, expected);
			assert.deepEqual(result.imported_history, [imported]);
		}
	}));

test("a party without recorded history returns both empty history lists", () =>
	withParty(async () => {
		await db.query(`set local role none;
			delete from change where table_name = 'party' and record = '{"id":"${SUBJECT}"}';
			set local role engine`);
		const result = await readParty();
		assert.deepEqual(result.history, []);
		assert.deepEqual(result.imported_history, []);
	}));

test("party change lookup uses the table and record index", () =>
	rolledBack(async () => {
		await db.query("set local enable_seqscan = off");
		const { rows } = await db.query(
			`explain select * from change
			where table_name = 'party' and record = jsonb_build_object('id', $1::uuid)`,
			[SUBJECT],
		);
		const plan = rows.map((row) => row["QUERY PLAN"]).join("\n");
		assert.match(plan, /change_record/);
		assert.match(plan, /Index Cond:.*table_name.*record/);
	}));

test("party emails put primary first and exclude another person's addresses", async () => {
	await withParty(async () => {
		await db.query(`insert into party_email (id, party_id, address, label, is_primary) values
			('${id(9012)}', '${SUBJECT}', 'z@example.com', 'work', true),
			('${id(9011)}', '${SUBJECT}', 'b@example.com', 'personal', false),
			('${id(9010)}', '${SUBJECT}', 'a@example.com', 'work', false)`);
		assert.deepEqual((await readParty()).emails, [
			{
				id: id(9012),
				address: "z@example.com",
				label: "work",
				is_primary: true,
			},
			{
				id: id(9010),
				address: "a@example.com",
				label: "work",
				is_primary: false,
			},
			{
				id: id(9011),
				address: "b@example.com",
				label: "personal",
				is_primary: false,
			},
		]);
	});
});

test("party phones sort by primary, number and extension with absent extensions last", async () => {
	await withParty(async () => {
		await db.query(`insert into party_phone (id, party_id, number, extension, label, is_primary) values
			('${id(9022)}', '${SUBJECT}', '+12175550199', null, 'mobile', true),
			('${id(9021)}', '${SUBJECT}', '+12175550198', null, 'work', false),
			('${id(9020)}', '${SUBJECT}', '+12175550198', '12', 'work', false)`);
		assert.deepEqual((await readParty()).phones, [
			{
				id: id(9022),
				number: "+12175550199",
				extension: null,
				label: "mobile",
				is_primary: true,
			},
			{
				id: id(9020),
				number: "+12175550198",
				extension: "12",
				label: "work",
				is_primary: false,
			},
			{
				id: id(9021),
				number: "+12175550198",
				extension: null,
				label: "work",
				is_primary: false,
			},
		]);
	});
});

test("company memberships read from either end with dated history and id ties", async () => {
	await withParty(async () => {
		await db.query(`insert into party_company (id, person_id, company_id, title, started_on, ended_on) values
			('${id(9032)}', '${SUBJECT}', '${COMPANY}', 'Current', null, null),
			('${id(9031)}', '${SUBJECT}', '${COMPANY}', 'Former', '2020-01-01', '2021-01-01'),
			('${id(9030)}', '${SUBJECT}', '${BROKERAGES[0]}', 'Other', '2020-01-01', null)`);
		const memberships = (await readParty()).companies;
		assert.deepEqual(
			memberships.map((c: { id: string }) => c.id),
			[id(9030), id(9031), id(9032)],
		);
		assert.equal(memberships[1].title, "Former");
		assert.equal(memberships[1].ended_on, "2021-01-01");
		assert.equal(memberships[1].party.name, "Example Company");
		assert.equal(memberships[1].person_kind, undefined);
		assert.equal(memberships[1].company_kind, undefined);
		const incoming = (await readParty(COMPANY)).companies;
		assert.deepEqual(
			incoming.map((c: { id: string }) => c.id),
			[id(9031), id(9032)],
		);
		assert.equal(incoming[0].party.name, "Example Reader");
	});
});

test("party roles retain lead stage and owner and the client profile", async () => {
	await withParty(async () => {
		await db.query(`insert into party_role (party_id, role, stage, owner_user_id) values
			('${SUBJECT}', 'lead', 'qualified', '${USER}'), ('${SUBJECT}', 'client', null, null);
			insert into client (party_id, status) values ('${SUBJECT}', 'engaged')`);
		const roles = (await readParty()).roles;
		assert.deepEqual(
			roles.map((r: { role: string }) => r.role),
			["client", "lead"],
		);
		assert.equal(roles[0].client.status, "engaged");
		assert.equal(roles[0].client.role, undefined);
		assert.equal(roles[0].client.current_status, "engaged");
		await db.query(`insert into deal_party (deal_id, party_id, role)
			values ('${LENDER_DEAL}', '${SUBJECT}', 'client')`);
		const client = (await readParty()).roles[0].client;
		assert.equal(client.status, "engaged");
		assert.equal(client.current_status, "active_deal");
		assert.equal(roles[1].stage, "qualified");
		assert.equal(roles[1].owner_user_id, USER);
		assert.equal(roles[1].client, null);
	});
});

test("party deals retain multiple roles and sort equal names by id then role", async () => {
	await withParty(async () => {
		await db.query(`insert into deal (id, name, owner_user_id) values
			('${id(9041)}', 'Example work', '${USER}'), ('${id(9040)}', 'Example work', '${USER}');
			insert into deal_party (deal_id, party_id, role) values
			('${id(9041)}', '${SUBJECT}', 'listing_agent'),
			('${id(9040)}', '${SUBJECT}', 'listing_agent'), ('${id(9040)}', '${SUBJECT}', 'vendor')`);
		assert.deepEqual(
			(await readParty()).deals.map((d: { id: string; role: string }) => [
				d.id,
				d.role,
			]),
			[
				[id(9040), "listing_agent"],
				[id(9040), "vendor"],
				[id(9041), "listing_agent"],
			],
		);
	});
});

test("party relationships include incoming and outgoing links, with direction and history", async () => {
	await withParty(async () => {
		await db.query(`insert into party_link (id, kind, party_id, other_party_id, started_on, ended_on) values
			('${id(9052)}', 'knows', '${SUBJECT}', '${COMPANY}', null, null),
			('${id(9051)}', 'can_introduce', '${SUBJECT}', '${AGENT}', '2020-01-01', '2021-01-01'),
			('${id(9050)}', 'can_introduce', '${COMPANY}', '${SUBJECT}', '2020-01-01', null)`);
		const links = (await readParty()).links;
		assert.deepEqual(
			links.map((l: { id: string }) => l.id),
			[id(9050), id(9051), id(9052)],
		);
		assert.equal(links[0].party_id, COMPANY);
		assert.equal(links[0].other_party_id, SUBJECT);
		assert.equal(links[1].ended_on, "2021-01-01");
		assert.equal(links[0].party.name, "Example Company");
		assert.equal(links[2].party.name, "Example Company");
		const incoming = (await readParty(COMPANY)).links;
		assert.deepEqual(
			incoming.map((l: { id: string }) => l.id),
			[id(9050), id(9052)],
		);
		assert.equal(incoming[0].party.name, "Example Reader");
		assert.equal(incoming[1].party.name, "Example Reader");
	});
});

test("party activity is explicit, chronological and once per item with ordered email attachments", async () => {
	await withParty(async () => {
		await db.query(`insert into activity (id, kind, happened_at, from_party_id) values
			('${id(9062)}', 'call', '2020-01-02', '${SUBJECT}'),
			('${id(9061)}', 'email', '2020-01-01', null), ('${id(9060)}', 'note', '2020-01-01', null);
			insert into email (activity_id, message_id, sender, subject, body) values
			('${id(9061)}', '<party-read@example.com>', 'reader@example.com', 'Example subject', 'Example body');
			insert into activity_about (activity_id, party_id) values
			('${id(9061)}', '${SUBJECT}'), ('${id(9060)}', '${SUBJECT}');
			insert into activity_about (activity_id, deal_id) values ('${id(9061)}', '${DEAL}');
			insert into document (id, name, r2_key) values
			('${id(9064)}', 'Example file', 'party-read/second'),
			('${id(9063)}', 'Example file', 'party-read/first');
			insert into email_document (email_activity_id, document_id) values
			('${id(9061)}', '${id(9064)}'), ('${id(9061)}', '${id(9063)}')`);
		const activity = (await readParty()).activity;
		assert.deepEqual(
			activity.map((a: { id: string }) => a.id),
			[id(9060), id(9061)],
		);
		assert.equal(activity[0].email, null);
		assert.equal(activity[1].email.body, "Example body");
		assert.deepEqual(
			activity[1],
			(await readDeal()).activity.find(
				(a: { id: string }) => a.id === id(9061),
			),
		);
		assert.deepEqual(
			activity[1].email.documents.map((d: { id: string }) => d.id),
			[id(9063), id(9064)],
		);
		await db.query(`delete from activity_about where party_id = '${SUBJECT}' and activity_id = '${id(9061)}';
			insert into activity (id, kind, happened_at) values ('${id(9065)}', 'email', '2020-01-03');
			insert into email (activity_id, message_id, sender, subject, body) values
			('${id(9065)}', '<empty-party-read@example.com>', 'reader@example.com', 'No files', 'Example body');
			insert into activity_about (activity_id, party_id) values ('${id(9065)}', '${SUBJECT}')`);
		assert.deepEqual((await readParty()).activity[1].email.documents, []);
	});
});

test("party next steps retain completed steps, sort due dates with id ties and leave undated last", async () => {
	await withParty(async () => {
		await db.query(`insert into next_step (id, what, party_id, due_on, resolution, done_at) values
			('${id(9072)}', 'Undated', '${SUBJECT}', null, 'done', null),
			('${id(9071)}', 'Open', '${SUBJECT}', '2020-01-01', null, null),
			('${id(9070)}', 'Done', '${SUBJECT}', '2020-01-01', 'done', '2020-01-01')`);
		const steps = (await readParty()).next_steps;
		assert.deepEqual(
			steps.map((s: { id: string }) => s.id),
			[id(9070), id(9071), id(9072)],
		);
		assert.equal(steps[0].done_at, "2020-01-01T00:00:00+00:00");
		assert.equal(steps[2].due_on, null);
		assert.equal(steps[0].party_id, undefined);
	});
});

test("ended next steps retain evidence and stay off Home even with marks", async () => {
	await rolledBack(async () => {
		await db.query(`set local role none;
			update next_step set resolution = 'cancelled',
			resolved_at = '2026-03-21T10:00:00Z', resolution_reason = 'No longer needed',
			resolution_event_id = '${id(9400)}' where id = '${id(400)}';
			update next_step set resolution = 'expired', resolution_event_id = '${id(9401)}'
			where id = '${id(402)}';
			set local role engine`);
		const cancelled = (await readDeal()).next_steps.find(
			(s: { id: string }) => s.id === id(400),
		);
		assert.equal(cancelled.status, "cancelled");
		assert.equal(cancelled.done_at, null);
		assert.equal(cancelled.resolved_at, "2026-03-21T10:00:00+00:00");
		assert.equal(cancelled.resolution_reason, "No longer needed");
		assert.equal(cancelled.resolution_event_id, id(9400));
		const expired = (
			await db.query("select * from next_step where id = $1", [id(402)])
		).rows[0];
		assert.equal(expired.status, "expired");
		assert.equal(expired.resolved_at, null);
		assert.equal(expired.done_at, null);
		assert.equal(expired.resolution_event_id, id(9401));
		const party = (
			await db.query("select everything_about_party($1) as party", [CLIENT])
		).rows[0].party;
		assert.equal(
			party.next_steps.find((step: { id: string }) => step.id === id(402))
				.status,
			"expired",
		);
		assert.equal((await db.query("select * from home_next_step")).rowCount, 0);
		assert.equal(
			(
				await db.query("select * from home_mark where next_step_id = $1", [
					id(400),
				])
			).rowCount,
			2,
		);
		await db.query(
			`update next_step set resolution = 'done' where id = '${id(402)}'`,
		);
		assert.equal(
			(await db.query("select done_at from next_step where id = $1", [id(402)]))
				.rows[0].done_at,
			null,
		);
		await db.query(
			`set local role none;
			update next_step set resolution = null, resolution_event_id = null where id = '${id(402)}';
			set local role engine`,
		);
		assert.deepEqual((await db.query("select id from home_next_step")).rows, [
			{ id: id(402) },
		]);
	});
});

test("a held step stays off Home until its hold day in Central time and stays on its deal", async () => {
	await rolledBack(async () => {
		const definition: string = (
			await db.query("select pg_get_viewdef('home_next_step') as sql")
		).rows[0].sql;
		// Each instant is late on a Central day while UTC is already on the next one.
		for (const [instant, centralDay] of [
			["2001-01-16 05:30Z", "2001-01-15"],
			["2001-07-16 04:30Z", "2001-07-15"],
		] as const) {
			await db.query(`set local role none;
				update next_step set hold_until = date '${centralDay}' + 1 where id = '${id(400)}';
				update next_step set hold_until = '${centralDay}' where id = '${id(402)}';
				set local role engine`);
			const home = definition.replaceAll("now()", `'${instant}'::timestamptz`);
			assert.deepEqual(
				(await db.query<{ id: string }>(home)).rows.map((r) => r.id),
				[id(402)],
				instant,
			);
		}
		const held = (await readDeal()).next_steps.find(
			(s: { id: string }) => s.id === id(400),
		);
		assert.equal(held.hold_until, "2001-07-16");
	});
});

test("deal checklist titles require two to four words, a source and array bullets", async () => {
	for (const title of [
		"Example item",
		"Example three words",
		"Example four word item",
		"  Example   spaced item  ",
	]) {
		await rolledBack(async () => {
			await db.query("set local role none");
			await db.query(
				`update next_step set item_title=$1, source_ref='example:call', item_bullets='[]'
				where id='${id(400)}'`,
				[title],
			);
		});
	}
	const invalid: Case[] = [
		["item_title='Example'", "next_step_item_shape"],
		["item_title='Example title has five words'", "next_step_item_shape"],
		["item_title=' '", "next_step_item_shape"],
		["source_ref=null", "next_step_item_shape"],
		["source_ref='  '", "next_step_item_shape"],
		["item_bullets='{}'", "next_step_item_shape"],
		["item_bullets='null'", "next_step_item_shape"],
		["item_bullets=null", "23502"],
		[`deal_id=null, party_id='${CLIENT}'`, "next_step_item_shape"],
	];
	for (const [fields, refusal] of invalid) {
		await rolledBack(async () => {
			await db.query(`set local role none;
				update next_step set item_title='Example item', source_ref='example:call'
				where id='${id(400)}'`);
			await assert.rejects(
				db.query(`update next_step set ${fields} where id='${id(400)}'`),
				refusal === "23502" ? { code: refusal } : expected(refusal),
			);
		});
	}
});

test("a step's call source cannot be a meeting about its deal", async () => {
	const meeting = id(9402);
	await asOwner([
		[
			`insert into activity (id, kind, happened_at) values ('${meeting}', 'meeting', '2025-01-01');
			insert into activity_about (activity_id, deal_id) values ('${meeting}', '${DEAL}');
			update next_step set call_activity_id = '${meeting}', call_evidence_quote = 'Send the plan'
			where id = '${id(401)}'`,
			"next_step_call_activity_id_call_kind_fkey",
		],
	]);
});

test("a step's call source cannot be a call about another deal", async () => {
	await asOwner([
		[
			`insert into next_step (what, deal_id, call_activity_id, call_evidence_quote)
			values ('Send the plan', '${LENDER_DEAL}', '${CALL}', 'Send the plan')`,
			"next_step_call_activity_id_deal_id_fkey",
		],
	]);
});

test("a checklist reminder cannot repeat for the same recipient, deal, item and due date", async () => {
	await asOwner([
		[
			`insert into home_update (user_id, deal_id, what, checklist_item_ref, due_on) values
			('${USER}', '${DEAL}', 'Review the plan', 'example-plan', '2025-01-01'),
			('${USER}', '${DEAL}', 'Review the plan', 'example-plan', '2025-01-02'),
			('${USER}', '${DEAL}', 'Review the revised plan', 'example-plan', '2025-01-01')`,
			"home_update_user_id_deal_id_checklist_item_ref_due_on_key",
		],
	]);
});

test("a checklist reminder requires a due date and tour feedback forbids checklist refs", async () => {
	await asOwner([
		[
			`insert into home_update (user_id, deal_id, what, checklist_item_ref)
			values ('${USER}', '${DEAL}', 'Review the plan', 'example-plan')`,
			"home_update_checklist_due_date",
		],
		[
			`insert into home_update (user_id, deal_id, kind, what)
			values ('${USER}', '${DEAL}', 'other', 'Unknown update')`,
			"home_update_kind_check",
		],
		[
			`insert into home_update (user_id, deal_id, kind, what, checklist_item_ref, due_on)
			values ('${USER}', '${DEAL}', 'tour_feedback', 'Client commented', 'example-plan', '2025-01-01')`,
			"home_update_checklist_due_date",
		],
		[
			`insert into home_update (user_id, deal_id, what, property_id)
			values ('${USER}', '${DEAL}', 'Ordinary update', '${PROPERTY}')`,
			"home_update_property_kind",
		],
	]);
});

test("a dropped Home mark requires a nonblank reason, forbids waiting and is permanent", async () => {
	const update = id(980);
	const setup = `${asUser(USER)}; insert into home_update (id, user_id, deal_id, what) values ('${update}', '${USER}', '${DEAL}', 'Example update')`;
	const drop = (cols: string, vals: string) =>
		`${setup}; insert into home_mark (user_id, home_update_id, disposition${cols}) values ('${USER}', '${update}', 'dropped'${vals})`;
	for (const [sql, constraint] of [
		[drop("", ""), "home_mark_drop_reason"],
		[drop(", drop_reason", ", ' '"), "home_mark_drop_reason_check"],
		[drop(", drop_reason", ", chr(160)"), "home_mark_drop_reason_check"],
		[
			drop(
				", drop_reason, waiting_on_party_id, waiting_reason",
				`, 'Not needed', '${CLIENT}', 'Example'`,
			),
			"home_mark_drop_reason",
		],
		[
			`${drop(", drop_reason", ", 'Not needed'")}; update home_mark set disposition = 'snoozed', snoozed_until = '2099-01-01T00:00Z', drop_reason = null where home_update_id = '${update}'`,
			"home_mark_dropped_final",
		],
		[
			`${drop(", drop_reason", ", 'Not needed'")}; delete from home_mark where home_update_id = '${update}'`,
			"home_mark_dropped_final",
		],
	] as const) {
		await rolledBack(async () => {
			await assert.rejects(db.query(sql), expected(constraint));
		});
	}
});

test("next-step end states reject contradictory times, reasons and evidence", async () => {
	const invalid: Case[] = [
		["resolution = 'other'", "next_step_resolution_check"],
		["resolution = 'cancelled'", "next_step_cancellation_reason"],
		[
			"resolution = 'cancelled', resolution_reason = ' '",
			"next_step_resolution_reason_check",
		],
		[
			"resolution = 'expired', resolution_reason = 'Not needed'",
			"next_step_cancellation_reason",
		],
		["resolution_reason = 'Not needed'", "next_step_cancellation_reason"],
		[
			"resolution = 'done', resolution_reason = 'Not needed'",
			"next_step_cancellation_reason",
		],
		["done_at = now()", "next_step_done_time"],
		["resolution = 'expired', done_at = now()", "next_step_done_time"],
		[
			"resolution = 'cancelled', resolution_reason = 'Not needed', done_at = now()",
			"next_step_done_time",
		],
		["resolved_at = now()", "next_step_resolution_time"],
		["resolution = 'done', resolved_at = now()", "next_step_resolution_time"],
		[`resolution_event_id = '${id(9400)}'`, "next_step_resolution_event"],
	];
	for (const [fields, refusal] of invalid) {
		await rolledBack(async () => {
			await assert.rejects(
				db.query(`set local role none;
					update next_step set ${fields} where id = '${id(400)}'`),
				expected(refusal),
			);
		});
	}
});

test("only the owner's import supplies a next step's closing event", async () => {
	for (const statement of [
		`insert into next_step (what, deal_id, resolution, resolution_event_id)
		 values ('Example expired step', '${DEAL}', 'expired', '${id(9401)}')`,
		`update next_step set resolution = 'expired', resolution_event_id = '${id(9401)}'
		 where id = '${id(400)}'`,
	]) {
		await rolledBack(async () => {
			await assert.rejects(db.query(statement), { code: "42501" });
		});
	}
	await rolledBack(async () => {
		await db.query(`set local role none;
			insert into next_step (what, deal_id, resolution, resolution_event_id) values
			('First expired step', '${DEAL}', 'expired', '${id(9401)}'),
			('Second expired step', '${DEAL}', 'expired', '${id(9401)}');
			set local role engine`);
		assert.equal(
			(
				await db.query(
					"select id from next_step where resolution_event_id = $1",
					[id(9401)],
				)
			).rowCount,
			2,
		);
	});
	await rolledBack(async () => {
		await db.query("set local role none");
		await assert.rejects(
			db.query(`update next_step set resolution = 'expired', resolution_event_id = 'not-an-event-id'
				where id = '${id(400)}'`),
			{ code: "22P02" },
		);
	});
});

test("the Home view refuses an engine insert with a closing event", async () => {
	await rolledBack(async () => {
		await db.query(asJob("agent"));
		await assert.rejects(
			db.query(`insert into home_next_step (what, party_id, resolution, resolution_event_id)
				values ('Example expired step', '${CLIENT}', 'expired', '${id(9401)}')`),
			{ code: "42501" },
		);
	});
});

test("the engine can insert and read an open step through the Home view", async () => {
	await rolledBack(async () => {
		await db.query(asJob("agent"));
		const saved = await db.query(`insert into home_next_step (what, party_id)
			values ('Example open step', '${CLIENT}') returning id`);
		assert.deepEqual(
			(
				await db.query(
					"select what, party_id, status, resolution_event_id from home_next_step where id = $1",
					[saved.rows[0].id],
				)
			).rows,
			[
				{
					what: "Example open step",
					party_id: CLIENT,
					status: "open",
					resolution_event_id: null,
				},
			],
		);
	});
});

test("party proposals include only pending suggestions in creation order with id ties", async () => {
	await withParty(async () => {
		await db.query(`insert into activity_about (activity_id, party_id) values ('${CALL}', '${SUBJECT}');
			select set_config('engine.job', 'agent', true);
			insert into proposal (id, created_at, kind, activity_id, activity_kind, evidence, proposed_by_job, party_id, what) values
			('${id(9082)}', '2020-01-02', 'next_step', '${CALL}', 'call', 'Example evidence', 'agent', '${SUBJECT}', 'Later'),
			('${id(9081)}', '2020-01-01', 'next_step', '${CALL}', 'call', 'Example evidence', 'agent', '${SUBJECT}', 'Second'),
			('${id(9080)}', '2020-01-01', 'next_step', '${CALL}', 'call', 'Example evidence', 'agent', '${SUBJECT}', 'First');
			select set_config('engine.job', '', true);
			update proposal set status = 'dismissed' where id = '${id(9082)}'`);
		const proposals = (await readParty()).proposals;
		assert.deepEqual(
			proposals.map((s: { id: string }) => s.id),
			[id(9080), id(9081)],
		);
		assert.equal(proposals[0].evidence, "Example evidence");
		assert.equal(proposals[0].what, "First");
	});
});

test("party contact restrictions retain expired reasons and distinguish active restrictions", async () => {
	await withParty(async () => {
		await db.query(`insert into do_not_contact (party_id, reason, until_date) values
			('${SUBJECT}', 'Example restriction', current_date - 1),
			('${COMPANY}', 'Other restriction', null)`);
		let restriction = (await readParty()).do_not_contact;
		assert.ok(restriction);
		assert.equal(restriction.reason, "Example restriction");
		assert.equal(restriction.active, false);
		assert.equal(restriction.party_id, undefined);
		await db.query(
			`update do_not_contact set until_date = current_date where party_id = '${SUBJECT}'`,
		);
		assert.equal((await readParty()).do_not_contact.active, true);
		await db.query(
			`update do_not_contact set until_date = null where party_id = '${SUBJECT}'`,
		);
		restriction = (await readParty()).do_not_contact;
		assert.equal(restriction.active, true);
		assert.equal(restriction.until_date, null);
		await db.query(`insert into party (id, kind, name) values ('${id(9150)}', 'person', 'Example Survivor');
			select merge_party('${SUBJECT}', '${id(9150)}')`);
		assert.deepEqual((await readParty()).do_not_contact, restriction);
	});
});

test("party brand memberships show both ends, dated history and start-date id ordering", async () => {
	await withParty(async () => {
		await db.query(`insert into party_role (party_id, role) values ('${COMPANY}', 'client');
			insert into client (party_id) values ('${COMPANY}'), ('${CLIENT}');
			insert into client_brand (id, location_id, brand_id, started_on, ended_on) values
			('${id(9101)}', '${COMPANY}', '${BROKERAGES[0]}', '2021-01-01', null),
			('${id(9102)}', '${COMPANY}', '${BROKERAGES[1]}', '2020-01-01', '2021-01-01');
			insert into client_brand (id, location_id, brand_id, started_on) values
			('${id(9100)}', '${CLIENT}', '${BROKERAGES[0]}', '2021-01-01')`);
		const brands = (await readParty(COMPANY)).brands;
		assert.deepEqual(
			brands.map((b: { id: string }) => b.id),
			[id(9102), id(9101)],
		);
		assert.equal(brands[0].ended_on, "2021-01-01");
		assert.equal(brands[1].party.id, BROKERAGES[0]);
		assert.equal(brands[1].brand_kind, undefined);
		const locations = (await readParty(BROKERAGES[0])).brands;
		assert.deepEqual(
			locations.map((b: { id: string }) => b.id),
			[id(9100), id(9101)],
		);
		assert.equal(locations[1].party.id, COMPANY);
		assert.deepEqual((await readParty()).brands, []);
	});
});

test("national account ownership reads both ends and preserves former owners in total order", async () => {
	await withParty(async () => {
		await db.query(`insert into role (slug, label) values ('national_account', 'National account');
			insert into party_role (party_id, role) values
			('${COMPANY}', 'national_account'), ('${BROKERAGES[0]}', 'national_account');
			insert into national_account (party_id) values ('${COMPANY}'), ('${BROKERAGES[0]}');
			insert into national_account_owner (id, account_id, owner_id, started_on, ended_on) values
			('${id(9111)}', '${COMPANY}', '${USER}', '2021-01-01', null),
			('${id(9112)}', '${COMPANY}', '${TEAMMATE}', '2020-01-01', '2021-01-01'),
			('${id(9110)}', '${BROKERAGES[0]}', '${USER}', '2021-01-01', null)`);
		const owners = (await readParty(COMPANY)).national_account_owners;
		assert.deepEqual(
			owners.map((o: { id: string }) => o.id),
			[id(9112), id(9111)],
		);
		assert.equal(owners[0].ended_on, "2021-01-01");
		assert.equal(owners[1].party.id, USER);
		assert.equal(owners[1].owner_is_partner, undefined);
		const accounts = (await readParty(USER)).national_account_owners;
		assert.deepEqual(
			accounts.map((o: { id: string }) => o.id),
			[id(9110), id(9111)],
		);
		assert.equal(accounts[1].party.id, COMPANY);
		assert.deepEqual((await readParty(CLIENT)).national_account_owners, []);
	});
});

test("party leases include signed versions, documents, suites and options with history and total ordering", async () => {
	await withParty(async () => {
		await db.query(`insert into lease (id, party_id, property_id) values
			('${id(9121)}', '${SUBJECT}', '${PROPERTY}'), ('${id(9120)}', '${SUBJECT}', '${PROPERTY}'),
			('${id(9122)}', '${COMPANY}', '${PROPERTY}');
			update property set name = 'Example Plaza', building_class = 'Example class',
			building_type = 'Example type', year_built = 2005, stories = 4 where id = '${PROPERTY}';
			insert into lease_version (id, lease_id, version, document_id, expiration_on, other_terms) values
			('${id(9131)}', '${id(9121)}', 1, '${PDF_FILE}', '2030-01-01', 'Original terms'),
			('${id(9130)}', '${id(9121)}', 2, '${PDF_FILE}', '2031-01-01', 'Amended terms');
			insert into suite (id, property_id, label) values
			('${id(9142)}', '${PROPERTY}', null), ('${id(9141)}', '${PROPERTY}', null),
			('${id(9143)}', '${PROPERTY}', 'Example suite');
			insert into lease_suite (lease_version_id, lease_id, property_id, suite_id)
			select '${id(9131)}', '${id(9121)}', '${PROPERTY}', id from suite
			where id in ('${id(9141)}', '${id(9142)}', '${id(9143)}');
			insert into lease_option (lease_version_id, number, kind, notice_on, terms) values
			('${id(9131)}', 2, 'expansion', '2029-01-01', 'Example expansion'),
			('${id(9131)}', 1, 'renewal', '2029-01-01', 'Example renewal')`);
		const leases = (await readParty()).leases;
		assert.deepEqual(
			leases.map((l: { id: string }) => l.id),
			[id(9120), id(9121)],
		);
		assert.partialDeepStrictEqual(leases[1].property, {
			id: PROPERTY,
			name: "Example Plaza",
			building_class: "Example class",
			building_type: "Example type",
			year_built: 2005,
			stories: 4,
		});
		assert.equal(leases[1].client_role, undefined);
		assert.deepEqual(leases[0].versions, []);
		const versions = leases[1].versions;
		assert.deepEqual(
			versions.map((v: { id: string }) => v.id),
			[id(9131), id(9130)],
		);
		assert.equal(versions[0].other_terms, "Original terms");
		assert.equal(versions[1].other_terms, "Amended terms");
		assert.equal(versions[0].document.id, PDF_FILE);
		assert.deepEqual(
			versions[0].suites.map((s: { id: string }) => s.id),
			[id(9143), id(9141), id(9142)],
		);
		assert.deepEqual(
			versions[0].options.map((o: { number: number }) => o.number),
			[1, 2],
		);
		assert.equal(versions[0].options[0].terms, "Example renewal");
		assert.deepEqual(versions[1].suites, []);
		assert.deepEqual(versions[1].options, []);
		assert.deepEqual(
			(await readParty(COMPANY)).leases.map((l: { id: string }) => l.id),
			[id(9122)],
		);
		await db.query(`update property set address = '200 Example Way' where id = '${PROPERTY}';
			insert into property (id, address) values ('${id(9160)}', '100 Example Way');
			insert into lease (id, party_id, property_id) values ('${id(9123)}', '${SUBJECT}', '${id(9160)}')`);
		const allLeases = (await readParty()).leases;
		assert.deepEqual(
			allLeases.map((l: { id: string }) => l.id),
			[id(9123), id(9120), id(9121)],
		);
		await db.query(`select merge_party('${SUBJECT}', '${AGENT}')`);
		assert.deepEqual((await readParty()).leases, allLeases);
	});
});

test("party specialties sort by slug and exclude another person's", async () => {
	await withParty(async () => {
		await db.query(`insert into party_specialty (person_id, specialty) values
			('${SUBJECT}', 'orthodontics'), ('${SUBJECT}', 'general_dentistry')`);
		const specialties = (await readParty()).specialties;
		assert.deepEqual(specialties, [
			{ specialty: "general_dentistry" },
			{ specialty: "orthodontics" },
		]);
		assert.deepEqual((await readParty(DOCTOR)).specialties, [
			{ specialty: "general_dentistry" },
		]);
	});
});

test("party territories keep dated history and each territory's ordered pieces", async () => {
	await withParty(async () => {
		await db.query(`insert into territory (id, name) values ('${id(9180)}', 'Example reach');
			insert into market (id, name) values ('${id(9185)}', 'Example Alpha');
			insert into territory_piece (id, territory_id, state_fips, market_id, base_latitude, base_longitude, miles) values
			('${id(9181)}', '${id(9180)}', null, null, 10, -150, 5),
			('${id(9182)}', '${id(9180)}', null, '${BAY}', null, null, null),
			('${id(9183)}', '${id(9180)}', '91', null, null, null, null),
			('${id(9184)}', '${id(9180)}', null, null, 10, -150, 2),
			('${id(9186)}', '${id(9180)}', null, '${id(9185)}', null, null, null);
			insert into party_territory (id, party_id, territory_id, started_on, ended_on) values
			('${id(9170)}', '${SUBJECT}', '${id(9180)}', null, null),
			('${id(9171)}', '${SUBJECT}', '${HOME}', '2024-01-01', null),
			('${id(9172)}', '${SUBJECT}', '${STATEWIDE}', '2023-01-01', '2023-12-31')`);
		const territories = (await readParty()).territories;
		assert.deepEqual(
			territories.map((t: { id: string }) => t.id),
			[id(9172), id(9171), id(9170)],
		);
		assert.equal(territories[0].ended_on, "2023-12-31");
		assert.equal(territories[0].territory.name, "Example State");
		assert.equal(territories[0].party_id, undefined);
		const pieces = territories[2].territory.pieces;
		assert.deepEqual(
			pieces.map((piece: { id: string }) => piece.id),
			[id(9183), id(9186), id(9182), id(9184), id(9181)],
		);
		assert.equal(pieces[1].market.name, "Example Alpha");
		assert.equal(pieces[3].market, null);
		assert.equal(pieces[3].territory_id, undefined);
	});
});

test("vendor verticals and loan programs sort by name and exclude another vendor's", async () => {
	await withParty(async () => {
		await db.query(`insert into party_role (party_id, role) values ('${COMPANY}', 'vendor');
			insert into vendor_vertical (party_id, vertical) values
			('${COMPANY}', 'Lending'), ('${COMPANY}', 'Appraisal'), ('${VENDOR}', 'Title');
			insert into vendor_loan_program (party_id, loan_program) values
			('${COMPANY}', 'Example term loan'), ('${COMPANY}', 'Example equipment loan'), ('${VENDOR}', 'Example other loan')`);
		const vendor = await readParty(COMPANY);
		assert.deepEqual(vendor.vendor_verticals, [
			{ vertical: "Appraisal" },
			{ vertical: "Lending" },
		]);
		assert.deepEqual(vendor.vendor_loan_programs, [
			{ loan_program: "Example equipment loan" },
			{ loan_program: "Example term loan" },
		]);
	});
});

test("party introductions read from either end with the other party, undated last", async () => {
	await withParty(async () => {
		await db.query(`insert into party_role (party_id, role) values ('${COMPANY}', 'vendor');
			insert into introduction (id, vendor_id, made_by, introduced_by_user_id, introduced_party_id, introduced_on) values
			('${id(9191)}', '${COMPANY}', 'vendor', null, '${SUBJECT}', '2025-01-01'),
			('${id(9190)}', '${VENDOR}', 'team', '${USER}', '${SUBJECT}', null),
			('${id(9192)}', '${COMPANY}', 'vendor', null, '${CLIENT}', '2024-01-01')`);
		const introductions = (await readParty()).introductions;
		assert.deepEqual(
			introductions.map((i: { id: string }) => i.id),
			[id(9191), id(9190)],
		);
		assert.equal(introductions[0].party.id, COMPANY);
		assert.equal(introductions[1].party.id, VENDOR);
		assert.equal(introductions[1].introduced_by_user_id, USER);
		assert.equal(introductions[1].vendor_role, undefined);
		const made = (await readParty(COMPANY)).introductions;
		assert.deepEqual(
			made.map((i: { id: string; party: { id: string } }) => [
				i.id,
				i.party.id,
			]),
			[
				[id(9192), CLIENT],
				[id(9191), SUBJECT],
			],
		);
		await db.query(`select merge_party('${SUBJECT}', '${AGENT}')`);
		assert.deepEqual(
			(await readParty()).introductions,
			introductions.map((i: object) => ({ ...i, introduced_party_id: AGENT })),
		);
	});
});

test("a lead's outreach draft comes back without its fixed send flags", async () => {
	await withParty(async () => {
		await db.query(`insert into party_role (party_id, role, stage) values ('${SUBJECT}', 'lead', 'qualified');
			insert into lead_contact_draft (party_id, owner_user_id, subject, body, scheduled_for, time_zone) values
			('${SUBJECT}', '${USER}', 'Example subject', 'Example body', '2030-01-01T15:00:00Z', 'America/Chicago')`);
		const { id: draftId, ...draft } = (await readParty()).outreach_draft;
		assert.ok(draftId);
		assert.deepEqual(draft, {
			owner_user_id: USER,
			subject: "Example subject",
			body: "Example body",
			scheduled_for: "2030-01-01T15:00:00+00:00",
			time_zone: "America/Chicago",
			revision: 1,
			approved: false,
		});
		assert.equal((await readParty(COMPANY)).outreach_draft, null);
	});
});

test("a merged-away party reads its survivor including moved links after another merge", async () => {
	await withParty(async () => {
		await db.query(`insert into party (id, kind, name) values ('${id(9090)}', 'person', 'Example Duplicate');
			insert into party_email (party_id, address, label) values ('${id(9090)}', 'duplicate@example.com', 'work');
			select merge_party('${id(9090)}', '${SUBJECT}');
			select merge_party('${SUBJECT}', '${AGENT}')`);
		assert.deepEqual(await readParty(id(9090)), await readParty(AGENT));
		assert.deepEqual(await readParty(), await readParty(AGENT));
		assert.equal((await readParty()).party.id, AGENT);
		assert.ok(
			(await readParty()).emails.some(
				(e: { address: string }) => e.address === "duplicate@example.com",
			),
		);
	});
});

test("everything about the LOI deal comes back in one read, each list in order", async () => {
	const { history, ...deal } = await readDeal();
	assert.deepEqual(
		history.map((c: { table_name: string; action: string; record: object }) => [
			c.table_name,
			c.action,
			c.record,
		]),
		[
			["deal", "insert", { id: DEAL }],
			[
				"deal_party",
				"insert",
				{ deal_id: DEAL, party_id: CLIENT, role: "client" },
			],
			[
				"deal_party",
				"insert",
				{ deal_id: DEAL, party_id: AGENT, role: "listing_agent" },
			],
			["deal", "update", { id: DEAL }],
		],
	);
	assert.deepEqual(deal, {
		deal: {
			id: DEAL,
			name: "Example Dental Springfield Deal",
			kind: "lease",
			reason: "relocation",
			owner_user_id: USER,
			renews_lease_id: null,
			market_id: BAY,
			closed_value: null,
			parking_reason: null,
			parking_note: null,
			needs_attention: false,
			parked_at: null,
			parked_by_user_id: null,
			parked_automatically: false,
		},
		phases,
		properties: [
			{
				id: PROPERTY,
				address: "100 Example Way, Springfield",
				county_fips: null,
				latitude: null,
				longitude: null,
				name: null,
				building_class: null,
				building_type: null,
				year_built: null,
				stories: null,
			},
		],
		parties: [
			{
				id: CLIENT,
				kind: "company",
				name: "Example Dental Group",
				city: null,
				npi: NPIS[0],
				how_found: "referral",
				how_found_detail: null,
				role: "client",
			},
			{
				id: AGENT,
				kind: "person",
				name: "Avery Example",
				city: null,
				npi: null,
				how_found: null,
				how_found_detail: null,
				role: "listing_agent",
			},
		],
		offers: rounds,
		activity: [
			{
				id: EMAIL,
				kind: "email",
				reached: null,
				happened_at: "2026-03-09T14:00:00+00:00",
				from_party_id: AGENT,
				summary: null,
				email: {
					message_id: "<counter-2@example.com>",
					sender: "avery@example.com",
					sender_name: null,
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
				reached: null,
				email: null,
			},
		],
		next_steps: [
			{
				id: id(401),
				what: "Send the signed LOI",
				owner_party_id: CLIENT,
				due_on: "2026-03-13",
				hold_until: null,
				item_title: null,
				item_bullets: [],
				source_ref: null,
				done_at: "2026-03-13T18:00:00+00:00",
				resolution: "done",
				resolved_at: null,
				resolution_reason: null,
				resolution_event_id: null,
				status: "done",
			},
			{
				id: id(400),
				what: "Start the lease draft",
				owner_party_id: USER,
				due_on: "2026-03-20",
				hold_until: null,
				item_title: null,
				item_bullets: [],
				source_ref: null,
				done_at: null,
				resolution: null,
				resolved_at: null,
				resolution_reason: null,
				resolution_event_id: null,
				status: "open",
			},
		],
		critical_dates: [],
		critical_date_proposals: [],
		earlier_parties: [],
		earlier_owners: [],
		imported_deal_history: [],
		imported_history: [],
	});
});

test("a deal read lists its open and proposed critical dates separately, by due date then id", () =>
	rolledBack(async () => {
		const dated = (n: number, due_on: string, deal_id = DEAL) =>
			newCriticalDate({ id: id(n), due_on, deal_id });
		const resolve = (n: number, status: string) =>
			`update critical_date set status = '${status}', resolution_reason = 'Example reason' where id = '${id(n)}'`;
		await db.query(`${dated(712, "2026-06-01")}; ${dated(711, "2026-06-01")}; ${dated(713, "2026-05-01")};
			${dated(715, "2026-04-01")}; ${dated(716, "2026-04-01")};
			${dated(717, "2026-04-01")}; ${dated(718, "2026-04-01")};
			${dated(719, "2026-04-01", LENDER_DEAL)};
			update critical_date set status = 'open' where id <> '${id(717)}';
			${resolve(715, "done")}; ${resolve(716, "passed")}; ${resolve(717, "dropped")}; ${resolve(718, "dropped")};
			${dated(722, "2026-06-01")}; ${dated(721, "2026-06-01")}; ${dated(723, "2026-05-01")};
			${dated(729, "2026-04-01", LENDER_DEAL)}`);
		const dealOn = async (deal: string) =>
			unstamped(
				(await db.query("select everything_about_deal($1) as deal", [deal]))
					.rows[0].deal,
			);
		const { critical_dates: dates, critical_date_proposals: proposals } =
			await dealOn(DEAL);
		const other = await dealOn(LENDER_DEAL);
		assert.deepEqual(
			dates.map((date: { id: string }) => date.id),
			[id(713), id(711), id(712)],
		);
		const { confirmed_at, ...first } = dates[0];
		assert.ok(confirmed_at);
		assert.deepEqual(first, {
			id: id(713),
			kind: "due_diligence",
			due_on: "2026-05-01",
			source: "Example signed agreement",
			offer_id: null,
			lease_version_id: null,
			option_number: null,
			document_id: null,
			note: null,
			status: "open",
			confirmed_by_user_id: USER,
			resolved_by_user_id: null,
			resolved_at: null,
			resolution_reason: null,
		});
		assert.deepEqual(
			other.critical_dates.map((date: { id: string }) => date.id),
			[id(719)],
		);
		assert.deepEqual(
			proposals.map((date: { id: string }) => date.id),
			[id(723), id(721), id(722)],
		);
		assert.deepEqual(proposals[0], {
			id: id(723),
			kind: "due_diligence",
			due_on: "2026-05-01",
			source: "Example signed agreement",
			offer_id: null,
			lease_version_id: null,
			option_number: null,
			document_id: null,
			note: null,
			status: "proposed",
			confirmed_by_user_id: null,
			confirmed_at: null,
			resolved_by_user_id: null,
			resolved_at: null,
			resolution_reason: null,
		});
		assert.deepEqual(
			other.critical_date_proposals.map((date: { id: string }) => date.id),
			[id(729)],
		);
		await db.query(
			`update critical_date set status = 'open' where id = '${id(729)}'`,
		);
		assert.deepEqual((await dealOn(LENDER_DEAL)).critical_date_proposals, []);
	}));

test("a deal read lists who was on it and who owned it before, in the order they left", () =>
	rolledBack(async () => {
		await db.query(`set local role none;
			${earlierParty()};
			${earlierParty({ id: id(9601), party_id: CLIENT, role: "client", started_at: null, ended_at: "2024-03-01" })};
			${earlierParty({ id: id(9602), deal_id: LENDER_DEAL })};
			${earlierOwner()};
			${earlierOwner({ id: id(9611), user_id: USER, started_at: null, ended_at: "2025-01-01" })};
			${earlierOwner({ id: id(9612), deal_id: LENDER_DEAL })};
			set local role engine`);
		const deal = await readDeal();
		const party = (wanted: string) => {
			const { role: _, ...found } = deal.parties.find(
				(p: { id: string }) => p.id === wanted,
			);
			return found;
		};
		assert.deepEqual(deal.earlier_parties, [
			{
				id: id(9601),
				party_id: CLIENT,
				role: "client",
				started_at: null,
				ended_at: "2024-03-01T00:00:00+00:00",
				party: party(CLIENT),
			},
			{
				id: id(9600),
				party_id: AGENT,
				role: "listing_agent",
				started_at: "2025-01-01T00:00:00+00:00",
				ended_at: "2025-06-01T00:00:00+00:00",
				party: party(AGENT),
			},
		]);
		assert.deepEqual(deal.earlier_owners, [
			{
				id: id(9611),
				user_id: USER,
				started_at: null,
				ended_at: "2025-01-01T00:00:00+00:00",
			},
			{
				id: id(9610),
				user_id: TEAMMATE,
				started_at: "2025-01-01T00:00:00+00:00",
				ended_at: "2025-06-01T00:00:00+00:00",
			},
		]);
	}));

test("a deal's history keeps complete native and imported rows in time and id order, excluding other deals and children", () =>
	rolledBack(async () => {
		await db.query(`set constraints all immediate;
			set local role none;
			delete from change where (table_name, record) = ('deal', '{"id":"${DEAL}"}')
				or table_name = 'deal_party' and record ->> 'deal_id' = '${DEAL}';
			alter table change disable trigger stamp_change;
			alter table imported_change disable trigger stamp_imported_change`);
		const recorded = async (
			n: number,
			day: number,
			table: string,
			record: object,
		) =>
			(
				await db.query(
					`insert into change (id, table_name, record, action, old_value, changed_by_job, changed_at)
					overriding system value values ($1, $2, $3, 'delete', '{"example":true}', 'old_system', $4)
					returning to_jsonb(change) as entry`,
					[n, table, record, `2026-01-0${day}T00:00:00Z`],
				)
			).rows[0].entry;
		const imported = async (n: number, day: number, deal = DEAL) =>
			(
				await db.query(
					`insert into imported_change
					(id, table_name, record, old_value_absent, new_value_absent, field, source_event, changed_by_job, changed_at)
					values ($1, 'deal', $2, false, false, 'owner', $3, 'old_system', $4)
					returning to_jsonb(imported_change) as entry`,
					[
						id(n),
						{ id: deal },
						{
							id: id(n),
							verb: "set-lead",
							cause: "human",
							actor_id: "example-actor",
						},
						`2020-01-0${day}T00:00:00Z`,
					],
				)
			).rows[0].entry;
		const agent = { party_id: AGENT, role: "listing_agent" };
		const history = [
			await recorded(9702, 2, "deal", { id: DEAL }),
			await recorded(9701, 1, "deal_party", { deal_id: DEAL, ...agent }),
			await recorded(9700, 2, "deal", { id: DEAL }),
		];
		const importedHistory = [
			await imported(9712, 2),
			await imported(9711, 1),
			await imported(9710, 2),
		];
		await recorded(9703, 1, "deal_party", { deal_id: LENDER_DEAL, ...agent });
		await recorded(9704, 1, "deal_property", {
			deal_id: DEAL,
			property_id: PROPERTY,
		});
		await recorded(9705, 1, "deal", { id: LENDER_DEAL });
		await imported(9713, 1, LENDER_DEAL);
		await db.query(`alter table change enable trigger stamp_change;
			alter table imported_change enable trigger stamp_imported_change;
			set local role engine`);
		const result = (
			await db.query("select everything_about_deal($1) as value", [DEAL])
		).rows[0].value;
		assert.deepEqual(result.history, [history[1], history[2], history[0]]);
		assert.deepEqual(result.imported_history, [
			importedHistory[1],
			importedHistory[2],
			importedHistory[0],
		]);
	}));

test("a native owner handoff and a native removal show in the deal's history", () =>
	rolledBack(async () => {
		await db.query(`update deal set owner_user_id = '${TEAMMATE}' where id = '${DEAL}';
			insert into deal_party values ('${DEAL}', '${LENDERS[0]}', 'lender');
			delete from deal_party where (deal_id, party_id) = ('${DEAL}', '${LENDERS[0]}')`);
		const lender = { deal_id: DEAL, party_id: LENDERS[0], role: "lender" };
		assert.deepEqual(
			(await readDeal()).history
				.slice(-3)
				.map(
					({ id: _, merge_of: __, ...change }: Record<string, unknown>) =>
						change,
				),
			[
				{
					table_name: "deal",
					record: { id: DEAL },
					action: "update",
					old_value: { owner_user_id: USER },
					new_value: { owner_user_id: TEAMMATE },
				},
				{
					table_name: "deal_party",
					record: lender,
					action: "insert",
					old_value: null,
					new_value: { ...lender, client_role: null },
				},
				{
					table_name: "deal_party",
					record: lender,
					action: "delete",
					old_value: { ...lender, client_role: null },
					new_value: null,
				},
			],
		);
	}));

test("a deal's people history lookup uses its own index", () =>
	rolledBack(async () => {
		await db.query("set local enable_seqscan = off");
		const { rows } = await db.query(
			`explain select * from change
			where table_name = 'deal_party' and (record ->> 'deal_id')::uuid = $1`,
			[DEAL],
		);
		assert.match(
			rows.map((row) => row["QUERY PLAN"]).join("\n"),
			/change_deal_party/,
		);
	}));

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
				"deal_open_name",
				"deal_plan_date",
				"doc_judgment_destination",
				"doc_judgment_job",
				"email_summary",
				"invoice_mailbox",
				"imported_automatic_phase_move",
				"imported_change",
				"imported_deal_board",
				"imported_deal_history",
				"imported_deal_party",
				"imported_deal_owner",
				"imported_deal_invoiced",
				"app_user",
				"job",
				"lead_source_sender",
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

test("the deal reader can form the website link but cannot read its password verifier", () =>
	rolledBack(async () => {
		await db.query(`insert into deal_client_website (slug, deal_id, client_party_id, password_hash)
			values ('example-site', '${DEAL}', '${CLIENT}', '$2a$12$${"A".repeat(53)}');
			set local role engine_reader;`);
		assert.deepEqual(
			(
				await db.query(
					"select slug, deal_id, client_party_id, disabled_at from deal_client_website",
				)
			).rows,
			[
				{
					slug: "example-site",
					deal_id: DEAL,
					client_party_id: CLIENT,
					disabled_at: null,
				},
			],
		);
		await assert.rejects(
			db.query("select password_hash from deal_client_website"),
			{ code: "42501" },
		);
	}));

test("the fresh schema has no deal star table", async () => {
	const { rows } = await db.query(
		"select to_regclass('next.deal_star') as table_name",
	);
	assert.deepEqual(rows, [{ table_name: null }]);
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
					renews_lease_id: null,
					parking_reason: null,
					parking_note: null,
					needs_attention: false,
					parked_at: null,
					parked_by_user_id: null,
					parked_automatically: false,
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

test("earlier people and owners hand over back to back, in other roles meanwhile, and follow a merge", async () => {
	const owner = await connect("none");
	try {
		await owner.query("begin");
		await owner.query(`insert into party (id, kind, name) values ('${DUPLICATE}', 'person', 'A. Example');
			${earlierParty({ started_at: null, ended_at: "2025-01-01" })};
			${earlierParty({ id: id(9601), party_id: DUPLICATE })};
			${earlierParty({ id: id(9602), role: "title", started_at: "2025-02-01" })};
			${earlierOwner({ started_at: null })};
			${earlierOwner({ id: id(9611), user_id: USER, started_at: "2025-06-01", ended_at: "2025-09-01" })};
			select merge_party('${DUPLICATE}', '${AGENT}')`);
		const { rows } = await owner.query(
			"select id, party_id, role from imported_deal_party order by id",
		);
		assert.deepEqual(rows, [
			{ id: id(9600), party_id: AGENT, role: "listing_agent" },
			{ id: id(9601), party_id: AGENT, role: "listing_agent" },
			{ id: id(9602), party_id: AGENT, role: "title" },
		]);
	} finally {
		await owner.query("rollback");
		await owner.end();
	}
});

test("a rejoin saved while an earlier period is copied waits for the copy, then is refused", async () => {
	const [copy, rejoin] = [await connect("none"), await connect()];
	try {
		const { pid } = (await rejoin.query("select pg_backend_pid() as pid"))
			.rows[0];
		await copy.query(`begin; ${earlierParty({ party_id: DOCTOR })}`);
		await rejoin.query("begin");
		let settled = false;
		const waiting = rejoin
			.query(
				`insert into deal_party (deal_id, party_id, role, created_at) values ('${DEAL}', '${DOCTOR}', 'listing_agent', '2025-03-01')`,
			)
			.finally(() => {
				settled = true;
			});
		const refused = assert.rejects(waiting, {
			constraint: "deal_party_rejoins_after_leaving",
		});
		const blocked = async () =>
			(await db.query("select pg_blocking_pids($1) <> '{}' as blocked", [pid]))
				.rows[0].blocked;
		while (!settled && !(await blocked()));
		await copy.query("commit");
		await refused;
	} finally {
		await rejoin.query("rollback");
		await copy.query(
			`delete from imported_deal_party where id = '${id(9600)}'`,
		);
		await Promise.all([copy.end(), rejoin.end()]);
	}
});

test("a parked deal stays in its phase and is revived to it, keeps who last parked it and when, and history keeps each", () =>
	rolledBack(async () => {
		const parkedBy = async () =>
			(
				await db.query(
					`select parked_by_user_id, parked_at = now() as now from deal where id = '${DEAL}'`,
				)
			).rows[0];
		await db.query(`${asUser(TEAMMATE)};
			update deal set parking_reason = 'client_paused', parking_note = 'Example pause' where id = '${DEAL}'`);
		assert.deepEqual(await parkedBy(), {
			parked_by_user_id: TEAMMATE,
			now: true,
		});
		await db.query(`${asJob("agent", USER)};
			update deal set needs_attention = true where id = '${DEAL}';
			update deal set parking_note = 'Example longer pause' where id = '${DEAL}'`);
		assert.deepEqual(await parkedBy(), { parked_by_user_id: USER, now: true });
		await db.query(`${asUser(USER)};
			update deal set parking_reason = null, parking_note = null where id = '${DEAL}'`);
		assert.deepEqual(await parkedBy(), { parked_by_user_id: null, now: null });
		assert.deepEqual((await readDeal()).phases, phases);
		const now = (await db.query("select to_jsonb(now()) as now")).rows[0].now;
		const parked = {
			parking_reason: "client_paused",
			parking_note: "Example pause",
			parked_at: now,
			parked_by_user_id: TEAMMATE,
		};
		const active = {
			parking_reason: null,
			parking_note: null,
			parked_at: null,
			parked_by_user_id: null,
		};
		const by = (user: string, job: string | null = null) => ({
			table_name: "deal",
			record: { id: DEAL },
			action: "update",
			changed_by_user_id: job ? null : user,
			changed_by_job: job,
			changed_for_user_id: job ? user : null,
			merge_of: null,
		});
		assert.deepEqual(await history(), [
			{ ...by(TEAMMATE), old_value: active, new_value: parked },
			{
				...by(USER, "agent"),
				old_value: { needs_attention: false },
				new_value: { needs_attention: true },
			},
			{
				...by(USER, "agent"),
				old_value: {
					parking_note: "Example pause",
					parked_by_user_id: TEAMMATE,
				},
				new_value: {
					parking_note: "Example longer pause",
					parked_by_user_id: USER,
				},
			},
			{
				...by(USER),
				old_value: {
					...parked,
					parking_note: "Example longer pause",
					parked_by_user_id: USER,
				},
				new_value: active,
			},
		]);
	}));

test("a parked deal is stamped again when its reason or note changes, and not when its name or flag does", () =>
	rolledBack(async () => {
		const parkedEarlier = `set local role none;
			update deal set parked_at = '2025-01-01T00:00:00Z' where id = '${DEAL}';
			set local role engine`;
		const parkedAt = async () =>
			(
				await db.query(
					`select parked_at = now() as now, parked_at = '2025-01-01T00:00:00Z' as earlier from deal where id = '${DEAL}'`,
				)
			).rows[0];
		await db.query(`${asUser(USER)};
			update deal set parking_reason = 'client_paused', parking_note = 'Example pause' where id = '${DEAL}';
			${parkedEarlier};
			update deal set name = 'Example renamed' where id = '${DEAL}';
			update deal set needs_attention = true where id = '${DEAL}'`);
		assert.deepEqual(await parkedAt(), { now: false, earlier: true });
		for (const change of [
			"parking_note = 'Example longer pause'",
			"parking_reason = 'other'",
		]) {
			await db.query(`${parkedEarlier};
				update deal set ${change} where id = '${DEAL}'`);
			assert.deepEqual(await parkedAt(), { now: true, earlier: false }, change);
		}
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

test("a link either way round is two links only for can introduce, and a merge keeps one link and drops one between the two", () =>
	rolledBack(async () => {
		await db.query(`${newLink({ kind: "can_introduce", started_on: null })};
			insert into party (id, kind, name) values ('${DUPLICATE}', 'person', 'A. Example');
			insert into party_link (kind, party_id, other_party_id, started_on) values
				('knows', '${DOCTOR}', '${DUPLICATE}', '2024-05-01'), ('knows', '${DUPLICATE}', '${AGENT}', null),
				('can_introduce', '${DUPLICATE}', '${CLIENT}', null);
			select merge_party('${DUPLICATE}', '${AGENT}')`);
		const { rows } = await db.query(
			"select kind, party_id, other_party_id, started_on::text from party_link order by kind, party_id, other_party_id",
		);
		assert.deepEqual(rows, [
			{
				kind: "can_introduce",
				party_id: AGENT,
				other_party_id: CLIENT,
				started_on: null,
			},
			{
				kind: "can_introduce",
				party_id: DOCTOR,
				other_party_id: AGENT,
				started_on: null,
			},
			{
				kind: "can_introduce",
				party_id: VENDOR,
				other_party_id: DOCTOR,
				started_on: null,
			},
			{
				kind: "knows",
				party_id: AGENT,
				other_party_id: DOCTOR,
				started_on: "2024-05-01",
			},
		]);
	}));

test("a merge collapses two current links, keeping the survivor's row, and keeps can introduce's direction", () =>
	rolledBack(async () => {
		await db.query(`insert into party (id, kind, name) values ('${DUPLICATE}', 'person', 'A. Example');
			insert into party_link (id, kind, party_id, other_party_id, started_on, ended_on, note) values
				('${id(800)}', 'can_introduce', '${AGENT}', '${CLIENT}', null, null, 'Example: survivor'),
				('${id(801)}', 'can_introduce', '${DUPLICATE}', '${CLIENT}', null, null, 'Example: duplicate'),
				('${id(802)}', 'can_introduce', '${AGENT}', '${LENDERS[0]}', null, null, null),
				('${id(803)}', 'can_introduce', '${LENDERS[0]}', '${DUPLICATE}', null, null, null),
				('${id(804)}', 'knows', '${AGENT}', '${BROKERAGES[0]}', null, null, 'Example: survivor'),
				('${id(805)}', 'knows', '${BROKERAGES[0]}', '${DUPLICATE}', null, null, 'Example: duplicate'),
				('${id(806)}', 'knows', '${AGENT}', '${BROKERAGES[1]}', '2020-01-06', '2020-12-31', null),
				('${id(807)}', 'knows', '${DUPLICATE}', '${BROKERAGES[1]}', '2021-01-04', null, null),
				('${id(808)}', 'knows', '${AGENT}', '${LENDERS[1]}', '2022-03-01', null, 'Example: survivor'),
				('${id(809)}', 'knows', '${LENDERS[1]}', '${DUPLICATE}', '2023-05-02', null, 'Example: duplicate');
			select merge_party('${DUPLICATE}', '${AGENT}')`);
		const { rows } = await db.query(
			`select id, kind, party_id, other_party_id, started_on::text, note from party_link
			where id between '${id(800)}' and '${id(809)}' order by id`,
		);
		assert.deepEqual(rows, [
			{
				id: id(800),
				kind: "can_introduce",
				party_id: AGENT,
				other_party_id: CLIENT,
				started_on: null,
				note: "Example: survivor",
			},
			{
				id: id(802),
				kind: "can_introduce",
				party_id: AGENT,
				other_party_id: LENDERS[0],
				started_on: null,
				note: null,
			},
			{
				id: id(803),
				kind: "can_introduce",
				party_id: LENDERS[0],
				other_party_id: AGENT,
				started_on: null,
				note: null,
			},
			{
				id: id(804),
				kind: "knows",
				party_id: AGENT,
				other_party_id: BROKERAGES[0],
				started_on: null,
				note: "Example: survivor",
			},
			{
				id: id(806),
				kind: "knows",
				party_id: AGENT,
				other_party_id: BROKERAGES[1],
				started_on: "2020-01-06",
				note: null,
			},
			{
				id: id(807),
				kind: "knows",
				party_id: AGENT,
				other_party_id: BROKERAGES[1],
				started_on: "2021-01-04",
				note: null,
			},
			{
				id: id(808),
				kind: "knows",
				party_id: AGENT,
				other_party_id: LENDERS[1],
				started_on: "2022-03-01",
				note: "Example: survivor",
			},
		]);
	}));

test("a merge keeps an ended link beside a current one from the same start date", () =>
	rolledBack(async () => {
		const [first, second] = [id(810), id(811)];
		await db.query(`insert into party (id, kind, name) values ('${DUPLICATE}', 'person', 'A. Example'),
				('${first}', 'company', 'Example First Office'), ('${second}', 'company', 'Example Second Office');
			insert into party_link (id, kind, party_id, other_party_id, started_on, ended_on) values
				('${id(812)}', 'knows', '${AGENT}', '${first}', null, '2024-06-28'),
				('${id(813)}', 'knows', '${DUPLICATE}', '${first}', null, null),
				('${id(814)}', 'knows', '${AGENT}', '${second}', '2023-01-02', null),
				('${id(815)}', 'knows', '${second}', '${DUPLICATE}', '2023-01-02', '2024-06-28');
			select merge_party('${DUPLICATE}', '${AGENT}')`);
		const { rows } = await db.query(
			`select id, ended_on::text from party_link
			where id between '${id(812)}' and '${id(815)}' order by id`,
		);
		assert.deepEqual(rows, [
			{ id: id(812), ended_on: "2024-06-28" },
			{ id: id(813), ended_on: null },
			{ id: id(814), ended_on: null },
			{ id: id(815), ended_on: "2024-06-28" },
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

test("a merge keeps Needs attention when the duplicate lead had it", () =>
	rolledBack(async () => {
		await db.query(`insert into party (id, kind, name, how_found) values ('${DUPLICATE}', 'person', 'Example Duplicate', 'referral');
			insert into party_role (party_id, role, stage, needs_attention) values ('${DUPLICATE}', 'lead', 'opportunity', true);
			select merge_party('${DUPLICATE}', '${LEAD}'); ${CHECK_AT_COMMIT}`);
		const result = await db.query(
			"select needs_attention from party_role where party_id = $1 and role = 'lead'",
			[LEAD],
		);
		assert.deepEqual(result.rows, [{ needs_attention: true }]);
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

test("not recorded is judged on the saved party, after a correction or a merge in the same save", () =>
	rolledBack(async () => {
		await db.query(`insert into party (id, kind, name, how_found) values
				('${id(663)}', 'person', 'Example Corrected', 'not_recorded'), ('${DUPLICATE}', 'person', 'Example Imported', 'not_recorded');
			insert into outside_id (source, value, party_id) values ('old_system', '${id(664)}', '${DUPLICATE}');
			update party set how_found = 'referral' where id = '${id(663)}';
			select merge_party('${DUPLICATE}', '${LEAD}'); ${CHECK_AT_COMMIT}`);
		const { rows } =
			await db.query(`select (select how_found from party where id = '${id(663)}') as corrected,
			(select how_found from party where id = '${LEAD}') as survivor`);
		assert.deepEqual(rows, [
			{ corrected: "referral", survivor: "public_records" },
		]);
	}));

test("a merge keeps a recorded source and its detail over not recorded", () =>
	rolledBack(async () => {
		await db.query(`insert into party (id, kind, name, how_found) values ('${OLD}', 'person', 'Example Imported', 'not_recorded');
			insert into outside_id (source, value, party_id) values ('old_system', '${id(664)}', '${OLD}');
			insert into party (id, kind, name, how_found, how_found_detail) values ('${DUPLICATE}', 'person', 'Example Other', 'vendor', 'Example vendor');
			select merge_party('${DUPLICATE}', '${OLD}'); ${CHECK_AT_COMMIT}`);
		const { rows } = await db.query(
			`select how_found, how_found_detail from party where id = '${OLD}'`,
		);
		assert.deepEqual(rows, [
			{ how_found: "vendor", how_found_detail: "Example vendor" },
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

test("a merge moves each membership's review to the survivor, onto its own membership of the same territory and start, keeping its reviewer and time", () =>
	rolledBack(async () => {
		await db.query(`${DUPLICATE_TITLE_COMPANY};
			insert into party_territory (party_id, territory_id, started_on) values
				('${DUPLICATE}', '${STATEWIDE}', '2025-07-01'), ('${DUPLICATE}', '${HOME}', null);
			${newMembershipReview({ party: DUPLICATE, hasOffice: "false", coverage: "'Example: the whole state'" })};
			${newMembershipReview({ party: DUPLICATE, territory: HOME, source: "'Example call'" })};
			${REVIEWED_BY_OLD_SYSTEM};
			${asJob("agent")};
			select merge_party('${DUPLICATE}', '${VENDOR}')`);
		const { rows } = await db.query(
			`select t.territory_id, t.started_on::text, r.has_office, r.coverage, r.source, r.reviewed_by_job, r.reviewed_at
			from party_territory_review r join party_territory t on t.id = r.party_territory_id
			where t.party_id = $1 order by t.started_on`,
			[VENDOR],
		);
		assert.deepEqual(rows, [
			{
				territory_id: STATEWIDE,
				started_on: "2025-07-01",
				has_office: false,
				coverage: "Example: the whole state",
				source: "Example website",
				reviewed_by_job: "old_system",
				reviewed_at: REVIEWED_AT,
			},
			{
				territory_id: HOME,
				started_on: null,
				has_office: true,
				coverage: null,
				source: "Example call",
				reviewed_by_job: "old_system",
				reviewed_at: REVIEWED_AT,
			},
		]);
		const moves = await db.query(
			`select changed_by_job, merge_of from change where table_name = 'party_territory_review' and action = 'update'`,
		);
		assert.deepEqual(moves.rows, [
			{ changed_by_job: "agent", merge_of: DUPLICATE },
		]);
	}));

test("another user confirming a review's unchanged evidence becomes its reviewer, and history keeps the earlier one", () =>
	rolledBack(async () => {
		await db.query(`${newMembershipReview()}; ${REVIEWED_BY_OLD_SYSTEM}; ${asUser(TEAMMATE)};
			update party_territory_review set has_office = has_office, coverage = coverage, source = source`);
		const review = await db.query(
			"select reviewed_by_user_id, reviewed_by_job, reviewed_at = now() as now from party_territory_review",
		);
		assert.deepEqual(review.rows, [
			{ reviewed_by_user_id: TEAMMATE, reviewed_by_job: null, now: true },
		]);
		const history = await db.query(
			`select changed_by_user_id, old_value ->> 'reviewed_by_job' as was from change
			where table_name = 'party_territory_review' and action = 'update'`,
		);
		assert.deepEqual(history.rows, [
			{ changed_by_user_id: TEAMMATE, was: "old_system" },
		]);
	}));

test("only the engine and the owner run a merge", async () => {
	const { rows } = await db.query(
		`select has_function_privilege('public', 'merge_party(uuid, uuid)', 'execute') as anyone,
			has_function_privilege('engine', 'merge_party(uuid, uuid)', 'execute') as engine`,
	);
	assert.deepEqual(rows, [{ anyone: false, engine: true }]);
});

// A merge either settles these keys or the constraint refuses it.
const MERGE_KEYS = [
	"activity_about_activity_id_deal_id_party_id_property_id_key",
	"activity_about_activity_party_key",
	"app_user_id_is_account_partner_key",
	"app_user_pkey",
	"building_ownership_property_id_party_id_kind_started_on_key",
	"deal_party_pkey",
	"do_not_contact_pkey",
	"lead_contact_draft_party_id_key",
	"lead_email_attention_pkey",
	"lead_email_source_activity_id_party_id_key",
	"lead_stage_move_party_id_from_stage_to_stage_activity_id_key",
	"national_account_pkey",
	"next_step_one_open_per_owner",
	"party_company_person_id_company_id_started_on_key",
	"party_document_pkey",
	"party_email_address_party_id_key",
	"party_email_one_primary",
	"party_link_can_introduce_once",
	"party_phone_number_extension_party_id_key",
	"party_phone_one_primary",
	"party_role_pkey",
	"party_specialty_pkey",
	"party_territory_party_id_territory_id_started_on_key",
	"proposal_source_payload_once",
];
test("every unique key that holds a party is one a merge handles", async () => {
	const { rows } = await db.query(
		`select array_agg(distinct i.indexrelid::regclass::text order by i.indexrelid::regclass::text) as keys
		from pg_constraint c
		join pg_attribute target on target.attrelid = c.confrelid and target.attname = 'id'
		join pg_index i on i.indrelid = c.conrelid and i.indisunique
			and c.conkey[array_position(c.confkey, target.attnum)] = any (i.indkey)
		where c.contype = 'f' and c.confrelid = 'party'::regclass`,
	);
	assert.deepEqual(rows[0].keys, MERGE_KEYS);
});

test("a party merge cannot discard one of two conflicting open steps", async () =>
	rolledBack(async () => {
		await db.query(`${asUser(TEAMMATE)};
			insert into party (id, kind, name) values ('${DUPLICATE}', 'person', 'Example Duplicate');
			insert into next_step (what, party_id) values ('First example', '${DUPLICATE}'), ('Second example', '${AGENT}');
			savepoint merge_attempt`);
		await assert.rejects(
			db.query(`select merge_party('${DUPLICATE}', '${AGENT}')`),
			{ code: "23505" },
		);
		await db.query("rollback to merge_attempt");
		const { rows } = await db.query(`select party_id from next_step
			where party_id in ('${DUPLICATE}', '${AGENT}') and status = 'open' and owner_party_id = '${TEAMMATE}'`);
		assert.deepEqual(
			new Set(rows.map((row) => row.party_id)),
			new Set([DUPLICATE, AGENT]),
		);
	}));

for (const [label, sql, refusal] of [
	[
		"initial archive bypass",
		`insert into party_role (party_id, role, stage) values ('${DOCTOR}', 'lead', 'archived')`,
		"lead_stage_needs_evidence",
	],
	[
		"blank archive reason",
		newLeadMove({ to_stage: "archived", reason: " " }),
		"lead_stage_move_reason_check",
	],
	[
		"nonlead evidence",
		`insert into activity_about (activity_id, party_id) values ('${CALL}', '${DOCTOR}'); ${newLeadMove({ party_id: DOCTOR })}; ${CHECK_AT_COMMIT}`,
		"lead_stage_move_current_stage",
	],
	[
		"blank evidence",
		newLeadMove({ evidence_ref: " " }),
		"lead_stage_move_evidence_ref_check",
	],
	[
		"missing activity",
		newLeadMove({ activity_id: MISSING }),
		"lead_stage_move_activity_id_fkey",
	],
	[
		"wrong role's stage",
		newLeadMove({ to_stage: "unknown" }),
		"lead_stage_move_role_to_stage_fkey",
	],
	[
		"no stage change",
		newLeadMove({ to_stage: "nurture" }),
		"lead_stage_move_changes_stage",
	],
	[
		"archive without reason",
		newLeadMove({ to_stage: "archived" }),
		"lead_stage_move_archive_reason",
	],
	[
		"weak job evidence",
		`${asJob("agent", USER)}; ${newLeadMove({})}`,
		"lead_stage_move_needs_user",
	],
	[
		"job archive",
		`${asJob("agent", USER)}; ${newLeadMove({ strength: "strong", to_stage: "archived", reason: "Example retired" })}`,
		"lead_stage_move_needs_user",
	],
	[
		"job skips funnel",
		`${asJob("lead_stage")}; ${newLeadMove({ strength: "strong" })}`,
		"lead_stage_move_job_funnel",
	],
	[
		"stale proposal",
		newLeadMove({ from_stage: "new" }),
		"lead_stage_move_current_stage",
	],
	[
		"job bypass",
		`${asJob("lead_stage")}; update party_role set stage = 'engaged' where party_id = '${LEAD}'`,
		"lead_stage_needs_evidence",
	],
	[
		"archive bypass",
		`update party_role set stage = 'archived' where party_id = '${LEAD}'`,
		"lead_stage_needs_evidence",
	],
	[
		"rewrite evidence",
		"update lead_stage_move set evidence_ref = 'replacement'",
		notGranted("lead_stage_move"),
	],
	[
		"remove evidence",
		"delete from lead_stage_move",
		notGranted("lead_stage_move"),
	],
] satisfies [string, string, Refusal][]) {
	test(`lead stage evidence refuses ${label}`, () =>
		rolledBack(async () => {
			await assert.rejects(db.query(sql), expected(refusal));
		}));
}

test("stage evidence stays with the survivor when two leads merge", () =>
	rolledBack(async () => {
		await db.query(`${newLeadMove({})};
		insert into party (id, kind, name, how_found) values ('${OLD}', 'person', 'Example Survivor', 'public_records');
		insert into party_role (party_id, role, stage) values ('${OLD}', 'lead', 'new');
		${asJob("agent", USER)}; select merge_party('${LEAD}', '${OLD}'); ${CHECK_AT_COMMIT}`);
		assert.equal(
			(
				await db.query(
					`select party_id from lead_stage_move where id = '${MOVE}'`,
				)
			).rows[0].party_id,
			OLD,
		);
	}));

for (const [from, to] of [
	["new", "qualified"],
	["qualified", "outreach_active"],
	["outreach_active", "engaged"],
	["engaged", "nurture"],
	["engaged", "opportunity"],
] satisfies [string, string][]) {
	test(`strong evidence applies ${from} to ${to}`, () =>
		rolledBack(async () => {
			await db.query(
				`update party_role set stage = '${from}' where party_id = '${LEAD}';`,
			);
			await db.query(
				`${asJob("lead_stage")}; ${newLeadMove({
					id: id(732),
					activity_id: NOTE,
					from_stage: from,
					to_stage: to,
					strength: "strong",
				})}`,
			);
			assert.equal(
				(
					await db.query(
						`select stage from party_role where party_id = '${LEAD}'`,
					)
				).rows[0].stage,
				to,
			);
		}));
}

for (const [label, sql, refusal] of [
	[
		"duplicate proposal",
		`${newLeadMove()}; ${newLeadMove({ id: id(734) })}`,
		"lead_stage_move_party_id_from_stage_to_stage_activity_id_key",
	],
	[
		"missing evidence",
		newLeadMove({ activity_id: null, evidence_ref: null }),
		"lead_stage_move_has_evidence",
	],
	[
		"unrelated activity",
		`${newLeadMove({ activity_id: EMAIL })}; ${CHECK_AT_COMMIT}`,
		"lead_stage_move_activity_id_party_id_fkey",
	],
	[
		"unlink evidence",
		`${newLeadMove()}; delete from activity_about where activity_id = '${CALL}' and party_id = '${LEAD}'; ${CHECK_AT_COMMIT}`,
		"lead_stage_move_activity_id_party_id_fkey",
	],
] satisfies [string, string, Refusal][]) {
	test(`lead stage evidence refuses ${label}`, () =>
		rolledBack(async () => {
			await assert.rejects(db.query(sql), expected(refusal));
		}));
}

test("an agent working for a user corrects an ordinary stage, and a user archives without inventing an activity", () =>
	rolledBack(async () => {
		await db.query(`${asJob("agent", USER)}; update party_role set stage = 'new' where party_id = '${LEAD}';
		${asUser(USER)}; ${newLeadMove({ from_stage: "new", to_stage: "archived", activity_id: null, evidence_ref: null, reason: "Example retired" })}; ${CHECK_AT_COMMIT}`);
		assert.equal(
			(
				await db.query(
					`select stage from party_role where party_id = '${LEAD}'`,
				)
			).rows[0].stage,
			"archived",
		);
	}));

test("a merge collapses matching applied evidence and retains the removed row in change history", () =>
	rolledBack(async () => {
		await db.query(`insert into party (id, kind, name, how_found) values ('${OLD}', 'person', 'Example Duplicate', 'public_records');
		insert into party_role (party_id, role, stage) values ('${OLD}', 'lead', 'nurture');
		insert into activity_about (activity_id, party_id) values ('${CALL}', '${OLD}');
		${newLeadMove()}; ${newLeadMove({ id: id(735), party_id: OLD })};
		select merge_party('${OLD}', '${LEAD}'); ${CHECK_AT_COMMIT}`);
		assert.equal(
			(await db.query("select count(*) from lead_stage_move")).rows[0].count,
			"1",
		);
		assert.equal(
			(
				await db.query(
					`select count(*) from change where table_name = 'lead_stage_move' and action = 'delete'`,
				)
			).rows[0].count,
			"1",
		);
	}));

test("competing stage evidence holds the lead until the first move completes", async () => {
	const first = await connect(),
		second = await connect();
	try {
		await first.query(`begin; ${newLeadMove({})}`);
		await second.query("begin; set local lock_timeout = '100ms'");
		await assert.rejects(
			second.query(newLeadMove({ id: id(736), activity_id: NOTE })),
			{ code: "55P03" },
		);
	} finally {
		for (const connection of [first, second]) {
			await connection.query("rollback");
			await connection.end();
		}
	}
});

for (const [sql, refusal] of [
	[
		"update party_role set lane = 'unknown' where role = 'lead'",
		"party_role_lane_fkey",
	],
	[
		"update party_role set lane = 'renewal_radar' where role = 'vendor'",
		"party_role_working_details_on_lead",
	],
	[
		"update party_role set estimated_lease_on = '2030-01-01' where role = 'lead'",
		"party_role_lease_estimate_has_source",
	],
	[
		"update party_role set lease_estimate_source = 'Example feed' where role = 'lead'",
		"party_role_lease_estimate_has_source",
	],
	[
		"update party_role set estimated_lease_on = '2030-01-01', lease_estimate_source = ' ' where role = 'lead'",
		"party_role_lease_estimate_source_check",
	],
	[
		"update party_role set estimated_lease_on = '2030-01-01', lease_estimate_source = 'Example feed', lease_estimate_confidence = 'certain' where role = 'lead'",
		"party_role_lease_estimate_confidence_check",
	],
	[
		"update party_role set lease_estimate_confidence = 'high' where role = 'lead'",
		"party_role_lease_confidence_has_estimate",
	],
	[
		"update party_role set segment = ' ' where role = 'lead'",
		"party_role_segment_check",
	],
	[
		"update party_role set segment = 'Example segment' where role = 'vendor'",
		"party_role_working_details_on_lead",
	],
	[
		`update party set how_found_detail = ' ' where id = '${LEAD}'`,
		"party_how_found_detail_check",
	],
	[
		`update party set how_found_detail = 'Example referral' where id = '${AGENT}'`,
		"party_how_found_detail_has_source",
	],
] satisfies Case[]) {
	test(`lead working details refuse ${refusal}: ${sql}`, () =>
		rolledBack(async () => {
			await assert.rejects(db.query(sql), expected(refusal));
		}));
}

test("lead working details keep sourced dates together when leads merge", () =>
	rolledBack(async () => {
		await db.query(`update party_role set lane = 'renewal_radar', segment = 'Example segment',
		estimated_lease_on = '2030-01-01', lease_estimate_source = 'Example feed', lease_estimate_confidence = 'high'
		where party_id = '${LEAD}';
		update party set how_found_detail = 'Example public filing' where id = '${LEAD}';
		insert into party (id, kind, name, how_found) values ('${OLD}', 'person', 'Example Lead', 'public_records');
		insert into party_role (party_id, role, stage) values ('${OLD}', 'lead', 'new');
		select merge_party('${LEAD}', '${OLD}'); ${CHECK_AT_COMMIT}`);
		const read = async () =>
			(
				await db.query(`select lane, segment, estimated_lease_on::text as date,
		lease_estimate_source as source, lease_estimate_confidence as confidence, how_found_detail
		from party_role join party on id = party_id where party_id = '${OLD}'`)
			).rows;
		const expected = [
			{
				lane: "renewal_radar",
				segment: "Example segment",
				date: "2030-01-01",
				source: "Example feed",
				confidence: "high",
				how_found_detail: "Example public filing",
			},
		];
		assert.deepEqual(await read(), expected);
		await db.query(`insert into party (id, kind, name, how_found, how_found_detail) values ('${DUPLICATE}', 'person', 'Example Other', 'vendor', 'Different source');
		insert into party_role (party_id, role, stage, lane, estimated_lease_on, lease_estimate_source, lease_estimate_confidence)
		values ('${DUPLICATE}', 'lead', 'engaged', 'new_entity', '2040-01-01', 'Other feed', 'low');
		select merge_party('${DUPLICATE}', '${OLD}'); ${CHECK_AT_COMMIT}`);
		assert.deepEqual(await read(), expected);
	}));

for (const source of ["public_records", "vendor"]) {
	test(`a merge never borrows confidence and fills attribution detail only from matching ${source}`, () =>
		rolledBack(async () => {
			await db.query(`update party_role set estimated_lease_on = '2030-01-01', lease_estimate_source = 'Survivor feed'
			where party_id = '${LEAD}';
			insert into party (id, kind, name, how_found, how_found_detail) values ('${OLD}', 'person', 'Example Other', '${source}', 'Duplicate detail');
			insert into party_role (party_id, role, stage, estimated_lease_on, lease_estimate_source, lease_estimate_confidence)
			values ('${OLD}', 'lead', 'new', '2040-01-01', 'Duplicate feed', 'high');
			select merge_party('${OLD}', '${LEAD}'); ${CHECK_AT_COMMIT}`);
			assert.deepEqual(
				(
					await db.query(`select estimated_lease_on::text as date, lease_estimate_source as source,
			lease_estimate_confidence as confidence, how_found_detail as detail from party_role
			join party on id = party_id where party_id = '${LEAD}'`)
				).rows,
				[
					{
						date: "2030-01-01",
						source: "Survivor feed",
						confidence: null,
						detail: source === "public_records" ? "Duplicate detail" : null,
					},
				],
			);
		}));
}

for (const [label, sql, refusal] of [
	[
		"a new draft that skips the human send",
		newLeadDraft({ requires_human_send: "false" }),
		notGranted("lead_contact_draft"),
	],
	[
		"a new draft marked dispatchable",
		newLeadDraft({ dispatchable: "true" }),
		notGranted("lead_contact_draft"),
	],
	[
		"a new draft marked approved",
		newLeadDraft({ approved: "true" }),
		notGranted("lead_contact_draft"),
	],
	[
		"a blank subject",
		newLeadDraft({ subject: " " }),
		"lead_contact_draft_subject_check",
	],
	[
		"a blank body",
		newLeadDraft({ body: " " }),
		"lead_contact_draft_body_check",
	],
	[
		"a blank time zone",
		newLeadDraft({ time_zone: " " }),
		"lead_contact_draft_time_zone_check",
	],
	[
		"an owner who is not a user",
		newLeadDraft({ owner_user_id: CLIENT }),
		"lead_contact_draft_owner_user_id_fkey",
	],
	[
		"a party that is not a lead",
		`${newLeadDraft({ party_id: DOCTOR })}; ${CHECK_AT_COMMIT}`,
		"lead_contact_draft_party_id_role_fkey",
	],
	[
		"a second draft for the same lead",
		`${newLeadDraft()}; ${newLeadDraft({ id: id(741) })}`,
		"lead_contact_draft_party_id_key",
	],
	[
		"approval by an agent job",
		`${newLeadDraft()}; update party_role set stage = 'qualified' where party_id = '${LEAD}'; ${asJob("agent")}; update lead_contact_draft set approved = true`,
		"lead_contact_draft_user_approves",
	],
	[
		"marking a saved draft dispatchable",
		"update lead_contact_draft set dispatchable = true",
		notGranted("lead_contact_draft"),
	],
	[
		"changing a draft's revision",
		"update lead_contact_draft set revision = 5",
		notGranted("lead_contact_draft"),
	],
] satisfies [string, string, Refusal][]) {
	test(`outreach draft refuses ${label}`, () =>
		rolledBack(async () => {
			await assert.rejects(db.query(sql), expected(refusal));
		}));
}

for (const [field, value] of [
	["body", "Example revised contact"],
	["subject", "Example revised subject"],
	["owner_user_id", TEAMMATE],
	["scheduled_for", "2031-01-01T12:00:00Z"],
	["time_zone", "America/Chicago"],
] satisfies [string, string][]) {
	test(`editing outreach draft ${field} clears approval and increments its revision`, () =>
		rolledBack(async () => {
			await db.query(`update party_role set stage = 'qualified' where party_id = '${LEAD}'; ${asJob("agent", USER)}; ${newLeadDraft()}; update lead_contact_draft set approved = true;
		update lead_contact_draft set ${field} = '${value}', approved = true`);
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
				`${asUser(USER)}; update lead_contact_draft set approved = true where revision = 2`,
			);
			assert.equal(
				(await db.query("select approved from lead_contact_draft")).rows[0]
					.approved,
				true,
			);
		}));
}

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
		insert into party_role (party_id, role, stage) values ('${OLD}', 'lead', 'qualified');
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

for (const [label, sql, refusal] of [
	[
		"do not contact",
		`${newLeadDraft()}; update party_role set stage = 'qualified' where party_id = '${LEAD}'; insert into do_not_contact (party_id, reason) values ('${LEAD}', 'Example asked to stop'); update lead_contact_draft set approved = true`,
		"lead_contact_draft_contactable",
	],
	[
		"unqualified lead",
		`${newLeadDraft()}; update lead_contact_draft set approved = true`,
		"lead_contact_draft_contactable",
	],
	[
		"unattended edit",
		`${newLeadDraft()}; update party_role set stage = 'qualified' where party_id = '${LEAD}'; ${asJob("agent")}; update lead_contact_draft set body = 'Example changed'`,
		"lead_contact_draft_user_approves",
	],
] satisfies [string, string, Refusal][]) {
	test(`outreach draft refuses ${label}`, () =>
		rolledBack(async () => {
			await assert.rejects(db.query(sql), expected(refusal));
		}));
}

test("an expired contact pause permits a qualified lead's outreach approval", () =>
	rolledBack(async () => {
		await db.query(`${newLeadDraft()}; update party_role set stage = 'qualified' where party_id = '${LEAD}';
		insert into do_not_contact (party_id, reason, until_date) values ('${LEAD}', 'Example pause', current_date - 1);
		update lead_contact_draft set approved = true`);
		assert.equal(
			(await db.query("select approved from lead_contact_draft")).rows[0]
				.approved,
			true,
		);
	}));

for (const [label, sql, refusal] of [
	[
		"duplicate sweep row",
		`${newCandidate()}; ${newCandidate({ id: id(751) })}`,
		"candidate_source_source_key_key",
	],
	["blank source", newCandidate({ source: " " }), "candidate_source_check"],
	[
		"padded key",
		newCandidate({ source_key: " example-1 " }),
		"candidate_source_key_check",
	],
	[
		"nonobject context",
		newCandidate({ source_row: "[]" }),
		"candidate_source_row_check",
	],
	["blank name", newCandidate({ name: " " }), "candidate_name_check"],
	[
		"blank qualification",
		newCandidate({ qualification: " " }),
		"candidate_qualification_check",
	],
	[
		"estimate without source",
		newCandidate({ estimated_lease_on: "2030-01-01" }),
		"candidate_estimate_has_source",
	],
	[
		"source without estimate",
		newCandidate({ lease_estimate_source: "Example feed" }),
		"candidate_estimate_has_source",
	],
	[
		"blank estimate source",
		newCandidate({
			estimated_lease_on: "2030-01-01",
			lease_estimate_source: " ",
		}),
		"candidate_lease_estimate_source_check",
	],
	[
		"promotion without lead",
		newCandidate({ status: "promoted" }),
		"candidate_promoted_has_lead",
	],
	[
		"unreviewed linked to party",
		newCandidate({ promoted_party_id: LEAD }),
		"candidate_promoted_has_lead",
	],
	[
		"promoted nonlead",
		`${newCandidate({ status: "promoted", promoted_party_id: DOCTOR })}; ${CHECK_AT_COMMIT}`,
		"candidate_promoted_party_id_lead_role_fkey",
	],
	[
		"decline without reason",
		newCandidate({ status: "declined" }),
		"candidate_rejection_has_reason",
	],
	[
		"blank reason",
		newCandidate({ status: "suppressed", reason: " " }),
		"candidate_reason_check",
	],
	[
		"unattended promotion",
		`${asJob("candidate_sweep")}; ${newCandidate({ status: "promoted", promoted_party_id: LEAD })}`,
		"candidate_user_decides",
	],
	[
		"unattended decline",
		`${asJob("candidate_sweep")}; ${newCandidate({ status: "declined", reason: "Example not a fit" })}`,
		"candidate_user_decides",
	],
	[
		"suppressed promotion",
		`${newCandidate({ status: "suppressed", reason: "Example duplicate" })}; update candidate set status = 'promoted', reason = null, promoted_party_id = '${LEAD}'`,
		"candidate_unreviewed_promotes",
	],
	[
		"reopen declined",
		`${newCandidate({ status: "declined", reason: "Example not a fit" })}; update candidate set status = 'unreviewed', reason = null`,
		"candidate_decision_final",
	],
	[
		"reopen promoted",
		`${newCandidate({ status: "promoted", promoted_party_id: LEAD })}; update candidate set status = 'unreviewed', promoted_party_id = null`,
		"candidate_decision_final",
	],
	[
		"rewrite provenance",
		"update candidate set source = 'replacement'",
		notGranted("candidate"),
	],
	["remove candidate", "delete from candidate", notGranted("candidate")],
] satisfies [string, string, Refusal][]) {
	test(`candidate refuses ${label}`, () =>
		rolledBack(async () => {
			await assert.rejects(db.query(sql), expected(refusal));
		}));
}

test("a sweep adds no party; a user promotes a candidate to a lead and its source context stays", () =>
	rolledBack(async () => {
		const before = (await db.query("select count(*) from party")).rows[0].count;
		await db.query(
			`${asJob("candidate_sweep")}; ${newCandidate({ estimated_lease_on: "2030-01-01", lease_estimate_source: "Example feed" })}`,
		);
		assert.equal(
			(await db.query("select count(*) from party")).rows[0].count,
			before,
		);
		await db.query(
			`${asUser(USER)}; update candidate set status = 'promoted', promoted_party_id = '${LEAD}'`,
		);
		assert.deepEqual(
			(
				await db.query(
					"select status, promoted_party_id, source_row, estimated_lease_on::text as estimate, lease_estimate_source from candidate",
				)
			).rows,
			[
				{
					status: "promoted",
					promoted_party_id: LEAD,
					source_row: { license: "example-1", email: "example@example.com" },
					estimate: "2030-01-01",
					lease_estimate_source: "Example feed",
				},
			],
		);
	}));

test("suppression waits for a user to reopen before promotion", () =>
	rolledBack(async () => {
		await db.query(`${asJob("candidate_sweep")}; ${newCandidate({ status: "suppressed", reason: "Example possible duplicate" })};
		${asUser(USER)}; update candidate set status = 'unreviewed', reason = null;
		update candidate set status = 'promoted', promoted_party_id = '${LEAD}'; ${CHECK_AT_COMMIT}`);
		assert.equal(
			(await db.query("select status from candidate")).rows[0].status,
			"promoted",
		);
	}));

test("a promoted candidate can only follow its party through a merge", () =>
	rolledBack(async () => {
		await db.query(
			`${newCandidate({ status: "promoted", promoted_party_id: LEAD })}; savepoint promotion`,
		);
		await assert.rejects(
			db.query(`update candidate set promoted_party_id = '${CLIENT}'`),
			expected("candidate_promotion_stays"),
		);
		await db.query(`rollback to promotion;
		insert into party (id, kind, name, how_found) values ('${OLD}', 'person', 'Example Survivor', 'public_records');
		insert into party_role (party_id, role, stage) values ('${OLD}', 'lead', 'new');
		${asJob("agent", USER)}; select merge_party('${LEAD}', '${OLD}'); ${CHECK_AT_COMMIT}`);
		assert.equal(
			(await db.query("select promoted_party_id from candidate")).rows[0]
				.promoted_party_id,
			OLD,
		);
	}));

for (const [label, sql, refusal] of [
	[
		"job reopening suppression",
		`${newCandidate({ status: "suppressed", reason: "Example duplicate" })}; ${asJob("candidate_sweep")}; update candidate set status = 'unreviewed', reason = null`,
		"candidate_user_decides",
	],
	[
		"rewriting decline reason",
		`${newCandidate({ status: "declined", reason: "Example not a fit" })}; ${asJob("candidate_sweep")}; update candidate set reason = 'Example replacement'`,
		"candidate_decision_final",
	],
] satisfies [string, string, Refusal][]) {
	test(`candidate refuses ${label}`, () =>
		rolledBack(async () => {
			await assert.rejects(db.query(sql), expected(refusal));
		}));
}
for (const fields of [
	"source_row = '{}'",
	"name = 'Example replacement'",
	"qualification = 'Example new basis'",
	"estimated_lease_on = '2031-01-01', lease_estimate_source = 'Example new feed'",
]) {
	test(`a decided candidate refuses refreshed ${fields}`, () =>
		rolledBack(async () => {
			await db.query(
				newCandidate({ status: "promoted", promoted_party_id: LEAD }),
			);
			await assert.rejects(
				db.query(`update candidate set ${fields}`),
				expected("candidate_refresh_unreviewed"),
			);
		}));
}

test("a repeated sweep refreshes an unreviewed candidate and history keeps the earlier source facts", () =>
	rolledBack(async () => {
		await db.query(`${asJob("candidate_sweep")}; ${newCandidate()};
		${newCandidate({ id: id(751), name: "Example refreshed", source_row: JSON.stringify({ reading: 2 }), estimated_lease_on: "2031-01-01", lease_estimate_source: "Example new feed" })}
		on conflict (source, source_key) do update set name = excluded.name, source_row = excluded.source_row,
			estimated_lease_on = excluded.estimated_lease_on, lease_estimate_source = excluded.lease_estimate_source`);
		assert.deepEqual(
			(
				await db.query(
					"select name, source_row, estimated_lease_on::text as estimate from candidate",
				)
			).rows,
			[
				{
					name: "Example refreshed",
					source_row: { reading: 2 },
					estimate: "2031-01-01",
				},
			],
		);
		assert.deepEqual(
			(
				await db.query(
					"select old_value -> 'source_row' as source from change where table_name = 'candidate' and action = 'update'",
				)
			).rows,
			[{ source: { license: "example-1", email: "example@example.com" } }],
		);
	}));

test("an agent acting for a user can promote a reviewed candidate", () =>
	rolledBack(async () => {
		await db.query(
			`${newCandidate()}; ${asJob("agent", USER)}; update candidate set status = 'promoted', promoted_party_id = '${LEAD}'`,
		);
		assert.deepEqual(
			(
				await db.query(
					"select status, changed_by_job, changed_for_user_id from candidate",
				)
			).rows,
			[
				{
					status: "promoted",
					changed_by_job: "agent",
					changed_for_user_id: USER,
				},
			],
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
values ('${id(703)}', '${BRAND}', '${TEAMMATE}', '2020-01-01', '2026-01-01');
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

test("a rebrand and a new account owner keep the previous dated membership", async () => {
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
			[{ owner_id: TEAMMATE }, { owner_id: USER }],
		);
	});
});

const RESEARCH = id(711);
const newResearch = (fields: Record<string, string | number | null> = {}) =>
	insert("client_research", {
		id: RESEARCH,
		party_id: CLIENT,
		kind: "research_note",
		source: "https://example.test/source",
		found: "true",
		observed_at: "2025-01-01",
		...fields,
	});

// biome-ignore format: one row per refusal
const CLIENT_REFUSALS: Case[] = [
	[`update client set status = 'active_deal'`, "client_status_check"],
	[`update client set status = 'past_client'`, "client_status_check"],
	[`update client set client_type = 'unknown'`, "client_client_type_fkey"],
	[`insert into client (party_id) values ('${AGENT}')`, "client_party_id_role_fkey"],
	[`insert into client (party_id, role) values ('${AGENT}', 'listing_agent')`, "client_role_check"],
	[`insert into client_vertical (party_id, vertical) values ('${CLIENT}', ' ')`, "client_vertical_vertical_check"],
	[`insert into client_vertical (party_id, vertical) values ('${CLIENT}', ' Example')`, "client_vertical_vertical_check"],
	[`insert into client_vertical (party_id, vertical, subtype) values ('${CLIENT}', 'Example', ' ')`, "client_vertical_subtype_check"],
	[`insert into client_vertical (party_id, vertical) values ('${CLIENT}', 'Example A'), ('${CLIENT}', 'Example B')`, "client_vertical_pkey"],
	[`insert into client_vertical (party_id, vertical) values ('${AGENT}', 'Example')`, "client_vertical_party_id_role_fkey"],
	[`insert into client_vertical (party_id, role, vertical) values ('${AGENT}', 'listing_agent', 'Example')`, "client_vertical_role_check"],
	[newResearch({ party_id: AGENT }), "client_research_party_id_role_fkey"],
	[newResearch({ party_id: AGENT, role: "listing_agent" }), "client_research_role_check"],
	[newResearch({ kind: " " }), "client_research_kind_check"],
	[newResearch({ source: " " }), "client_research_source_check"],
	[newResearch({ observed_at: "infinity" }), "client_research_observed_at_check"],
	[newResearch({ expires_on: "infinity" }), "client_research_expires_on_check"],
	[`insert into client_research_fact values ('${RESEARCH}', 'finding', 'true')`, "client_research_fact_research_id_fkey"],
	[`${newResearch()}; insert into client_research_fact values ('${RESEARCH}', ' ', 'true')`, "client_research_fact_field_check"],
	[`${newResearch()}; insert into client_research_fact values ('${RESEARCH}', 'found', 'true')`, "client_research_fact_field_check"],
	[`${newResearch()}; insert into client_research_fact values ('${RESEARCH}', 'finding', 'true'), ('${RESEARCH}', 'finding', 'false')`, "client_research_fact_pkey"],
	[`insert into party_role (party_id, role) values ('${USER}', 'national_account');
	insert into national_account (party_id) values ('${USER}')`, "national_account_party_id_kind_fkey"],
	[`insert into national_account (party_id) values ('${NEXT_BRAND}')`, "national_account_party_id_role_fkey"],
	[`insert into national_account (party_id, role) values ('${CLIENT}', 'client')`, "national_account_role_check"],
	[`insert into client_brand (location_id, brand_id, started_on) values ('${CLIENT}', '${CLIENT}', '2026-01-01')`, "client_brand_different_parties"],
	[`insert into client_brand (location_id, brand_id, started_on) values ('${CLIENT}', '${AGENT}', '2026-01-01')`, "client_brand_brand_id_brand_kind_fkey"],
	[`insert into client_brand (location_id, brand_id, started_on) values ('${NEXT_BRAND}', '${BRAND}', '2026-01-01')`, "client_brand_location_id_fkey"],
	[`insert into client_brand (location_id, brand_id, started_on) values ('${USER}', '${BRAND}', '2026-01-01')`, "client_brand_location_id_fkey"],
	[`update client_brand set ended_on = '2020-01-01'`, "client_brand_check"],
	[`update national_account_owner set ended_on = '2020-01-01'`, "national_account_owner_check"],
	[`insert into national_account_owner (account_id, owner_id, started_on) values ('${BRAND}', '${CLIENT}', '2026-01-01')`, "national_account_owner_owner_id_owner_is_partner_fkey"],
	[`insert into national_account_owner (account_id, owner_id, started_on) values ('${NEXT_BRAND}', '${USER}', '2026-01-01')`, "national_account_owner_account_id_fkey"],
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

test("a merge carries client research and fills a missing subtype on a shared practice type", async () => {
	await rolledBack(async () => {
		await db.query(`${CLIENT_PROFILE}
			update party set how_found = 'referral' where id = '${NEXT_BRAND}';
			insert into party_role (party_id, role) values ('${NEXT_BRAND}', 'client');
			insert into client_vertical (party_id, vertical, subtype) values
				('${CLIENT}', 'Example practice', 'Example subtype'), ('${NEXT_BRAND}', 'Example practice', null);
			${newResearch()};
			insert into client_research_fact values ('${RESEARCH}', 'finding', 'true');
			select merge_party('${CLIENT}', '${NEXT_BRAND}')`);
		assert.deepEqual(
			(
				await db.query(
					"select party_id, vertical, subtype from client_vertical",
				)
			).rows,
			[
				{
					party_id: NEXT_BRAND,
					vertical: "Example practice",
					subtype: "Example subtype",
				},
			],
		);
		assert.deepEqual(
			(
				await db.query(`select r.party_id, f.value from client_research r
			join client_research_fact f on f.research_id = r.id`)
			).rows,
			[{ party_id: NEXT_BRAND, value: true }],
		);
	});
});

test("a merge refuses different client practice types by name", async () => {
	await rolledBack(async () => {
		await db.query(`${CLIENT_PROFILE}
			update party set how_found = 'referral' where id = '${NEXT_BRAND}';
			insert into party_role (party_id, role) values ('${NEXT_BRAND}', 'client');
			insert into client_vertical (party_id, vertical) values
				('${CLIENT}', 'Example practice'), ('${NEXT_BRAND}', 'Example different practice')`);
		await assert.rejects(
			db.query(`select merge_party('${CLIENT}', '${NEXT_BRAND}')`),
			{ code: "23514", constraint: "merge_party_client_verticals" },
		);
	});
});

test("a merge refuses different subtypes of the same practice type", async () => {
	await rolledBack(async () => {
		await db.query(`${CLIENT_PROFILE}
			update party set how_found = 'referral' where id = '${NEXT_BRAND}';
			insert into party_role (party_id, role) values ('${NEXT_BRAND}', 'client');
			insert into client_vertical (party_id, vertical, subtype) values
				('${CLIENT}', 'Example practice', 'First subtype'),
				('${NEXT_BRAND}', 'Example practice', 'Second subtype')`);
		await assert.rejects(
			db.query(`select merge_party('${CLIENT}', '${NEXT_BRAND}')`),
			expected("merge_party_client_verticals"),
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
			(
				await db.query(
					`select count(*) from lease_version where lease_id = '${LEASE_RECORD}'`,
				)
			).rows[0].count,
			"2",
		);
		assert.equal(
			(
				await db.query(
					`select count(*) from lease_option where lease_version_id = '${LEASE}'`,
				)
			).rows[0].count,
			"3",
		);
		assert.equal(
			(
				await db.query(
					`select changed_by_user_id from lease_version where id = '${LEASE}'`,
				)
			).rows[0].changed_by_user_id,
			USER,
		);
		assert.equal(
			(
				await db.query(
					"select count(*) from change where table_name in ('lease_version', 'lease_option')",
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
			(await db.query(`select lease_version_id from lease_option`)).rows[0]
				.lease_version_id,
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

const payment = (row: Record<string, string | number>) =>
	insert("commission_payment", { deal_id: DEAL, amount: 5000, ...row });
const share = (row: Record<string, string | number>) =>
	insert("commission_share", {
		deal_id: DEAL,
		party_id: AGENT,
		kind: "referral",
		...row,
	});
const tiers = (...rows: [number, number][]) =>
	`insert into commission_tier (user_id, from_deal, partner_user_id, closing_share) values ${rows
		.map(([from, closing]) => `('${USER}', ${from}, '${TEAMMATE}', ${closing})`)
		.join(", ")}`;
// Made up, and each count a broken rule could give lands on a different tier.
const LADDER = tiers([1, 0.9], [3, 0.7], [4, 0.6]);
const COMMISSION = `${LADDER}; insert into commission (deal_id, gross) values ('${DEAL}', 10000)`;

// biome-ignore format: one row per refusal
const COMMISSION_REFUSALS: Record<string, Case[]> = {
	"a deal's commission is recorded once, and its expected and gross amounts and any override are in range": [
		[`${COMMISSION}; insert into commission (deal_id) values ('${DEAL}')`, "commission_pkey"],
		[`insert into commission (deal_id) values ('${MISSING}')`, "commission_deal_id_fkey"],
		[`insert into commission (deal_id, expected) values ('${DEAL}', 0)`, "commission_expected_check"],
		[`insert into commission (deal_id, gross) values ('${DEAL}', -1)`, "commission_gross_check"],
		[`insert into commission (deal_id, closing_share) values ('${DEAL}', 1.1)`, "commission_closing_share_check"],
	],
	"a payment is part of a deal's gross, more than zero, invoiced before it is due or received": [
		[payment({}), "commission_payment_deal_id_fkey"],
		[`${COMMISSION}; ${payment({ amount: 0 })}`, "commission_payment_amount_check"],
		[`${COMMISSION}; ${payment({ received_on: "2026-05-01" })}`, "commission_payment_received_after_invoice"],
		[`${COMMISSION}; ${payment({ invoiced_on: "2026-05-01", due_on: "2026-04-30" })}`, "commission_payment_dates_in_order"],
		[`${COMMISSION}; ${payment({ invoiced_on: "2026-05-01", received_on: "2026-04-30" })}`, "commission_payment_dates_in_order"],
	],
	"payments never add up to more than the gross, checked when the change is saved": [
		[`${COMMISSION}; ${payment({ amount: 6000 })}; ${payment({})}; ${CHECK_AT_COMMIT}`, "commission_payments_within_gross"],
		[`insert into commission (deal_id, expected) values ('${DEAL}', 10000); ${payment({})}; ${CHECK_AT_COMMIT}`, "commission_payments_within_gross"],
		[`${COMMISSION}; ${payment({})}; update commission set gross = 4000; ${CHECK_AT_COMMIT}`, "commission_payments_within_gross"],
	],
	"others' shares go to a person or company, by kind, and never add up to more than the whole": [
		[`${COMMISSION}; ${share({ kind: "house", share: 0.1 })}`, "commission_share_kind_check"],
		[`${COMMISSION}; ${share({ share: 0 })}`, "commission_share_share_check"],
		[`${COMMISSION}; ${share({ party_id: MISSING, share: 0.1 })}`, "commission_share_party_id_fkey"],
		[`${COMMISSION}; ${share({ share: 0.6 })}; ${share({ party_id: `${BROKERAGES[0]}`, kind: "brokerage", share: 0.5 })}; ${CHECK_AT_COMMIT}`, "commission_shares_within_whole"],
	],
	"a ladder is a user's, with another user as partner, and starts at the first closed deal, stepping down toward even": [
		[tiers([0, 0.9]), "commission_tier_from_deal_check"],
		[tiers([1, 0.4]), "commission_tier_closing_share_check"],
		[`${tiers([1, 0.9])}; ${tiers([1, 0.8])}`, "commission_tier_pkey"],
		[`insert into commission_tier values ('${USER}', 1, '${USER}', 0.9)`, "commission_tier_another_user"],
		[`insert into commission_tier values ('${USER}', 1, '${AGENT}', 0.9)`, "commission_tier_partner_user_id_fkey"],
		[`${tiers([2, 0.9])}; ${CHECK_AT_COMMIT}`, "commission_ladder_steps_down"],
		[`${tiers([1, 0.7], [3, 0.9])}; ${CHECK_AT_COMMIT}`, "commission_ladder_steps_down"],
		[`${LADDER}; delete from commission_tier where user_id = '${USER}' and from_deal = 1; ${CHECK_AT_COMMIT}`, "commission_ladder_steps_down"],
	],
	"a gross needs its closing user's ladder, so its split names both users": [
		[`insert into commission (deal_id, gross) values ('${DEAL}', 10000); ${CHECK_AT_COMMIT}`, "commission_split_names_both_users"],
		[`insert into commission (deal_id, gross, closing_share) values ('${DEAL}', 10000, 0.6); ${CHECK_AT_COMMIT}`, "commission_split_names_both_users"],
		[`delete from commission_tier where user_id = '${TEAMMATE}'; ${CHECK_AT_COMMIT}`, "commission_split_names_both_users"],
		[`update deal set owner_user_id = '${USER}' where id = '${LENDER_DEAL}'; ${CHECK_AT_COMMIT}`, "commission_split_names_both_users"],
	],
};

for (const [rule, cases] of Object.entries(COMMISSION_REFUSALS))
	test(rule, async () => {
		for (const [sql, refusal] of cases)
			await rolledBack(() => assert.rejects(db.query(sql), expected(refusal)));
	});

test("a user's ladder names one partner", () =>
	asOwner([
		[
			`insert into party (id, kind, name) values ('${id(22)}', 'person', 'Casey Example');
			insert into app_user (id, slug) values ('${id(22)}', 'user-${id(22)}');
			insert into commission_tier values ('${USER}', 1, '${TEAMMATE}', 0.9), ('${USER}', 3, '${id(22)}', 0.7)`,
			"commission_tier_one_partner",
		],
	]));

const FIRST = id(750);
const SECOND = id(751);
const DIED = id(752);
const TEAMMATES = id(753);
const THIRD = id(754);
const CLOSED_DEALS = `
insert into phase values ('closed', 'Closed');
insert into deal (id, name, owner_user_id) values
	('${FIRST}', 'Example First Deal', '${USER}'), ('${SECOND}', 'Example Second Deal', '${USER}'),
	('${DIED}', 'Example Reopened Deal', '${USER}'), ('${TEAMMATES}', 'Example Teammate Deal', '${TEAMMATE}'),
	('${THIRD}', 'Example Third Deal', '${USER}');
insert into deal_phase_change values
	('${FIRST}', '2019-03-01T15:00:00+00:00', 'closed', null), ('${SECOND}', '2019-09-01T15:00:00+00:00', 'closed', null),
	('${DIED}', '2025-01-01T15:00:00+00:00', 'closed', null), ('${DIED}', '2025-06-01T15:00:00+00:00', 'dead', 'Example fell through'),
	('${TEAMMATES}', '2025-03-01T15:00:00+00:00', 'closed', null), ('${THIRD}', '2026-02-01T15:00:00+00:00', 'closed', null);
`;
const split = async (deal: string) =>
	(
		await db.query(
			"select kind, party_id, share::float8 as share, amount::text as amount from commission_split where deal_id = $1 order by share desc nulls last, kind",
			[deal],
		)
	).rows;

test("each user's share comes from their ladder, by their lifetime count of closed deals, after the others' shares", () =>
	rolledBack(async () => {
		await db.query(`${LADDER}; ${CLOSED_DEALS};
			insert into commission (deal_id, gross) values ('${THIRD}', 10000);
			insert into commission_share (deal_id, party_id, kind, share) values
				('${THIRD}', '${AGENT}', 'referral', 0.25), ('${THIRD}', '${BROKERAGES[0]}', 'brokerage', 0.1);
			insert into commission_payment (deal_id, amount, invoiced_on, due_on, received_on) values
				('${THIRD}', 5000, '2026-02-01', '2026-03-01', '2026-02-20'), ('${THIRD}', 5000, '2026-06-01', '2026-07-01', null);
			${CHECK_AT_COMMIT}`);
		assert.deepEqual(await split(THIRD), [
			{ kind: "closing_user", party_id: USER, share: 0.455, amount: "4550.00" },
			{ kind: "referral", party_id: AGENT, share: 0.25, amount: "2500.00" },
			{ kind: "partner", party_id: TEAMMATE, share: 0.195, amount: "1950.00" },
			{
				kind: "brokerage",
				party_id: BROKERAGES[0],
				share: 0.1,
				amount: "1000.00",
			},
		]);
	}));

test("a deal's own split overrides the ladder, and the amounts add up to the gross to the cent", () =>
	rolledBack(async () => {
		await db.query(`${LADDER}; ${CLOSED_DEALS};
			insert into commission (deal_id, gross, closing_share) values ('${THIRD}', 100.01, 0.5)`);
		assert.deepEqual(await split(THIRD), [
			{ kind: "closing_user", party_id: USER, share: 0.5, amount: "50.01" },
			{ kind: "partner", party_id: TEAMMATE, share: 0.5, amount: "50.00" },
		]);
	}));

test("an open deal carries its expected commission, and its users' shares wait for it to close", () =>
	rolledBack(async () => {
		await db.query(
			`${LADDER}; insert into commission (deal_id, expected) values ('${DEAL}', 8000)`,
		);
		assert.deepEqual(await split(DEAL), [
			{ kind: "closing_user", party_id: USER, share: null, amount: null },
			{ kind: "partner", party_id: TEAMMATE, share: null, amount: null },
		]);
	}));

test("rounding never makes an amount negative, and the amounts still add up to the gross", () =>
	rolledBack(async () => {
		await db.query(`${LADDER};
			insert into commission (deal_id, gross, closing_share) values ('${DEAL}', 0.01, 0.5);
			${share({ id: id(760), share: 0.5 })};
			${share({ id: id(761), party_id: `${BROKERAGES[0]}`, kind: "brokerage", share: 0.5 })}`);
		assert.deepEqual(
			(
				await db.query(
					"select kind, amount::text as amount from commission_split where deal_id = $1 order by amount desc, kind",
					[DEAL],
				)
			).rows,
			[
				{ kind: "referral", amount: "0.01" },
				{ kind: "brokerage", amount: "0.00" },
				{ kind: "closing_user", amount: "0.00" },
				{ kind: "partner", amount: "0.00" },
			],
		);
	}));

// Each save passes alone; together they would break the rule, so the second waits for the first.
for (const [what, first, second] of [
	[
		"payments on one gross",
		payment({ deal_id: LENDER_DEAL, amount: 600 }),
		payment({ deal_id: LENDER_DEAL, amount: 600 }),
	],
	[
		"others' shares of one commission",
		share({ deal_id: LENDER_DEAL, share: 0.6 }),
		share({ deal_id: LENDER_DEAL, share: 0.6 }),
	],
	[
		"tiers of one ladder",
		`update commission_tier set closing_share = 0.65 where user_id = '${TEAMMATE}' and from_deal = 1`,
		`update commission_tier set closing_share = 0.7 where user_id = '${TEAMMATE}' and from_deal = 3`,
	],
])
	test(`${what} are checked one save at a time`, async () => {
		const sessions = [await connect(), await connect()] as const;
		try {
			await sessions[0].query(`begin; ${first}; ${CHECK_AT_COMMIT}`);
			await sessions[1].query(
				`begin; set local lock_timeout = '100ms'; ${second}`,
			);
			await assert.rejects(sessions[1].query(CHECK_AT_COMMIT), {
				code: "55P03",
			});
		} finally {
			for (const session of sessions) {
				await session.query("rollback");
				await session.end();
			}
		}
	});

const PROPOSAL = id(900);
const newProposal = (row: Record<string, string | null> = {}) =>
	`${asJob("mail_capture", USER)}; ${insert("proposal", {
		id: PROPOSAL,
		kind: "next_step",
		activity_id: CALL,
		activity_kind: "call",
		evidence: "Example asked for an outline",
		proposed_by_job: "mail_capture",
		deal_id: DEAL,
		what: "Send an outline",
		...row,
	})}`;
const decide = (status = "accepted") =>
	`${asUser(TEAMMATE)}; update proposal set status = '${status}' where id = '${PROPOSAL}'`;

// biome-ignore format: one refusal case per row
const SHARED_PROPOSAL_REFUSALS: [string, string, Refusal][] = [
	["blank evidence", newProposal({ evidence: " " }), "proposal_evidence_check"],
	["missing source", newProposal({ activity_id: MISSING }), "proposal_activity_id_activity_kind_fkey"],
	["note source", newProposal({ activity_id: NOTE, activity_kind: "note" }), "proposal_activity_kind_check"],
	["wrong source kind", newProposal({ activity_kind: "meeting" }), "proposal_activity_id_activity_kind_fkey"],
	["missing job", newProposal({ proposed_by_job: "missing" }), "proposal_starts_pending"],
	["preaccepted", newProposal({ status: "accepted" }), "proposal_starts_pending"],
	["forged decision", newProposal({ decided_by_user_id: USER }), "proposal_starts_pending"],
	["two subjects", newProposal({ party_id: CLIENT }), "proposal_one_record"],
	["missing payload", newProposal({ what: null }), "proposal_payload"],
	["mixed payload", newProposal({ to_phase: "dead" }), "proposal_payload"],
	["missing lead stage", newProposal({ kind: "new_lead", deal_id: null, party_id: DOCTOR, what: null, how_found: "referral", }), "proposal_payload"],
	["job decision", `${newProposal()}; update proposal set status = 'accepted'`, "proposal_user_decides"],
	["agent decision", `${newProposal()}; ${asJob("agent", USER)}; update proposal set status = 'dismissed'`, "proposal_user_decides"],
	["blank dismiss reason", `${newProposal()}; ${asUser(USER)}; update proposal set status = 'dismissed', dismiss_reason = ' '`, "proposal_dismiss_reason_check"],
	["nonbreaking-space dismiss reason", `${newProposal()}; ${asUser(USER)}; update proposal set status = 'dismissed', dismiss_reason = chr(160)`, "proposal_dismiss_reason_check"],
	["dismiss reason on acceptance", `${newProposal()}; ${asUser(TEAMMATE)}; update proposal set status = 'accepted', dismiss_reason = 'Not needed'`, "proposal_dismiss_reason"],
	["repeat decision", `${newProposal()}; ${decide()}; ${decide()}`, "proposal_final"],
	["rewrite", `${newProposal()}; update proposal set evidence = 'replacement'`, notGranted("proposal")],
	["erase", `${newProposal()}; delete from proposal`, notGranted("proposal")],
	["truncate", "truncate proposal", notGranted("proposal")],
];
for (const [label, sql, refusal] of SHARED_PROPOSAL_REFUSALS) {
	test(`shared proposals refuse ${label}`, () =>
		rolledBack(async () => {
			await assert.rejects(db.query(sql), expected(refusal));
		}));
}

const REPLY = id(950);
const newReply = (row: Record<string, string> = {}) =>
	`${asJob("mail_capture")}; ${insert("reply_draft", {
		id: REPLY,
		email_activity_id: EMAIL,
		owner_user_id: USER,
		proposed_by_job: "mail_capture",
		evidence: "Example asks when we can talk",
		subject: "Re: Counter to your LOI",
		body: "Thanks, we will review the counter.",
		...row,
	})}`;
const reply = (who: string, change: string, draft = REPLY) =>
	`${who}; update reply_draft set ${change} where id = '${draft}'`;
const OWNER = asUser(USER);
const OWNERS_MAILBOX = asJob("mail_capture", USER);
const APPROVE =
	"status = 'approved', to_address = 'avery@example.com', cc_address = 'riley@example.com'";
const SEND =
	"status = 'sent', sent_at = now(), sent_item_id = 'example-sent-1'";
// Today's sender's reasons: an abort before Send, a Send it could not confirm, and one that settles nothing.
const ABORTED = "aborted_before_dispatch";
const UNCONFIRMED = "unconfirmed_after_3";
const FAIL = (reason: string) =>
	`status = 'failed', failure_reason = '${reason}'`;
const CLEAR_FAILURE = "failure_reason = null";
const ATTACHMENT = id(953);
const attach = (who: string) =>
	`${OWNER}; ${insert("document", { id: ATTACHMENT, name: "Example plan.pdf", r2_key: "example/reply-attachment" })};
	${who}; ${insert("reply_draft_document", { reply_draft_id: REPLY, document_id: ATTACHMENT })}`;
const approved = `${newReply()}; ${reply(OWNER, APPROVE)}`;
const SECOND_REPLY = `${newEmail(id(952))}; insert into activity_about (activity_id, deal_id) values ('${id(952)}', '${DEAL}');
	${newReply({ id: id(951), email_activity_id: id(952) })}`;

// biome-ignore format: one refusal case per row
const REPLY_DRAFT_REFUSALS: [string, string, Refusal][] = [
	["a user drafting", `${OWNER}; ${insert("reply_draft", { email_activity_id: EMAIL, owner_user_id: USER, proposed_by_job: "mail_capture", evidence: "Example", subject: "Re: Example", body: "Example" })}`, "reply_draft_starts_pending"],
	["a draft that starts approved", newReply({ status: "approved", to_address: "avery@example.com", cc_address: "riley@example.com" }), "reply_draft_starts_pending"],
	["a blank body", newReply({ body: " " }), "reply_draft_body_check"],
	["a second draft of one reply", `${newReply()}; ${newReply({ id: id(951) })}`, "reply_draft_email_activity_id_owner_user_id_key"],
	["another user's edit", `${newReply()}; ${reply(asUser(TEAMMATE), "body = 'Example'")}`, "reply_draft_owner_edits"],
	["an edit after approval", `${approved}; ${reply(OWNER, "body = 'Example'")}`, "reply_draft_owner_edits"],
	["approving an approved draft again", `${approved}; ${reply(OWNER, APPROVE)}`, "reply_draft_sent_once"],
	["another user's approval", `${newReply()}; ${reply(asUser(TEAMMATE), APPROVE)}`, "reply_draft_owner_decides"],
	["an agent's approval", `${newReply()}; ${reply(asJob("agent", USER), APPROVE)}`, "reply_draft_owner_decides"],
	["an approval without its recipients", `${newReply()}; ${reply(OWNER, "status = 'approved'")}`, "reply_draft_delivery_facts"],
	["a dismissal without a reason", `${newReply()}; ${reply(OWNER, "status = 'dismissed'")}`, "reply_draft_delivery_facts"],
	["a send before approval", `${newReply()}; ${reply(OWNERS_MAILBOX, SEND)}`, "reply_draft_sent_once"],
	["a user recording a send", `${approved}; ${reply(OWNER, SEND)}`, "reply_draft_sent_once"],
	["another user's mailbox recording a send", `${approved}; ${reply(asJob("mail_capture", TEAMMATE), SEND)}`, "reply_draft_owner_decides"],
	["a second send", `${approved}; ${reply(OWNERS_MAILBOX, SEND)}; ${reply(OWNERS_MAILBOX, "sent_item_id = 'example-sent-2'")}`, "reply_draft_sent_once"],
	["approving a sent draft again", `${approved}; ${reply(OWNERS_MAILBOX, SEND)}; ${reply(OWNER, "status = 'approved', sent_at = null, sent_item_id = null")}`, "reply_draft_sent_once"],
	...[UNCONFIRMED, "invalid_submission", "failed:abort_cleanup_failed"].map((reason): [string, string, Refusal] =>
		[`approving again after ${reason}`, `${approved}; ${reply(OWNERS_MAILBOX, FAIL(reason))}; ${reply(OWNER, `status = 'approved', ${CLEAR_FAILURE}`)}`, "reply_draft_sent_once"]),
	...[ABORTED, "submission_recipients_invalid", "invalid_submission", "failed:abort_cleanup_failed"].map((reason): [string, string, Refusal] =>
		[`a send recorded after ${reason}`, `${approved}; ${reply(OWNERS_MAILBOX, FAIL(reason))}; ${reply(OWNERS_MAILBOX, `${SEND}, ${CLEAR_FAILURE}`)}`, "reply_draft_sent_once"]),
	["a send that changes the recipient", `${approved}; ${reply(OWNERS_MAILBOX, `${SEND}, to_address = 'other@example.com'`)}`, "reply_draft_sent_once"],
	["a failure that changes the copy", `${approved}; ${reply(OWNERS_MAILBOX, `${FAIL(ABORTED)}, cc_address = 'other@example.com'`)}`, "reply_draft_sent_once"],
	["a job's attachment", `${newReply()}; ${attach(OWNERS_MAILBOX)}`, "reply_draft_owner_edits"],
	["an attachment after approval", `${approved}; ${attach(OWNER)}`, "reply_draft_owner_edits"],
	["approving a dismissed draft", `${newReply()}; ${reply(OWNER, "status = 'dismissed', dismiss_reason = 'Example'")}; ${reply(OWNER, `${APPROVE}, dismiss_reason = null`)}`, "reply_draft_sent_once"],
	["one sent message settling two drafts", `${approved}; ${reply(OWNERS_MAILBOX, SEND)}; ${SECOND_REPLY}; ${reply(OWNER, APPROVE, id(951))}; ${reply(OWNERS_MAILBOX, SEND, id(951))}`, "reply_draft_sent_item_id_key"],
	["erase", `${newReply()}; delete from reply_draft`, notGranted("reply_draft")],
];
for (const [label, sql, refusal] of REPLY_DRAFT_REFUSALS) {
	test(`reply drafts refuse ${label}`, () =>
		rolledBack(async () => {
			await assert.rejects(db.query(sql), expected(refusal));
		}));
}

const dropReply = (mark: Record<string, string | null> = {}) =>
	`${OWNER}; ${newMark({ next_step_id: null, reply_draft_id: REPLY, disposition: "dropped", snoozed_until: null, drop_reason: "Answered by phone", ...mark })}`;
const failedForGood = `${approved}; ${reply(OWNERS_MAILBOX, FAIL("invalid_submission"))}`;
// biome-ignore format: one refusal case per row
const REPLY_DROP_REFUSALS: [string, string, Refusal][] = [
	["a pending draft", `${newReply()}; ${dropReply()}`, "home_mark_drops_failed_reply"],
	["an approved draft", `${approved}; ${dropReply()}`, "home_mark_drops_failed_reply"],
	...[ABORTED, "submission_recipients_invalid", UNCONFIRMED].map((reason): [string, string, Refusal] =>
		[`a draft that failed with ${reason}`, `${approved}; ${reply(OWNERS_MAILBOX, FAIL(reason))}; ${dropReply()}`, "home_mark_drops_failed_reply"]),
	["a snooze turned into a drop on a pending draft",
		`${newReply()}; ${dropReply({ disposition: "snoozed", snoozed_until: "2099-01-01T00:00:00Z", drop_reason: null })};
		update home_mark set disposition = 'dropped', snoozed_until = null, drop_reason = 'Example' where reply_draft_id = '${REPLY}'`,
		"home_mark_drops_failed_reply"],
	["another user's drop", `${failedForGood}; ${dropReply({ user_id: TEAMMATE })}`, "home_mark_reply_draft_id_user_id_fkey"],
];
for (const [label, sql, refusal] of REPLY_DROP_REFUSALS) {
	test(`Home marks refuse dropping ${label}`, () =>
		rolledBack(async () => {
			await assert.rejects(db.query(sql), expected(refusal));
		}));
}

test("the owner drops a reply that failed for good from Home, and the draft stays failed", () =>
	rolledBack(async () => {
		await db.query(`${failedForGood}; ${dropReply()}`);
		const { rows } = await db.query(
			`select m.drop_reason, r.status, r.failure_reason from home_mark m
				join reply_draft r on r.id = m.reply_draft_id`,
		);
		assert.deepEqual(rows, [
			{
				drop_reason: "Answered by phone",
				status: "failed",
				failure_reason: "invalid_submission",
			},
		]);
	}));

test("a reply draft goes out once: the owner edits and approves it, and the owner's mailbox records each try", () =>
	rolledBack(async () => {
		await db.query(
			`${newReply()}; ${newReply({ id: id(954), body: "Example second store" })} on conflict (email_activity_id, owner_user_id) do nothing;
			${reply(OWNER, "body = 'Thanks, Tuesday works.'")}; ${attach(OWNER)}; ${reply(OWNER, APPROVE)};
			${reply(OWNERS_MAILBOX, FAIL(ABORTED))}; ${reply(OWNER, `${APPROVE}, ${CLEAR_FAILURE}, body = 'Thanks, Wednesday works.'`)};
			${reply(OWNERS_MAILBOX, SEND)}; ${SECOND_REPLY}; ${reply(OWNER, APPROVE, id(951))}; ${reply(OWNERS_MAILBOX, FAIL(UNCONFIRMED), id(951))};
			${reply(OWNERS_MAILBOX, `status = 'sent', sent_at = now(), sent_item_id = 'example-sent-2', ${CLEAR_FAILURE}`, id(951))}`,
		);
		const { rows } = await db.query({
			text: `select id, body, revision, status, decided_at is not null, to_address, sent_item_id from reply_draft order by id`,
			rowMode: "array",
		});
		// biome-ignore format: one draft per row
		assert.deepEqual(rows, [
			[REPLY, "Thanks, Wednesday works.", 4, "sent", true, "avery@example.com", "example-sent-1"],
			[id(951), "Thanks, we will review the counter.", 2, "sent", true, "avery@example.com", "example-sent-2"],
		]);
		const { rows: attached } = await db.query(
			"select reply_draft_id, document_id from reply_draft_document",
		);
		assert.deepEqual(attached, [
			{ reply_draft_id: REPLY, document_id: ATTACHMENT },
		]);
		const { rows: history } = await db.query({
			text: `select new_value ->> 'status', changed_by_user_id, changed_by_job, changed_for_user_id
				from change where table_name = 'reply_draft' and record ->> 'id' = '${REPLY}' order by id`,
			rowMode: "array",
		});
		// biome-ignore format: one change per row
		assert.deepEqual(history, [
			["pending", null, "mail_capture", null], [null, USER, null, null], ["approved", USER, null, null],
			["failed", null, "mail_capture", USER], ["approved", USER, null, null], ["sent", null, "mail_capture", USER],
		]);
	}));

test("acceptance creates one next step and keeps both actors, dismissal creates nothing", () =>
	rolledBack(async () => {
		await db.query(newProposal());
		const { rows: pendingSteps } = await db.query(
			`select count(*) from next_step where id = '${PROPOSAL}'`,
		);
		assert.equal(pendingSteps[0].count, "0");
		await db.query(decide());
		const { rows: acceptedSteps } = await db.query(
			`select what, changed_by_user_id from next_step where id = '${PROPOSAL}'`,
		);
		assert.deepEqual(acceptedSteps, [
			{ what: "Send an outline", changed_by_user_id: TEAMMATE },
		]);
		const { rows: decisions } = await db.query(
			`select status, proposed_by_job, decided_by_user_id, decided_at is not null as dated from proposal`,
		);
		assert.deepEqual(decisions, [
			{
				status: "accepted",
				proposed_by_job: "mail_capture",
				decided_by_user_id: TEAMMATE,
				dated: true,
			},
		]);
		const { rows: history } = await db.query(
			`select action, changed_by_job, changed_by_user_id from change where table_name = 'proposal' order by id`,
		);
		assert.deepEqual(history, [
			{
				action: "insert",
				changed_by_job: "mail_capture",
				changed_by_user_id: null,
			},
			{
				action: "update",
				changed_by_job: null,
				changed_by_user_id: TEAMMATE,
			},
		]);
		await db.query(newProposal({ id: id(901), what: "Send another outline" }));
		await db.query(
			`${asUser(USER)}; update proposal set status = 'dismissed' where id = '${id(901)}'`,
		);
		assert.equal(
			(await db.query(`select count(*) from next_step where id = '${id(901)}'`))
				.rows[0].count,
			"0",
		);
	}));

test("phase and new lead suggestions create their real rows only on acceptance", () =>
	rolledBack(async () => {
		await db.query(
			newProposal({
				kind: "phase_move",
				what: null,
				from_phase: "legal",
				to_phase: "dead",
				reason: "Example withdrew",
			}),
		);
		await db.query(decide());
		await db.query(
			`insert into party (id, kind, name) values ('${id(904)}', 'person', 'Example Suggested Lead');
			insert into activity_about (activity_id, party_id) values ('${CALL}', '${id(904)}')`,
		);
		const { rows: phases } = await db.query(
			`select phase from deal_phase_change where deal_id = '${DEAL}' order by happened_at desc limit 1`,
		);
		assert.equal(phases[0].phase, "dead");
		await db.query(
			newProposal({
				id: id(902),
				kind: "new_lead",
				what: null,
				deal_id: null,
				party_id: id(904),
				to_stage: "new",
				how_found: "referral",
			}),
		);
		const { rows: pendingLeads } = await db.query(
			`select count(*) from party_role where party_id = '${id(904)}' and role = 'lead'`,
		);
		assert.equal(pendingLeads[0].count, "0");
		await db.query(
			`${asUser(USER)}; update proposal set status = 'accepted' where id = '${id(902)}'; ${CHECK_AT_COMMIT}`,
		);
		const { rows: acceptedLeads } = await db.query(
			`select stage from party_role where party_id = '${id(904)}' and role = 'lead'`,
		);
		assert.equal(acceptedLeads[0].stage, "new");
	}));

for (const stale of [false, true]) {
	test(
		stale
			? "a stale lead suggestion cannot overwrite a correction"
			: "a user accepts weak lead evidence through the shared queue",
		() =>
			rolledBack(async () => {
				await db.query(
					newProposal({
						kind: "lead_stage_move",
						strength: "weak",
						what: null,
						deal_id: null,
						party_id: LEAD,
						from_stage: "nurture",
						to_stage: "opportunity",
					}),
				);
				const { rows: beforeMove } = await db.query(
					`select stage from party_role where party_id = '${LEAD}'`,
				);
				assert.equal(beforeMove[0].stage, "nurture");
				if (stale) {
					await db.query(
						`${asUser(USER)}; update party_role set stage = 'engaged' where party_id = '${LEAD}'`,
					);
					await assert.rejects(
						db.query(decide()),
						expected("lead_stage_move_current_stage"),
					);
				} else {
					await db.query(decide());
					const { rows: afterMove } = await db.query(
						`select stage from party_role where party_id = '${LEAD}'`,
					);
					assert.equal(afterMove[0].stage, "opportunity");
					assert.equal(
						(await db.query(`select id from lead_stage_move`)).rows[0].id,
						PROPOSAL,
					);
				}
			}),
	);
}

test("a stale phase suggestion cannot overwrite another phase", () =>
	rolledBack(async () => {
		await db.query(
			newProposal({
				kind: "phase_move",
				what: null,
				from_phase: "negotiation",
				to_phase: "dead",
				reason: "Example withdrew",
			}),
		);
		await assert.rejects(
			db.query(decide()),
			expected("proposal_current_phase"),
		);
	}));

const stageProposal = (row: Record<string, string | null> = {}) =>
	newProposal({
		kind: "lead_stage_move",
		what: null,
		deal_id: null,
		party_id: LEAD,
		from_stage: "nurture",
		to_stage: "opportunity",
		strength: "weak",
		...row,
	});

// biome-ignore format: one refusal case per row
const PROPOSAL_REFUSALS: [string, string, Refusal][] = [
	["duplicate source and payload", `${newProposal()}; ${newProposal({id: id(901)})}`, "proposal_source_payload_once"],
	["duplicate stage suggestion", `${stageProposal()}; ${stageProposal({id: id(901)})}`, "proposal_source_payload_once"],
	["unrelated party source", `${stageProposal({activity_id: EMAIL, activity_kind: "email"})}; ${CHECK_AT_COMMIT}`, "proposal_activity_id_party_id_fkey"],
	["unlinked pending source", `${stageProposal()}; delete from activity_about where activity_id = '${CALL}' and party_id = '${LEAD}'; ${CHECK_AT_COMMIT}`, "proposal_activity_id_party_id_fkey"],
	["discarded next-step reason", newProposal({reason: "Example reason"}), "proposal_payload"],
	["discarded new-lead reason", newProposal({kind: "new_lead", deal_id: null, party_id: LEAD, what: null, to_stage: "new", how_found: "referral", reason: "Example reason"}), "proposal_payload"],
	["missing stage strength", stageProposal({strength: null}), "proposal_payload"],
	["unknown stage strength", stageProposal({strength: "unknown"}), "proposal_strength_check"],
];
for (const [label, sql, refusal] of PROPOSAL_REFUSALS) {
	test(`shared proposals refuse ${label}`, () =>
		rolledBack(async () => {
			await assert.rejects(db.query(sql), expected(refusal));
		}));
}

test("an accepted archive preserves strong evidence", () =>
	rolledBack(async () => {
		await db.query(
			stageProposal({
				to_stage: "archived",
				strength: "strong",
				reason: "Example retired",
			}),
		);
		await db.query(`${decide()}; ${CHECK_AT_COMMIT}`);
		const { rows: pendingSteps0 } = await db.query(
			`select strength from lead_stage_move where id = '${PROPOSAL}'`,
		);
		assert.equal(pendingSteps0[0].strength, "strong");
	}));

test("competing phase acceptances hold the deal until the first decision completes", async () => {
	const first = await connect(),
		second = await connect();
	try {
		await first.query(
			`begin; ${newProposal({ kind: "phase_move", what: null, from_phase: "legal", to_phase: "dead", reason: "Example withdrew" })}; ${decide()}`,
		);
		await second.query("begin; set local lock_timeout = '100ms'");
		await assert.rejects(
			second.query(
				`${newProposal({ id: id(901), kind: "phase_move", what: null, from_phase: "legal", to_phase: "negotiation" })}; ${asUser(USER)}; update proposal set status = 'accepted' where id = '${id(901)}'`,
			),
			{ code: "55P03" },
		);
	} finally {
		for (const connection of [first, second]) {
			await connection.query("rollback");
			await connection.end();
		}
	}
});

test("a merge collapses matching suggestions, clears their removed mark and keeps proposal history", () =>
	rolledBack(async () => {
		await db.query(`insert into party (id, kind, name) values ('${id(905)}', 'person', 'Example Suggested Duplicate');
		insert into activity_about (activity_id, party_id) values ('${CALL}', '${id(905)}');
		${stageProposal()}; ${stageProposal({ id: id(901), party_id: id(905) })};
		${asUser(USER)};
		insert into home_mark (user_id, proposal_id, disposition, snoozed_until) values ('${USER}', '${id(901)}', 'snoozed', '2026-03-21T14:00:00+00:00');
		select merge_party('${id(905)}', '${LEAD}'); ${CHECK_AT_COMMIT}`);
		assert.equal(
			(
				await db.query("select from home_mark where proposal_id = $1", [
					id(901),
				])
			).rowCount,
			0,
		);
		assert.equal(
			(await db.query("select count(*) from proposal")).rows[0].count,
			"1",
		);
		const { rows: pendingSteps1 } = await db.query(
			"select count(*) from change where table_name = 'proposal' and action = 'delete'",
		);
		assert.equal(pendingSteps1[0].count, "1");
	}));

const DEAL_FILE = id(8000);
const dealFile = (row: Record<string, string | number | null> = {}) =>
	insert("document", {
		id: DEAL_FILE,
		name: "Example lease.pdf",
		r2_key: "example/deal-file-v1",
		content_type: "application/pdf",
		deal_id: DEAL,
		kind: "lease",
		sha256: "a".repeat(64),
		bytes: 1024,
		...row,
	});
const extraction = (row: Record<string, string | number | null> = {}) =>
	insert("document_extraction", {
		document_id: DEAL_FILE,
		deal_id: DEAL,
		extracted_at: "2026-04-01T12:00:00Z",
		method: "text_layer",
		extractor_version: "example.v1",
		text_format_version: "page-text.v1",
		status: "produced",
		pages: '{"Example first page","Example second page"}',
		receipt: '{"canonical":false}',
		...row,
	});

test("a user classifies an other deal file once and history records who and when", () =>
	rolledBack(async () => {
		await db.query(
			`${asJob("old_system")}; ${dealFile({ kind: "other" })}; ${extraction()}`,
		);
		const before = (
			await db.query(`select * from document where id = '${DEAL_FILE}'`)
		).rows[0];
		await db.query(
			`${asUser(TEAMMATE)}; update document set kind = 'lease' where id = '${DEAL_FILE}'`,
		);
		const after = (
			await db.query(`select * from document where id = '${DEAL_FILE}'`)
		).rows[0];
		assert.deepEqual(unstamped(after), { ...unstamped(before), kind: "lease" });
		assert.equal(after.created_at.getTime(), before.created_at.getTime());
		assert.equal(after.changed_by_user_id, TEAMMATE);
		assert.equal(after.changed_by_job, null);
		assert.equal(after.changed_for_user_id, null);
		const { rows } =
			await db.query(`select old_value, new_value, changed_by_user_id,
			changed_by_job, changed_at = now() as at_save
			from change where table_name = 'document' and record = jsonb_build_object('id', '${DEAL_FILE}'::text) and action = 'update'`);
		assert.deepEqual(rows, [
			{
				old_value: { kind: "other" },
				new_value: { kind: "lease" },
				changed_by_user_id: TEAMMATE,
				changed_by_job: null,
				at_save: true,
			},
		]);
		assert.equal(
			(await db.query("select count(*) from document_extraction")).rows[0]
				.count,
			"1",
		);
		await assert.rejects(
			db.query(`update document set kind = 'loi' where id = '${DEAL_FILE}'`),
			{ constraint: "document_filed_once" },
		);
	}));

for (const forUser of ["", USER]) {
	test(`a job cannot classify a deal file${forUser ? " even for a user" : ""}`, () =>
		rolledBack(async () => {
			await db.query(
				`${dealFile({ kind: "other" })}; ${asJob("agent", forUser)}`,
			);
			await assert.rejects(
				db.query(
					`update document set kind = 'lease' where id = '${DEAL_FILE}'`,
				),
				{ constraint: "document_filed_once" },
			);
		}));
}

test("an unchanged other kind writes no history and still permits classification", () =>
	rolledBack(async () => {
		await db.query(
			`${dealFile({ kind: "other" })}; update document set kind = 'other' where id = '${DEAL_FILE}'`,
		);
		assert.equal(
			(
				await db.query(
					"select count(*) from change where table_name = 'document' and action = 'update'",
				)
			).rows[0].count,
			"0",
		);
		await db.query(
			`update document set kind = 'lease' where id = '${DEAL_FILE}'; update document set name = 'Example renamed.pdf' where id = '${DEAL_FILE}'`,
		);
		assert.equal(
			(await db.query(`select name from document where id = '${DEAL_FILE}'`))
				.rows[0].name,
			"Example renamed.pdf",
		);
	}));

for (const kind of ["loi", "other"]) {
	test(`a real deal file kind never changes to ${kind}`, () =>
		rolledBack(async () => {
			await db.query(dealFile());
			await assert.rejects(
				db.query(
					`update document set kind = '${kind}' where id = '${DEAL_FILE}'`,
				),
				{ constraint: "document_filed_once" },
			);
		}));
}

// biome-ignore format: one refusal per row
for (const [field, value, code] of [
	["name", "'Changed example.pdf'", "23514"],
	["deal_id", `'${LENDER_DEAL}'`, "23514"],
	["content_type", "'text/plain'", "23514"],
	["sha256", `'${"b".repeat(64)}'`, "23514"],
	["bytes", "2048", "23514"],
	["id", `'${id(8002)}'`, "42501"],
	["created_at", "now() - interval '1 day'", "42501"],
	["r2_key", "'example/changed'", "42501"],
	["r2_bucket", "'deal_documents'", "42501"],
	["version", "2", "42501"],
	["supersedes_id", `'${id(8001)}'`, "42501"],
]) {
	test(`classification keeps the deal file's ${field} fixed`, () =>
		rolledBack(async () => {
			await db.query(dealFile({ kind: "other" }));
			await assert.rejects(
				db.query(`update document set kind = 'lease', ${field} = ${value} where id = '${DEAL_FILE}'`),
				{ code, ...(code === "23514" ? { constraint: "document_filed_once" } : {}) },
			);
		}));
}

for (const kind of ["null", "'missing'", "''"]) {
	test(`classification refuses kind ${kind}`, () =>
		rolledBack(async () => {
			await db.query(dealFile({ kind: "other" }));
			await assert.rejects(
				db.query(
					`update document set kind = ${kind} where id = '${DEAL_FILE}'`,
				),
				{
					constraint:
						kind === "null" ? "document_filed_once" : "document_kind_fkey",
				},
			);
		}));
}

for (const version of [1, 2]) {
	test(`an other chain refuses classification of version ${version} alone`, () =>
		rolledBack(async () => {
			await db.query(`${dealFile({ kind: "other" })};
				${dealFile({ id: id(8001), r2_key: "example/v2", kind: "other", version: 2, supersedes_id: DEAL_FILE })}`);
			await assert.rejects(
				db.query(
					`update document set kind = 'lease' where deal_id = '${DEAL}' and version = ${version}`,
				),
				{ constraint: "document_previous_version" },
			);
		}));
}

test("a user classifies every version of an other chain in one update", () =>
	rolledBack(async () => {
		await db.query(`${dealFile({ kind: "other" })};
			${dealFile({ id: id(8001), r2_key: "example/v2", kind: "other", version: 2, supersedes_id: DEAL_FILE })}`);
		await db.query(
			`${asUser(TEAMMATE)}; update document set kind = 'lease' where deal_id = '${DEAL}'`,
		);
		assert.deepEqual(
			(
				await db.query(
					`select version, kind from document where deal_id = '${DEAL}' order by version`,
				)
			).rows,
			[
				{ version: 1, kind: "lease" },
				{ version: 2, kind: "lease" },
			],
		);
		const { rows } =
			await db.query(`select record, old_value, new_value, changed_by_user_id, changed_at = now() as at_save
			from change where table_name = 'document' and action = 'update' order by record ->> 'id'`);
		assert.deepEqual(
			rows,
			[DEAL_FILE, id(8001)].map((id) => ({
				record: { id },
				old_value: { kind: "other" },
				new_value: { kind: "lease" },
				changed_by_user_id: TEAMMATE,
				at_save: true,
			})),
		);
	}));

// biome-ignore format: one row per refusal
const FILE_REFUSALS = [
	["unfiled kind", dealFile({ deal_id: null }), "document_deal_file_whole"],
	[ "unfiled successor", dealFile({ deal_id: null, kind: null, version: 2, supersedes_id: id(200) }), "document_deal_file_whole", ],
	[ "receipt-only pages", `${dealFile()}; ${extraction({ status: "receipt_only", pages: '{" "}' })}`, "document_extraction_status_matches_text", ],
	[ "multidimensional pages", `${dealFile()}; ${extraction({ pages: '{{"Example"}}' })}`, "document_extraction_pages", ],
	["missing deal", dealFile({ deal_id: MISSING }), "document_deal_id_fkey"],
	["missing kind", dealFile({ kind: null }), "document_deal_file_whole"],
	["blank kind", dealFile({ kind: " " }), "document_kind_fkey"],
	["missing hash", dealFile({ sha256: null }), "document_deal_file_whole"],
	["invalid hash", dealFile({ sha256: "invalid" }), "document_sha256_check"],
	["missing size", dealFile({ bytes: null }), "document_deal_file_whole"],
	["empty file", dealFile({ bytes: 0 }), "document_bytes_check"],
	[ "missing type", dealFile({ content_type: null }), "document_deal_file_whole", ],
	["blank type", dealFile({ content_type: " " }), "document_deal_file_whole"],
	["blank key", dealFile({ r2_key: " " }), "document_r2_key_check"],
	["blank note", dealFile({ note: " " }), "document_note_check"],
	["zero version", dealFile({ version: 0 }), "document_version_check"],
	[ "missing predecessor", dealFile({ version: 2 }), "document_version_has_predecessor", ],
	[ "orphan predecessor", dealFile({ version: 2, supersedes_id: MISSING }), "document_previous_version", ],
	[ "skipped version", `${dealFile()}; ${dealFile({ id: id(8001), r2_key: "example/v3", version: 3, supersedes_id: DEAL_FILE })}`, "document_previous_version", ],
	[ "other deal predecessor", `${dealFile()}; ${dealFile({ id: id(8001), r2_key: "example/v2", version: 2, supersedes_id: DEAL_FILE, deal_id: LENDER_DEAL })}`, "document_previous_version", ],
	[ "other kind predecessor", `${dealFile()}; ${dealFile({ id: id(8001), r2_key: "example/v2", version: 2, supersedes_id: DEAL_FILE, kind: "loi" })}`, "document_previous_version", ],
	[ "reused key", `${dealFile()}; ${dealFile({ id: id(8001) })}`, "document_r2_bucket_r2_key_key", ],
	[ "unattached extraction", extraction(), "document_extraction_document_id_deal_id_fkey", ],
	[ "other deal extraction", `${dealFile()}; ${extraction({ deal_id: LENDER_DEAL })}`, "document_extraction_document_id_deal_id_fkey", ],
	[ "blank method", `${dealFile()}; ${extraction({ method: " " })}`, "document_extraction_method_check", ],
	[ "blank extractor", `${dealFile()}; ${extraction({ extractor_version: " " })}`, "document_extraction_extractor_version_check", ],
	[ "blank model", `${dealFile()}; ${extraction({ model: " " })}`, "document_extraction_model_check", ],
	[ "blank text format", `${dealFile()}; ${extraction({ text_format_version: " " })}`, "document_extraction_text_format_version_check", ],
	[ "unknown status", `${dealFile()}; ${extraction({ status: "waiting" })}`, "document_extraction_status_check", ],
	[ "produced without text", `${dealFile()}; ${extraction({ pages: "{}" })}`, "document_extraction_status_matches_text", ],
	[ "no text with text", `${dealFile()}; ${extraction({ status: "no_text" })}`, "document_extraction_status_matches_text", ],
	[ "unavailable with pages", `${dealFile()}; ${extraction({ status: "unavailable", pages: '{" "}' })}`, "document_extraction_status_matches_text", ],
	[ "null page", `${dealFile()}; ${extraction({ pages: "{NULL}" })}`, "document_extraction_pages", ],
	[ "invalid receipt", `${dealFile()}; ${extraction({ receipt: "[]" })}`, "document_extraction_receipt_check", ],
] satisfies [string, string, string][];
for (const [label, sql, refusal] of FILE_REFUSALS) {
	test(`deal files refuse ${label}`, () =>
		rolledBack(() => assert.rejects(db.query(sql), { constraint: refusal })));
}

const CLIENT_FILE = id(8100);
const SECOND_CLIENT_FILE = id(8101);
const FILE_DUPLICATE = id(8102);
const clientFile = (row: Record<string, string | number | null> = {}) =>
	insert("document", {
		id: CLIENT_FILE,
		name: "Example tour book.pdf",
		r2_bucket: "deal_documents",
		r2_key: "example/client-file",
		content_type: "application/pdf",
		sha256: "b".repeat(64),
		bytes: 2048,
		...row,
	});
const partyFile = (row: Record<string, string> = {}) =>
	insert("party_document", {
		party_id: CLIENT,
		document_id: CLIENT_FILE,
		...row,
	});
const partyFiles = async () =>
	(
		await db.query(
			"select party_id, document_id from party_document order by document_id, party_id",
		)
	).rows.map((r) => [r.party_id, r.document_id]);

// biome-ignore format: one row per refusal
const PARTY_FILE_REFUSALS = [
	["a missing party", `${clientFile()}; ${partyFile({ party_id: MISSING })}`, "party_document_party_id_fkey"],
	["a missing file", partyFile(), "party_document_stored"],
	["a file without its type", `${clientFile({ content_type: null })}; ${partyFile()}`, "party_document_stored"],
	["a file with a blank type", `${clientFile({ content_type: " " })}; ${partyFile()}`, "party_document_stored"],
	["a file without its hash", `${clientFile({ sha256: null })}; ${partyFile()}`, "party_document_stored"],
	["a file without its size", `${clientFile({ bytes: null })}; ${partyFile()}`, "party_document_stored"],
	["the same link twice", `${clientFile()}; ${partyFile()}; ${partyFile()}`, "party_document_pkey"],
] satisfies [string, string, string][];
for (const [label, sql, refusal] of PARTY_FILE_REFUSALS) {
	test(`party files refuse ${label}`, () =>
		rolledBack(() => assert.rejects(db.query(sql), { constraint: refusal })));
}

test("one stored file belongs to a client, another party and the client's deal at once", () =>
	rolledBack(async () => {
		await db.query(`${clientFile()}; ${partyFile()}; ${partyFile({ party_id: AGENT })};
			update document set deal_id = '${DEAL}', kind = 'other' where id = '${CLIENT_FILE}'`);
		assert.deepEqual(
			(
				await db.query("select id, deal_id from document where sha256 = $1", [
					"b".repeat(64),
				])
			).rows,
			[{ id: CLIENT_FILE, deal_id: DEAL }],
		);
		assert.deepEqual(await partyFiles(), [
			[CLIENT, CLIENT_FILE],
			[AGENT, CLIENT_FILE],
		]);
	}));

test("removing a mistaken party link keeps its file, and history keeps who linked and removed it", () =>
	rolledBack(async () => {
		await db.query(`${clientFile()}; ${partyFile()};
			${asUser(TEAMMATE)}; delete from party_document where party_id = '${CLIENT}'`);
		assert.deepEqual(await partyFiles(), []);
		assert.equal(
			(
				await db.query("select count(*) from document where id = $1", [
					CLIENT_FILE,
				])
			).rows[0].count,
			"1",
		);
		assert.deepEqual(
			(
				await db.query(
					"select action, changed_by_user_id from change where table_name = 'party_document' order by id",
				)
			).rows,
			[
				{ action: "insert", changed_by_user_id: USER },
				{ action: "delete", changed_by_user_id: TEAMMATE },
			],
		);
	}));

test("a merge keeps the survivor's link to a file both hold and moves the duplicate's other files", () =>
	rolledBack(async () => {
		await db.query(`insert into party (id, kind, name) values ('${FILE_DUPLICATE}', 'person', 'Example Duplicate');
			${clientFile()}; ${clientFile({ id: SECOND_CLIENT_FILE, r2_key: "example/client-file-2" })};
			${partyFile({ party_id: AGENT })}; ${partyFile({ party_id: FILE_DUPLICATE })};
			${partyFile({ party_id: FILE_DUPLICATE, document_id: SECOND_CLIENT_FILE })};
			select merge_party('${FILE_DUPLICATE}', '${AGENT}')`);
		assert.deepEqual(await partyFiles(), [
			[AGENT, CLIENT_FILE],
			[AGENT, SECOND_CLIENT_FILE],
		]);
		assert.deepEqual(
			(
				await db.query(
					`select action, record from change
					where table_name = 'party_document' and merge_of = $1 order by id`,
					[FILE_DUPLICATE],
				)
			).rows,
			[
				{
					action: "delete",
					record: { party_id: FILE_DUPLICATE, document_id: CLIENT_FILE },
				},
				{
					action: "update",
					record: { party_id: FILE_DUPLICATE, document_id: SECOND_CLIENT_FILE },
				},
			],
		);
	}));

test("deal file versions retain their bytes, ordered text and extraction evidence", () =>
	rolledBack(async () => {
		await db.query(`${dealFile()}; ${extraction()};
			${dealFile({ id: id(8001), r2_key: "example/deal-file-v2", version: 2, supersedes_id: DEAL_FILE })};
			${extraction({ document_id: id(8001), status: "no_text", pages: "{}" })};
			${extraction({ method: "ocr", model: "example-model", status: "unavailable", pages: "{}" })}`);
		const { rows } = await db.query(
			`select d.version, d.r2_key, d.sha256, d.bytes, e.pages, e.status,
			e.extracted_at::text, e.method, e.extractor_version, e.receipt, e.changed_by_user_id
			from document d join document_extraction e on e.document_id = d.id
			where d.deal_id = $1 order by d.version, e.method desc`,
			[DEAL],
		);
		assert.equal(rows.length, 3);
		assert.deepEqual(
			rows.map((r) => [r.version, r.status, r.pages]),
			[
				[1, "produced", ["Example first page", "Example second page"]],
				[1, "unavailable", []],
				[2, "no_text", []],
			],
		);
		assert.equal(rows[0].r2_key, "example/deal-file-v1");
		assert.equal(rows[0].sha256, "a".repeat(64));
		assert.equal(rows[0].bytes, "1024");
		assert.equal(rows[0].extracted_at, "2026-04-01 12:00:00+00");
		assert.equal(rows[0].method, "text_layer");
		assert.equal(rows[0].extractor_version, "example.v1");
		assert.deepEqual(rows[0].receipt, { canonical: false });
		assert.equal(rows[0].changed_by_user_id, USER);
		assert.equal(
			(
				await db.query(
					"select count(*) from change where table_name = 'document_extraction'",
				)
			).rows[0].count,
			"3",
		);
	}));

test("the same extraction is stored once even without a model", () =>
	rolledBack(async () => {
		await db.query(`${dealFile()}; ${extraction()}`);
		await assert.rejects(db.query(extraction()), { code: "23505" });
	}));

test("a fact extraction keeps its successful receipt without pretending it produced page text", () =>
	rolledBack(async () => {
		await db.query(
			`${dealFile()}; ${extraction({ status: "receipt_only", pages: "{}", text_format_version: "fact-receipt.v1" })}`,
		);
		assert.deepEqual(
			(await db.query("select status, pages, receipt from document_extraction"))
				.rows,
			[{ status: "receipt_only", pages: [], receipt: { canonical: false } }],
		);
	}));

test("receipt-only extraction requires a receipt", () =>
	rolledBack(async () => {
		await db.query(dealFile());
		await assert.rejects(
			db.query(
				extraction({ status: "receipt_only", pages: "{}", receipt: null }),
			),
			{ constraint: "document_extraction_status_matches_text" },
		);
	}));

for (const sql of [
	"delete from document",
	"update document set r2_key = 'example/overwrite'",
	"update document set version = 2",
	"update document_extraction set pages = '{}'",
	"delete from document_extraction",
	"truncate document_extraction",
]) {
	test(`file history refuses ${sql}`, () =>
		rolledBack(() => assert.rejects(db.query(sql), { code: "42501" })));
}

for (const pages of [
	"array_fill('Example'::text, array[1001])",
	"array[repeat('x', 500001)]",
]) {
	test(`extraction refuses oversized pages from ${pages}`, () =>
		rolledBack(async () => {
			await db.query(`${dealFile()}; ${extraction()}`);
			await assert.rejects(
				db.query(
					extraction({ extractor_version: "example.v2" }).replace(
						`'{"Example first page","Example second page"}'`,
						pages,
					),
				),
				{ constraint: "document_extraction_pages" },
			);
		}));
}

test("a file version has one successor and independent files can share its kind", () =>
	rolledBack(async () => {
		await db.query(`${dealFile()};
			${dealFile({ id: id(8001), r2_key: "example/v2", version: 2, supersedes_id: DEAL_FILE })};
			${dealFile({ id: id(8002), r2_key: "example/independent" })}`);
		await assert.rejects(
			db.query(
				dealFile({
					id: id(8003),
					r2_key: "example/fork",
					version: 2,
					supersedes_id: DEAL_FILE,
				}),
			),
			{ constraint: "document_supersedes_id_key" },
		);
	}));

test("a job's extracted text keeps its own stamp and the user it worked for", () =>
	rolledBack(async () => {
		await db.query(`${asJob("agent", USER)}; ${dealFile()}; ${extraction()}`);
		const { rows } = await db.query(
			"select changed_by_job, changed_by_user_id, changed_for_user_id from document_extraction",
		);
		assert.deepEqual(rows, [
			{
				changed_by_job: "agent",
				changed_by_user_id: null,
				changed_for_user_id: USER,
			},
		]);
	}));

test("legacy whitespace-only pages keep their no-text status in every locale", () =>
	rolledBack(async () => {
		await db.query(
			`${dealFile()}; ${extraction({ status: "no_text", pages: '{"\u00a0\u0085\u001c\u001d\u001e\u001f"}' })}`,
		);
	}));

test("an email attachment is filed once without copying its R2 object", () =>
	rolledBack(async () => {
		await db.query(
			`update document set deal_id = '${DEAL}', kind = 'loi', content_type = 'application/pdf', sha256 = '${"a".repeat(64)}', bytes = 1024 where id = '${id(201)}'`,
		);
		const { rows } = await db.query(
			`select deal_id, kind, r2_key, email_activity_id from document join email_document on document_id = id where id = '${id(201)}'`,
		);
		assert.deepEqual(rows, [
			{
				deal_id: DEAL,
				kind: "loi",
				r2_key: "example/loi-2.pdf",
				email_activity_id: EMAIL,
			},
		]);
		await assert.rejects(
			db.query(
				`update document set deal_id = '${LENDER_DEAL}' where id = '${id(201)}'`,
			),
			{ constraint: "document_filed_once" },
		);
	}));

test("two buckets may use the same key but stored file metadata cannot change", () =>
	rolledBack(async () => {
		await db.query(
			`${dealFile()}; ${dealFile({ id: id(8001), r2_bucket: "deal_documents" })}`,
		);
		await assert.rejects(
			db.query(
				`update document set sha256 = '${"b".repeat(64)}' where id = '${DEAL_FILE}'`,
			),
			{ constraint: "document_filed_once" },
		);
	}));

for (const column of ["deal_id", "kind", "sha256", "bytes", "content_type"]) {
	test(`filed ${column} never clears or changes`, () =>
		rolledBack(async () => {
			await db.query(dealFile());
			await assert.rejects(
				db.query(
					`update document set ${column} = null where id = '${DEAL_FILE}'`,
				),
				{ constraint: "document_filed_once" },
			);
		}));
}

test("filing preserves known attachment metadata", () =>
	rolledBack(async () => {
		await db.query(dealFile({ deal_id: null, kind: null }));
		await assert.rejects(
			db.query(
				`update document set deal_id = '${DEAL}', kind = 'lease', bytes = 2048 where id = '${DEAL_FILE}'`,
			),
			{ constraint: "document_filed_once" },
		);
	}));

test("an outside lease has no brokerage deal and a renewal is its own deal", async () => {
	await rolledBack(async () => {
		await db.query(
			newLease({
				deal_id: null,
				offer_id: null,
				executed_on: null,
				rent_starts_on: "2020-01-01",
				commencement_on: "2020-01-01",
			}),
		);
		await db.query(`insert into deal (id, name, owner_user_id, reason, renews_lease_id)
			values ('${id(730)}', 'Example Renewal', '${USER}', 'renewal', '${id(721)}'); select propose_critical_dates('${id(730)}')`);
		assert.deepEqual(
			(
				await db.query(
					"select party_id, property_id, deal_id, expiration_on::text from current_lease",
				)
			).rows,
			[
				{
					party_id: CLIENT,
					property_id: PROPERTY,
					deal_id: null,
					expiration_on: "2033-06-30",
				},
			],
		);
		assert.deepEqual(
			(
				await db.query(
					"select deal_id, lease_version_id, kind from critical_date",
				)
			).rows,
			[{ deal_id: id(730), lease_version_id: LEASE, kind: "lease_end" }],
		);
		await db.query(`update deal set reason = 'relocation', renews_lease_id = null where id = '${id(730)}';
			update deal set reason = 'renewal', renews_lease_id = '${id(721)}' where id = '${id(730)}';
			insert into deal_property (deal_id, property_id) values ('${id(730)}', '${PROPERTY}');
			update party set how_found = 'referral' where id = '${AGENT}';
			insert into party_role (party_id, role) values ('${AGENT}', 'client');
			insert into deal_party (deal_id, party_id, role) values ('${id(730)}', '${AGENT}', 'client');
			insert into lease (id, party_id, property_id, deal_id) values ('${id(731)}', '${AGENT}', '${PROPERTY}', '${id(730)}');
			insert into lease_version (id, lease_id, version, document_id, expiration_on)
			values ('${id(732)}', '${id(731)}', 1, '${PDF_FILE}', '2040-06-30'); ${CHECK_AT_COMMIT}`);
		assert.deepEqual(
			(await db.query("select lease_id, party_id from lease_ending")).rows,
			[{ lease_id: id(731), party_id: AGENT }],
		);
	});
});

test("a tenant merge preserves lease versions", async () => {
	await rolledBack(async () => {
		await db.query(newLease());
		await db.query(
			`select merge_party('${CLIENT}', '${LENDERS[0]}'); ${CHECK_AT_COMMIT}`,
		);
		assert.deepEqual(
			(await db.query("select party_id, id from current_lease")).rows,
			[{ party_id: LENDERS[0], id: LEASE }],
		);
	});
});

test("a completed tour appears once on its deal even when it visits several properties", async () => {
	await rolledBack(async () => {
		const tour = id(740);
		await db.query(`insert into activity (id, kind, happened_at, from_party_id, summary)
			values ('${tour}', 'meeting', '2026-04-02T15:00:00Z', '${CLIENT}', 'Example two-property tour');
			insert into activity_about (activity_id, deal_id, property_id) values
			('${tour}', '${DEAL}', null), ('${tour}', null, '${PROPERTY}'), ('${tour}', null, '${ELSEWHERE}')`);
		assert.deepEqual(
			(await readDeal()).activity.filter((a: { id: string }) => a.id === tour),
			[
				{
					id: tour,
					kind: "meeting",
					happened_at: "2026-04-02T15:00:00+00:00",
					from_party_id: CLIENT,
					summary: "Example two-property tour",
					reached: null,
					email: null,
				},
			],
		);
	});
});

const SUITE = id(800);
const SPACE_NEED = id(801);
const leaseSuite = (suite: string, property = PROPERTY) =>
	insert("lease_suite", {
		lease_version_id: LEASE,
		lease_id: LEASE_RECORD,
		property_id: property,
		suite_id: suite,
	});
const SPACE_SEED = `
insert into suite (id, property_id, label, floor, area_sf, area_basis)
values ('${SUITE}', '${PROPERTY}', '101', 1, 2400, 'rentable');
insert into space_need (id, deal_id, name, min_sf, max_sf, space_type, must_haves)
values ('${SPACE_NEED}', '${DEAL}', 'Example search', 2000, 3000, 'medical', 'Ground floor');
insert into building_ownership (property_id, party_id, kind, started_on, ended_on, source)
values ('${PROPERTY}', '${BROKERAGES[0]}', 'owner', '2020-01-01', '2025-12-31', 'Example deed'),
('${PROPERTY}', '${BROKERAGES[1]}', 'owner', '2026-01-01', null, 'Example deed');`;

for (const [name, sql, refusal] of [
	[
		"reversed size range",
		`update space_need set min_sf = 4000`,
		"space_need_size_in_order",
	],
	[
		"negative minimum",
		`update space_need set min_sf = -1`,
		"space_need_min_sf_check",
	],
	[
		"zero maximum",
		`update space_need set max_sf = 0`,
		"space_need_max_sf_check",
	],
	[
		"unknown market",
		`update space_need set market_id = '${MISSING}'`,
		"space_need_market_id_fkey",
	],
	[
		"unknown deal",
		`insert into space_need (deal_id, name) values ('${MISSING}', 'Example')`,
		"space_need_deal_id_fkey",
	],
	[
		"blank must-have",
		`update space_need set must_haves = ' '`,
		"space_need_must_haves_check",
	],
	[
		"blank type",
		`update space_need set space_type = ' '`,
		"space_need_space_type_check",
	],
	["blank name", `update space_need set name = ' '`, "space_need_name_check"],
	[
		"duplicate suite",
		`insert into suite (property_id, label) values ('${PROPERTY}', '101')`,
		"suite_property_id_label_key",
	],
	["blank suite", `update suite set label = ' '`, "suite_label_check"],
	["zero suite area", `update suite set area_sf = 0`, "suite_area_sf_check"],
	[
		"unknown area basis",
		`update suite set area_basis = 'guess'`,
		"suite_area_basis_check",
	],
	[
		"unknown property",
		`insert into suite (property_id) values ('${MISSING}')`,
		"suite_property_id_fkey",
	],
	[
		"reversed ownership dates",
		`update building_ownership set ended_on = '2010-01-01'`,
		"building_ownership_check",
	],
	[
		"unknown owner",
		`insert into building_ownership (property_id, party_id, kind, source) values ('${PROPERTY}', '${MISSING}', 'owner', 'Example')`,
		"building_ownership_party_id_fkey",
	],
	[
		"unknown ownership kind",
		`insert into building_ownership (property_id, party_id, kind, source) values ('${PROPERTY}', '${CLIENT}', 'other', 'Example')`,
		"building_ownership_kind_check",
	],
	[
		"blank ownership source",
		`update building_ownership set source = ' '`,
		"building_ownership_source_check",
	],
	[
		"duplicate ownership",
		`insert into building_ownership (property_id, party_id, kind, started_on, source) values ('${PROPERTY}', '${BROKERAGES[0]}', 'owner', '2020-01-01', 'Example')`,
		"building_ownership_property_id_party_id_kind_started_on_key",
	],
	[
		"lease suite in another building",
		`insert into suite (id, property_id) values ('${id(802)}', '${ELSEWHERE}'); ${newLease()}; ${leaseSuite(id(802))}`,
		"lease_suite_suite_id_property_id_fkey",
	],
	[
		"missing lease suite",
		`${newLease()}; ${leaseSuite(MISSING)}`,
		"lease_suite_suite_id_property_id_fkey",
	],
] satisfies [string, string, string][]) {
	test(`space records refuse ${name}`, () =>
		rolledBack(async () => {
			await db.query(SPACE_SEED);
			await assert.rejects(db.query(sql), { constraint: refusal });
		}));
}

test("space needs keep typed criteria and suites join leases only within their property", () =>
	rolledBack(async () => {
		await db.query(`${SPACE_SEED};
		update space_need set market_id = '${BAY}' where id = '${SPACE_NEED}';
		${newLease()}; ${leaseSuite(SUITE)}`);
		const { rows } =
			await db.query(`select n.min_sf, n.max_sf, n.space_type, n.must_haves, m.name,
		s.label, s.area_sf, ls.suite_id, n.changed_by_user_id
		from space_need n join market m on m.id = n.market_id
		join lease l on l.deal_id = n.deal_id join lease_version v on v.lease_id = l.id join lease_suite ls on ls.lease_version_id = v.id join suite s on s.id = ls.suite_id`);
		assert.deepEqual(rows, [
			{
				min_sf: "2000.0",
				max_sf: "3000.0",
				space_type: "medical",
				must_haves: "Ground floor",
				name: "Example Bay",
				label: "101",
				area_sf: "2400.0",
				suite_id: SUITE,
				changed_by_user_id: USER,
			},
		]);
		await assert.rejects(db.query(`delete from suite where id = '${SUITE}'`), {
			constraint: "lease_suite_suite_id_property_id_fkey",
		});
	}));

test("ownership keeps former and joint owners, and a merge preserves the survivor's duplicate link", () =>
	rolledBack(async () => {
		await db.query(`${SPACE_SEED};
		insert into building_ownership (property_id, party_id, kind, started_on, source)
		values ('${PROPERTY}', '${LENDERS[0]}', 'owner', '2026-01-01', 'Example joint owner');
		select merge_party('${BROKERAGES[0]}', '${BROKERAGES[1]}')`);
		const { rows } =
			await db.query(`select party_id, started_on::text, ended_on::text
		from building_ownership order by started_on, party_id`);
		assert.equal(rows.length, 3);
		assert.deepEqual(rows[0], {
			party_id: BROKERAGES[1],
			started_on: "2020-01-01",
			ended_on: "2025-12-31",
		});
		await db.query(`insert into building_ownership (property_id, party_id, kind, started_on, source)
		values ('${PROPERTY}', '${LENDERS[0]}', 'owner', '2020-01-01', 'Example duplicate');
		select merge_party('${LENDERS[0]}', '${BROKERAGES[1]}')`);
		assert.deepEqual(
			(
				await db.query(
					"select source from building_ownership order by started_on",
				)
			).rows,
			[{ source: "Example deed" }, { source: "Example deed" }],
		);
	}));

test("unknown space facts stay unknown, alternatives and same labels in other buildings are allowed", () =>
	rolledBack(async () => {
		await db.query(`${SPACE_SEED};
		insert into suite (property_id, label) values ('${ELSEWHERE}', '101'), ('${PROPERTY}', null), ('${PROPERTY}', null);
		insert into space_need (deal_id, name, max_sf) values ('${DEAL}', 'Example alternative', 1500);
		insert into space_need (deal_id, name, min_sf) values ('${DEAL}', 'Example larger alternative', 3000);
		insert into building_ownership (property_id, party_id, kind, source)
		values ('${ELSEWHERE}', '${CLIENT}', 'owner', 'Example undated source');`);
		assert.equal((await db.query("select * from suite")).rowCount, 4);
		assert.equal((await db.query("select * from space_need")).rowCount, 3);
		await assert.rejects(
			db.query(`insert into building_ownership (property_id, party_id, kind, source)
		values ('${ELSEWHERE}', '${CLIENT}', 'owner', 'Example repeated source')`),
			{
				constraint:
					"building_ownership_property_id_party_id_kind_started_on_key",
			},
		);
	}));

test("space edits carry job attribution and retain their prior values in history", () =>
	rolledBack(async () => {
		await db.query(`${SPACE_SEED}; ${asJob("agent", TEAMMATE)};
		update suite set area_sf = 2500 where id = '${SUITE}';
		update space_need set must_haves = 'Example parking' where id = '${SPACE_NEED}';
		update building_ownership set source = 'Example corrected source';`);
		const { rows } =
			await db.query(`select table_name, changed_by_job, changed_for_user_id,
		old_value is not null as keeps_before from change where action = 'update'
		and table_name in ('suite', 'space_need', 'building_ownership') order by table_name`);
		assert.deepEqual(
			rows.map((r) => [
				r.table_name,
				r.changed_by_job,
				r.changed_for_user_id,
				r.keeps_before,
			]),
			["building_ownership", "building_ownership", "space_need", "suite"].map(
				(table) => [table, "agent", TEAMMATE, true],
			),
		);
	}));

for (const [sql, constraint] of [
	["update space_need set min_sf = 'NaN'", "space_need_min_sf_check"],
	["update space_need set max_sf = 'NaN'", "space_need_max_sf_check"],
	["update suite set area_sf = 'NaN'", "suite_area_sf_check"],
	[
		"update space_need set max_rate_sf_yr = -1",
		"space_need_max_rate_sf_yr_check",
	],
	[
		"update space_need set max_rate_sf_yr = 'NaN'",
		"space_need_max_rate_sf_yr_check",
	],
	[
		"update space_need set source_ref = 'Example partial source'",
		"space_need_vendor_source_whole",
	],
	[
		`insert into suite (id, property_id) values ('${id(802)}', '${ELSEWHERE}'); ${newLease()}; ${leaseSuite(id(802), ELSEWHERE)}`,
		"lease_suite_lease_id_property_id_fkey",
	],
	[
		`${newLease()}; ${leaseSuite(SUITE)}; ${leaseSuite(SUITE)}`,
		"lease_suite_pkey",
	],
] satisfies [string, string][]) {
	test(`space records enforce ${constraint}: ${sql}`, () =>
		rolledBack(async () => {
			await db.query(SPACE_SEED);
			await assert.rejects(db.query(sql), { constraint });
		}));
}

test("one signed lease covers several suites and keeps its links as history", () =>
	rolledBack(async () => {
		await db.query(`${SPACE_SEED}; ${newLease()}; ${leaseSuite(SUITE)};
		insert into suite (id, property_id, label) values ('${id(802)}', '${PROPERTY}', '102');
		${leaseSuite(id(802))};`);
		assert.deepEqual(
			(await db.query("select suite_id from lease_suite order by suite_id"))
				.rows,
			[{ suite_id: SUITE }, { suite_id: id(802) }],
		);
		await assert.rejects(
			db.query("delete from lease_suite"),
			notGranted("lease_suite"),
		);
	}));

test("a vendor requirement keeps structured provenance and the rent ceiling remains typed", () =>
	rolledBack(async () => {
		await db.query(`${SPACE_SEED}; insert into party_role (party_id, role) values ('${LENDERS[0]}', 'vendor');
		update space_need set max_rate_sf_yr = 40,
		vendor_id = '${LENDERS[0]}', source_ref = 'example-source', source_revision = 'v1',
		applicability = 'Example location' where id = '${SPACE_NEED}'`);
		assert.deepEqual(
			(
				await db.query(
					`select max_rate_sf_yr, vendor_id, source_ref, source_revision, applicability from space_need`,
				)
			).rows,
			[
				{
					max_rate_sf_yr: "40.00",
					vendor_id: LENDERS[0],
					source_ref: "example-source",
					source_revision: "v1",
					applicability: "Example location",
				},
			],
		);
	}));

test("suite premises belong to each signed version and cannot name another lease identity", () =>
	rolledBack(async () => {
		await db.query(`${SPACE_SEED}; ${newLease()}; ${leaseSuite(SUITE)};
			${newLease({ id: id(803), version: 2, offer_id: null })};
			insert into lease_suite (lease_version_id, lease_id, property_id, suite_id)
			values ('${id(803)}', '${LEASE_RECORD}', '${PROPERTY}', '${SUITE}');
			insert into lease (id, party_id, property_id) values ('${id(804)}', '${CLIENT}', '${PROPERTY}');
			insert into suite (id, property_id, label) values ('${id(805)}', '${PROPERTY}', '103')`);
		assert.deepEqual(
			(
				await db.query(
					"select lease_version_id, suite_id from lease_suite order by lease_version_id",
				)
			).rows,
			[
				{ lease_version_id: LEASE, suite_id: SUITE },
				{ lease_version_id: id(803), suite_id: SUITE },
			],
		);
		await assert.rejects(
			db.query(`insert into lease_suite (lease_version_id, lease_id, property_id, suite_id)
			values ('${LEASE}', '${id(804)}', '${PROPERTY}', '${id(805)}')`),
			{ constraint: "lease_suite_lease_version_id_lease_id_fkey" },
		);
	}));

const NEED_VENDOR = `update space_need set vendor_id = '${VENDOR}', source_ref = 'example-source',
	source_revision = 'v1', applicability = 'Example location' where id = '${SPACE_NEED}'`;
for (const [name, sql, constraint] of [
	[
		"padded suite label",
		"update suite set label = ' 101'",
		"suite_label_check",
	],
	[
		"blank suite condition",
		"update suite set condition = ' '",
		"suite_condition_check",
	],
	[
		"blank vendor source",
		`${NEED_VENDOR}; update space_need set source_ref = ' '`,
		"space_need_source_ref_check",
	],
	[
		"blank vendor revision",
		`${NEED_VENDOR}; update space_need set source_revision = ' '`,
		"space_need_source_revision_check",
	],
	[
		"blank vendor applicability",
		`${NEED_VENDOR}; update space_need set applicability = ' '`,
		"space_need_applicability_check",
	],
	[
		"missing ownership property",
		`insert into building_ownership (property_id, party_id, kind, source) values ('${MISSING}', '${CLIENT}', 'owner', 'Example deed')`,
		"building_ownership_property_id_fkey",
	],
	[
		"missing vendor party",
		`${NEED_VENDOR}; update space_need set vendor_id = '${MISSING}'`,
		"space_need_vendor_id_vendor_role_fkey",
	],
	[
		"party without vendor role",
		`${NEED_VENDOR}; update space_need set vendor_id = '${AGENT}'`,
		"space_need_vendor_id_vendor_role_fkey",
	],
	[
		"another role used as vendor",
		`insert into space_need (deal_id, name, vendor_id, vendor_role, source_ref, source_revision, applicability)
		values ('${DEAL}', 'Example need', '${AGENT}', 'listing_agent', 'example-source', 'v1', 'Example location')`,
		"space_need_vendor_role_check",
	],
	[
		"removing referenced vendor role",
		`insert into party_role (party_id, role) values ('${LENDERS[0]}', 'vendor'); ${NEED_VENDOR};
		update space_need set vendor_id = '${LENDERS[0]}'; delete from party_role where party_id = '${LENDERS[0]}' and role = 'vendor'`,
		"space_need_vendor_id_vendor_role_fkey",
	],
] satisfies [string, string, string][]) {
	test(`space records refuse ${name}`, () =>
		rolledBack(async () => {
			await db.query(SPACE_SEED);
			await assert.rejects(db.query(sql), { constraint });
		}));
}

for (const survivorIsVendor of [false, true]) {
	test(`a space need follows a merged vendor when its survivor ${survivorIsVendor ? "already holds" : "gains"} the vendor role`, () =>
		rolledBack(async () => {
			await db.query(`${SPACE_SEED}; insert into party_role (party_id, role) values ('${LENDERS[0]}', 'vendor');
			${NEED_VENDOR}; update space_need set vendor_id = '${LENDERS[0]}'`);
			if (survivorIsVendor)
				await db.query(
					`insert into party_role (party_id, role) values ('${LENDERS[1]}', 'vendor')`,
				);
			await db.query(
				`select merge_party('${LENDERS[0]}', '${LENDERS[1]}'); ${CHECK_AT_COMMIT}`,
			);
			assert.deepEqual(
				(
					await db.query(
						"select vendor_id, source_ref, source_revision, applicability from space_need",
					)
				).rows,
				[
					{
						vendor_id: LENDERS[1],
						source_ref: "example-source",
						source_revision: "v1",
						applicability: "Example location",
					},
				],
			);
		}));
}

const INVOICE = id(980);
const INVOICE_PAYMENT = id(981);
const invoiceEmail = (row: Record<string, string | null> = {}) =>
	insert("invoice_email", {
		id: INVOICE,
		evidence_ref: "local-mail:example-invoice",
		sender: "invoices@example.com",
		deal_name: " example DENTAL Springfield deal ",
		client_name: " Example DENTAL Group ",
		occurred_at: "2026-04-01T23:30:00-05:00",
		email_date: "2026-04-01",
		deal_id: DEAL,
		payment_id: INVOICE_PAYMENT,
		...row,
	});
const INVOICE_SETUP = `${COMMISSION}; ${payment({ id: INVOICE_PAYMENT })}; insert into phase values ('closed', 'Closed') on conflict do nothing`;
const RESEND = id(990);
const resendEmail = (row: Record<string, string | null> = {}) =>
	invoiceEmail({
		id: RESEND,
		evidence_ref: "local-mail:example-resend",
		...row,
	});
const APPLY_RESEND = `update invoice_email set status = 'applied' where id = '${RESEND}'`;

const APPLY_INVOICE = `update invoice_email set status = 'applied' where id = '${INVOICE}'`;
const UNDO_INVOICE = `update invoice_email set status = 'undone' where id = '${INVOICE}'`;

// biome-ignore format: one row per refusal
const INVOICE_REFUSALS: Case[] = [
	[`${INVOICE_SETUP}; ${invoiceEmail()}; ${asJob("mail_capture", USER)}; ${APPLY_INVOICE}`, "invoice_email_apply_job"],
	[`${INVOICE_SETUP}; ${invoiceEmail()}; update commission_payment set invoiced_on = '2026-04-02' where id = '${INVOICE_PAYMENT}'; ${payment({id: id(983), invoiced_on: '2026-04-01'})}; ${asJob("lead_stage")}; ${APPLY_INVOICE}`, 'invoice_email_needs_user'],
	...['evidence_ref', 'deal_name', 'client_name', 'property_address'].map((field): Case => [`${INVOICE_SETUP}; ${invoiceEmail({[field]: ' '})}`, `invoice_email_${field}_check`]),
	[`${INVOICE_SETUP}; ${invoiceEmail({email_date: '2026-03-01'})}`, 'invoice_email_date_matches_time'],
	[`${INVOICE_SETUP}; ${invoiceEmail({occurred_at: '-infinity'})}`, 'invoice_email_date_matches_time'],
	[`${INVOICE_SETUP}; ${invoiceEmail()}; ${payment({id: id(983)})}; ${asJob("lead_stage")}; ${APPLY_INVOICE}`, 'invoice_email_needs_user'],
	[`${INVOICE_SETUP}; ${invoiceEmail()}; ${payment({id: id(983), invoiced_on: '2026-03-01'})}; ${asJob("lead_stage")}; ${APPLY_INVOICE}`, 'invoice_email_needs_user'],
	[`${payment({id: INVOICE_PAYMENT, deal_id: LENDER_DEAL, amount: 500})}; ${invoiceEmail({deal_id: LENDER_DEAL})}; ${APPLY_INVOICE}`, 'invoice_email_needs_prior_phase'],
	[`${INVOICE_SETUP}; insert into invoice_email (status) values ('applied')`, notGranted('invoice_email')],
	[`${INVOICE_SETUP}; ${invoiceEmail()}; ${invoiceEmail({id: id(982)})}`, "invoice_email_evidence_ref_key"],
	[`${INVOICE_SETUP}; ${invoiceEmail({deal_id: LENDER_DEAL})}`, "invoice_email_payment_id_deal_id_fkey"],
	[`${INVOICE_SETUP}; ${invoiceEmail({payment_id: null})}`, "invoice_email_target_whole"],
	[`${INVOICE_SETUP}; ${invoiceEmail({deal_id: null, payment_id: null})}; ${APPLY_INVOICE}`, "invoice_email_needs_payment"],
	...[
		{sender: "unknown@example.com"}, {client_name: "Other Example"}, {client_name: null},
		{property_address: "Wrong example address"}, {deal_name: "Other Example Deal"},
		{occurred_at: "2999-04-01T00:00:00Z", email_date: "2999-04-01"},
	].map((row): Case => [`${INVOICE_SETUP}; ${invoiceEmail(row)}; ${asJob("lead_stage", USER)}; ${APPLY_INVOICE}`, "invoice_email_needs_user"]),
	[`${INVOICE_SETUP}; ${invoiceEmail()}; update commission_payment set invoiced_on = '2026-03-31' where id = '${INVOICE_PAYMENT}'; ${asJob("lead_stage")}; ${APPLY_INVOICE}`, "invoice_email_needs_user"],
	[`${INVOICE_SETUP}; insert into deal (id, name, owner_user_id) values ('${id(982)}', 'Example Dental Springfield Deal', '${USER}'); insert into deal_party values ('${id(982)}', '${CLIENT}', 'client'); ${invoiceEmail()}; ${asJob("lead_stage")}; ${APPLY_INVOICE}`, "invoice_email_needs_user"],
	[`${INVOICE_SETUP}; ${invoiceEmail()}; ${APPLY_INVOICE}; ${APPLY_INVOICE}`, "invoice_email_status_moves"],
	[`${INVOICE_SETUP}; ${invoiceEmail()}; ${APPLY_INVOICE}; ${asJob("agent", USER)}; ${UNDO_INVOICE}`, "invoice_email_status_moves"],
	[`${INVOICE_SETUP}; ${invoiceEmail()}; ${APPLY_INVOICE}; update invoice_email set deal_id = null, payment_id = null`, "invoice_email_keeps_target"],
	[`${INVOICE_SETUP}; ${invoiceEmail()}; ${APPLY_INVOICE}; insert into deal_phase_change values ('${DEAL}', '2999-01-01', 'legal', 'Example newer move'); ${UNDO_INVOICE}`, "invoice_email_undo_current"],
	[`${INVOICE_SETUP}; ${invoiceEmail()}; ${APPLY_INVOICE}; update commission_payment set invoiced_on = '2026-04-02'; update commission_payment set invoiced_on = '2026-04-01'; ${UNDO_INVOICE}`, "invoice_email_undo_current"],
	[`${INVOICE_SETUP}; ${invoiceEmail()}; delete from invoice_email`, notGranted("invoice_email")],
	[`${INVOICE_SETUP}; ${invoiceEmail()}; update invoice_email set email_date = '2026-04-02'`, notGranted("invoice_email")],
	...[
		{sender: "stranger@example.net"}, {deal_name: "Example Unrelated Deal"},
		{client_name: "Example Other Client"},
	].map((row): Case => [`${INVOICE_SETUP}; ${invoiceEmail()}; ${asJob("lead_stage")}; ${APPLY_INVOICE}; ${resendEmail(row)}; ${APPLY_RESEND}`, "invoice_email_needs_user"]),
	...[
		"update invoice_email set status = 'undone'",
		"update invoice_email set status = 'applied'",
		"update invoice_email set deal_id = null, payment_id = null",
	].map((sql): Case => [`${INVOICE_SETUP}; ${invoiceEmail()}; ${APPLY_INVOICE}; ${resendEmail()}; ${APPLY_RESEND}; ${sql} where id = '${RESEND}'`,
		sql.includes("deal_id") ? "invoice_email_keeps_target" : "invoice_email_status_moves"]),
	[`${INVOICE_SETUP}; ${invoiceEmail()}; update invoice_email set application_id = '${RESEND}'`, notGranted("invoice_email")],
	["insert into invoice_mailbox (address) values ('other@example.com')", notGranted("invoice_mailbox")],
];

test("invoice evidence and guarded application obey rules 92 to 95", async () => {
	for (const [sql, refusal] of INVOICE_REFUSALS)
		await rolledBack(() => assert.rejects(db.query(sql), expected(refusal)));
});

test("a trusted invoice closes its deal, dates one payment once, and a user undoes it", async () => {
	await rolledBack(async () => {
		await db.query(
			`${INVOICE_SETUP}; ${invoiceEmail()}; ${asJob("lead_stage", USER)}; ${APPLY_INVOICE}; ${CHECK_AT_COMMIT}`,
		);
		assert.deepEqual(
			(
				await db.query(`select d.invoiced_on::text, p.received_on, i.status, i.changed_by_job,
			i.changed_for_user_id from deal_invoiced d join commission_payment p using (deal_id)
			join invoice_email i on i.payment_id = p.id where p.id = '${INVOICE_PAYMENT}'`)
			).rows,
			[
				{
					invoiced_on: "2026-04-01",
					received_on: null,
					status: "applied",
					changed_by_job: "lead_stage",
					changed_for_user_id: USER,
				},
			],
		);
		assert.equal(
			(
				await db.query(
					`select phase from deal_phase_change where deal_id = '${DEAL}' order by happened_at desc limit 1`,
				)
			).rows[0].phase,
			"closed",
		);
		await db.query(`${asUser(USER)}; ${UNDO_INVOICE}; ${CHECK_AT_COMMIT}`);
		assert.deepEqual(
			(
				await db.query(
					`select invoiced_on from deal_invoiced where deal_id = '${DEAL}'`,
				)
			).rows,
			[],
			"an undone invoice leaves the deal uninvoiced",
		);
		assert.equal(
			(
				await db.query(
					`select phase from deal_phase_change where deal_id = '${DEAL}' order by happened_at desc limit 1`,
				)
			).rows[0].phase,
			"legal",
		);
		assert.equal(
			(
				await db.query(
					`select count(*) from change where table_name = 'invoice_email'`,
				)
			).rows[0].count,
			"3",
		);
	});
});

test("a direct user resolves doubtful evidence and undo restores the payment's prior date", async () => {
	await rolledBack(async () => {
		await db.query(`${INVOICE_SETUP}; update commission_payment set invoiced_on = '2026-03-31' where id = '${INVOICE_PAYMENT}';
			${invoiceEmail({ client_name: "Uncertain Example" })}; ${APPLY_INVOICE}; ${UNDO_INVOICE}; ${CHECK_AT_COMMIT}`);
		assert.equal(
			(
				await db.query(
					`select invoiced_on::text from deal_invoiced where deal_id = '${DEAL}'`,
				)
			).rows[0].invoiced_on,
			"2026-03-31",
		);
	});
});

test("a user dates a later payment and the deal reads its earliest invoice", async () => {
	await rolledBack(async () => {
		await db.query(`${INVOICE_SETUP}; ${payment({ id: id(983), invoiced_on: "2026-03-01" })};
			${invoiceEmail({ client_name: null, property_address: "  100 EXAMPLE Way,   Springfield ", deal_name: " example DENTAL Springfield deal " })};
			${asUser(USER)}; ${APPLY_INVOICE}; ${CHECK_AT_COMMIT}`);
		assert.equal(
			(
				await db.query(
					`select invoiced_on::text from deal_invoiced where deal_id = '${DEAL}'`,
				)
			).rows[0].invoiced_on,
			"2026-03-01",
		);
		await db.query(`${asUser(USER)}; ${UNDO_INVOICE}; ${CHECK_AT_COMMIT}`);
		assert.equal(
			(
				await db.query(
					`select invoiced_on::text from deal_invoiced where deal_id = '${DEAL}'`,
				)
			).rows[0].invoiced_on,
			"2026-03-01",
		);
	});
});

test("an invoice cannot partly close a deal when its payment refuses the date", async () => {
	await rolledBack(async () => {
		await db.query(
			`${INVOICE_SETUP}; ${invoiceEmail()}; update commission_payment set due_on = '2026-03-31' where id = '${INVOICE_PAYMENT}'; savepoint applying`,
		);
		await assert.rejects(
			db.query(APPLY_INVOICE),
			expected("commission_payment_dates_in_order"),
		);
		await db.query("rollback to applying");
		assert.equal(
			(
				await db.query(
					`select status from invoice_email where id = '${INVOICE}'`,
				)
			).rows[0].status,
			"captured",
		);
		assert.equal(
			(
				await db.query(
					`select phase from deal_phase_change where deal_id = '${DEAL}' order by happened_at desc limit 1`,
				)
			).rows[0].phase,
			"legal",
		);
	});
});

test("phase writers serialize with invoice application", async () => {
	const holder = await connect();
	const writer = await connect();
	try {
		await holder.query(
			`begin; insert into deal_phase_change values ('${DEAL}', '2026-03-21', 'legal', 'Example manual move')`,
		);
		await writer.query(
			`begin; ${INVOICE_SETUP}; ${invoiceEmail()}; ${asUser(USER)}`,
		);
		const { pid } = (await writer.query("select pg_backend_pid() as pid"))
			.rows[0];
		let settled = false;
		const applying = writer.query(APPLY_INVOICE).finally(() => {
			settled = true;
		});
		let blocked = false;
		while (!settled && !blocked)
			blocked = (
				await db.query("select pg_blocking_pids($1) <> '{}' as blocked", [pid])
			).rows[0].blocked;
		await holder.query("rollback");
		await applying;
		assert.equal(blocked, true);
	} finally {
		await holder.query("rollback");
		await writer.query("rollback");
		await holder.end();
		await writer.end();
	}
});

test("automatic invoice decisions do not lock unrelated parties", async () => {
	const invoice = await connect();
	const unrelated = await connect();
	try {
		await invoice.query(
			`begin; ${INVOICE_SETUP}; ${invoiceEmail()}; ${asJob("lead_stage")}; ${APPLY_INVOICE}`,
		);
		assert.equal(
			(
				await invoice.query(
					`select status from invoice_email where id = '${INVOICE}'`,
				)
			).rows[0].status,
			"applied",
		);
		await unrelated.query("begin; set local lock_timeout = '1s'");
		const inserted = await unrelated.query(
			`insert into party (kind, name) values ('company', 'Unrelated Example') returning name`,
		);
		assert.equal(inserted.rows[0].name, "Unrelated Example");
	} finally {
		await unrelated.query("rollback");
		await invoice.query("rollback");
		await unrelated.end();
		await invoice.end();
	}
});

for (const status of ["applied", "undone"]) {
	test(`imported ${status} invoices require every undo reference`, () =>
		asOwner(
			["prior_phase_at", "applied_phase_at", "payment_change_id"].map(
				(field): Case => [
					`${INVOICE_SETUP}; ${invoiceEmail()}; ${APPLY_INVOICE};
			alter table invoice_email disable trigger invoice_email_transition;
			update invoice_email set status = '${status}', ${field} = null where id = '${INVOICE}'`,
					"invoice_email_applied_whole",
				],
			),
		));
}

test("the selected payment stays locked between the undo snapshot and date update", async () => {
	const owner = await connect("none");
	const writer = await connect();
	const deal = id(984);
	const paymentId = id(985);
	try {
		await owner.query(`insert into phase values ('closed', 'Closed') on conflict do nothing;
			insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Payment Lock Deal', '${TEAMMATE}');
			insert into commission (deal_id, gross) values ('${deal}', 1000);
			${payment({ id: paymentId, deal_id: deal, amount: 500 })};
			insert into deal_phase_change values ('${deal}', '2026-03-01', 'legal', 'Example prior phase');
			${invoiceEmail({ deal_id: deal, payment_id: paymentId })};
			create function pause_invoice_test() returns trigger language plpgsql as $$
			begin perform pg_advisory_xact_lock(324980); return new; end $$;
			create trigger pause_invoice_test before insert on deal_phase_change
			for each row when (new.deal_id = '${deal}' and new.phase = 'closed') execute function pause_invoice_test()`);
		await db.query("select pg_advisory_lock(324980)");
		await writer.query("begin");
		const writerPid = (await writer.query("select pg_backend_pid() as pid"))
			.rows[0].pid;
		const ownerPid = (await owner.query("select pg_backend_pid() as pid"))
			.rows[0].pid;
		let applied = false;
		const applying = writer.query(APPLY_INVOICE).finally(() => {
			applied = true;
		});
		let paused = false;
		while (!applied && !paused)
			paused = (
				await db.query(
					"select pg_backend_pid() = any(pg_blocking_pids($1)) as blocked",
					[writerPid],
				)
			).rows[0].blocked;
		let edited = false;
		const editing = owner
			.query(
				`update commission_payment set invoiced_on = '2026-03-31' where id = '${paymentId}'`,
			)
			.finally(() => {
				edited = true;
			});
		let blocked = false;
		while (!edited && !blocked)
			blocked = (
				await db.query("select $2 = any(pg_blocking_pids($1)) as blocked", [
					ownerPid,
					writerPid,
				])
			).rows[0].blocked;
		await db.query("select pg_advisory_unlock(324980)");
		await applying;
		await writer.query("commit");
		await editing;
		assert.equal(paused, true, "invoice application reached the advisory lock");
		assert.equal(blocked, true, "invoice application blocked the payment edit");
		await assert.rejects(
			writer.query(UNDO_INVOICE),
			expected("invoice_email_undo_current"),
		);
		assert.equal(
			(
				await owner.query(
					`select invoiced_on::text from commission_payment where id = '${paymentId}'`,
				)
			).rows[0].invoiced_on,
			"2026-03-31",
		);
	} finally {
		await db.query("select pg_advisory_unlock(324980)");
		await writer.query("rollback");
		await owner.query(`drop trigger if exists pause_invoice_test on deal_phase_change;
			drop function if exists pause_invoice_test();
			delete from invoice_email where deal_id = '${deal}';
			delete from deal_phase_change where deal_id = '${deal}';
			delete from commission_payment where deal_id = '${deal}';
			delete from commission where deal_id = '${deal}'; delete from deal where id = '${deal}'`);
		await writer.end();
		await owner.end();
	}
});

test("invoice matching and payment checks cannot straddle a user's transaction", async () => {
	const owner = await connect("none");
	const writer = await connect();
	const client = id(986);
	const deal = id(987);
	const selected = id(988);
	const other = id(989);
	try {
		await owner.query(`insert into phase values ('closed', 'Closed') on conflict do nothing;
			insert into party (id, kind, name, how_found) values ('${client}', 'company', 'Example Invoice Client', 'referral');
			insert into party_role (party_id, role) values ('${client}', 'client');
			insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Snapshot Deal', '${TEAMMATE}');
			insert into deal_party (deal_id, party_id, role) values ('${deal}', '${client}', 'client');
			insert into commission (deal_id, gross) values ('${deal}', 1000);
			${payment({ id: selected, deal_id: deal, amount: 500 })};
			${payment({ id: other, deal_id: deal, amount: 500, invoiced_on: "2026-03-01" })};
			insert into deal_phase_change values ('${deal}', '2026-03-01', 'legal', 'Example prior phase');
			${invoiceEmail({ deal_id: deal, payment_id: selected, deal_name: "Example Snapshot Deal", client_name: "Example Invoice Client" })};
			create function pause_mailbox_test() returns boolean language plpgsql as $$
			begin perform pg_advisory_xact_lock(324989); return true; end $$;
			alter table invoice_mailbox enable row level security;
			create policy pause_mailbox_test on invoice_mailbox for select to engine using (pause_mailbox_test())`);
		await db.query("select pg_advisory_lock(324989)");
		await writer.query(`begin; ${asJob("lead_stage")}`);
		const { pid } = (await writer.query("select pg_backend_pid() as pid"))
			.rows[0];
		let settled = false;
		const applying = assert
			.rejects(
				writer.query(APPLY_INVOICE),
				expected("invoice_email_needs_user"),
			)
			.finally(() => {
				settled = true;
			});
		let paused = false;
		while (!settled && !paused)
			paused = (
				await db.query("select pg_blocking_pids($1) <> '{}' as blocked", [pid])
			).rows[0].blocked;
		await owner.query(`begin;
			update party set name = 'Renamed Example Client' where id = '${client}';
			delete from commission_payment where id = '${other}'; commit`);
		await db.query("select pg_advisory_unlock(324989)");
		await applying;
		await writer.query("rollback");
		assert.equal(paused, true);
		assert.equal(
			(
				await owner.query(
					`select status from invoice_email where id = '${INVOICE}'`,
				)
			).rows[0].status,
			"captured",
		);
		assert.equal(
			(
				await owner.query(
					`select invoiced_on from commission_payment where id = '${selected}'`,
				)
			).rows[0].invoiced_on,
			null,
		);
	} finally {
		await db.query("select pg_advisory_unlock(324989)");
		await writer.query("rollback");
		await owner.query(`rollback; drop policy if exists pause_mailbox_test on invoice_mailbox;
			alter table invoice_mailbox disable row level security;
			drop function if exists pause_mailbox_test();
			delete from invoice_email where deal_id = '${deal}';
			delete from deal_phase_change where deal_id = '${deal}';
			delete from commission_payment where deal_id = '${deal}';
			delete from commission where deal_id = '${deal}'; delete from deal_party where deal_id = '${deal}';
			delete from deal where id = '${deal}';
			delete from party_role where party_id = '${client}'; delete from party where id = '${client}'`);
		await writer.end();
		await owner.end();
	}
});

for (const [label, actor] of [
	["user", asUser(USER)],
	["job", asJob("lead_stage")],
]) {
	test(`resent invoice evidence attaches without changing the original close for a ${label}`, async () => {
		await rolledBack(async () => {
			await db.query(`${INVOICE_SETUP}; ${invoiceEmail()}; ${actor}; ${APPLY_INVOICE};
				${resendEmail()}; ${APPLY_RESEND}; ${CHECK_AT_COMMIT}`);
			assert.deepEqual(
				(
					await db.query(`select status, application_id, evidence_ref,
				prior_phase_at, applied_phase_at, payment_change_id from invoice_email where id = '${RESEND}'`)
				).rows,
				[
					{
						status: "attached",
						application_id: INVOICE,
						evidence_ref: "local-mail:example-resend",
						prior_phase_at: null,
						applied_phase_at: null,
						payment_change_id: null,
					},
				],
			);
			assert.equal(
				(
					await db.query(
						`select count(*) from deal_phase_change where deal_id = '${DEAL}' and phase = 'closed'`,
					)
				).rows[0].count,
				"1",
			);
			await db.query(`${asUser(USER)}; ${UNDO_INVOICE}; ${CHECK_AT_COMMIT}`);
			assert.equal(
				(
					await db.query(
						`select invoiced_on from commission_payment where id = '${INVOICE_PAYMENT}'`,
					)
				).rows[0].invoiced_on,
				null,
			);
			assert.equal(
				(
					await db.query(
						`select phase from deal_phase_change where deal_id = '${DEAL}' order by happened_at desc limit 1`,
					)
				).rows[0].phase,
				"legal",
			);
			await db.query(`${resendEmail({ id: id(991), evidence_ref: "local-mail:after-undo" })};
				${actor}; update invoice_email set status = 'applied' where id = '${id(991)}'; ${CHECK_AT_COMMIT}`);
			assert.deepEqual(
				(
					await db.query(
						`select status, application_id from invoice_email where id = '${id(991)}'`,
					)
				).rows,
				[{ status: "attached", application_id: INVOICE }],
			);
			assert.equal(
				(
					await db.query(
						`select count(*) from deal_phase_change where deal_id = '${DEAL}'`,
					)
				).rows[0].count,
				"4",
			);
		});
	});
}

test("concurrent invoice captures keep both sources and one undoable application", async () => {
	const owner = await connect("none");
	const first = await connect();
	const second = await connect();
	const deal = id(992);
	const paymentId = id(993);
	try {
		await owner.query(`insert into phase values ('closed', 'Closed') on conflict do nothing;
			insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Resend Deal', '${TEAMMATE}');
			insert into deal_party values ('${deal}', '${CLIENT}', 'client');
			insert into commission (deal_id, gross) values ('${deal}', 1000);
			${payment({ id: paymentId, deal_id: deal, amount: 500 })};
			insert into deal_phase_change values ('${deal}', '2026-03-01', 'legal', 'Example prior phase');
			${invoiceEmail({ deal_id: deal, payment_id: paymentId, deal_name: "Example Resend Deal" })}`);
		await first.query(`begin; ${asJob("lead_stage")}; ${APPLY_INVOICE}`);
		await second.query(`begin; ${asJob("lead_stage")}`);
		const { pid } = (await second.query("select pg_backend_pid() as pid"))
			.rows[0];
		let settled = false;
		const applying = second
			.query(
				`${resendEmail({ deal_id: deal, payment_id: paymentId, deal_name: "Example Resend Deal" })}; ${APPLY_RESEND}`,
			)
			.finally(() => {
				settled = true;
			});
		let blocked = false;
		while (!settled && !blocked)
			blocked = (
				await owner.query("select pg_blocking_pids($1) <> '{}' as blocked", [
					pid,
				])
			).rows[0].blocked;
		await first.query("commit");
		await applying;
		await second.query("commit");
		assert.equal(blocked, true);
		assert.deepEqual(
			(
				await owner.query(`select status, application_id from invoice_email
			where deal_id = '${deal}' order by id`)
			).rows,
			[
				{ status: "applied", application_id: null },
				{ status: "attached", application_id: INVOICE },
			],
		);
		assert.equal(
			(
				await owner.query(
					`select count(*) from deal_phase_change where deal_id = '${deal}' and phase = 'closed'`,
				)
			).rows[0].count,
			"1",
		);
		await first.query(`${asUser(USER)}; ${UNDO_INVOICE}`);
		assert.equal(
			(
				await owner.query(
					`select invoiced_on from commission_payment where id = '${paymentId}'`,
				)
			).rows[0].invoiced_on,
			null,
		);
		assert.equal(
			(
				await owner.query(
					`select phase from deal_phase_change where deal_id = '${deal}' order by happened_at desc limit 1`,
				)
			).rows[0].phase,
			"legal",
		);
	} finally {
		await first.query("rollback");
		await second.query("rollback");
		await owner.query(`delete from invoice_email where deal_id = '${deal}';
			delete from deal_phase_change where deal_id = '${deal}';
			delete from commission_payment where deal_id = '${deal}';
			delete from commission where deal_id = '${deal}';
			delete from deal_party where deal_id = '${deal}'; delete from deal where id = '${deal}'`);
		await first.end();
		await second.end();
		await owner.end();
	}
});

test("imported resends must reference one original application with the same target and date", () =>
	asOwner([
		[
			`${INVOICE_SETUP}; ${invoiceEmail()}; ${APPLY_INVOICE}; ${resendEmail()};
			alter table invoice_email disable trigger invoice_email_transition;
			update invoice_email set status = 'applied',
				prior_phase_at = (select prior_phase_at from invoice_email where id = '${INVOICE}'),
				applied_phase_at = (select applied_phase_at from invoice_email where id = '${INVOICE}'),
				payment_change_id = (select payment_change_id from invoice_email where id = '${INVOICE}')
			where id = '${RESEND}'`,
			"invoice_email_one_application",
		],
		...[
			{ status: "attached" },
			{ status: "captured", application_id: INVOICE },
			{
				status: "attached",
				application_id: INVOICE,
				prior_invoiced_on: "2026-03-01",
			},
		].map(
			(row): Case => [
				`${INVOICE_SETUP}; ${invoiceEmail()}; ${APPLY_INVOICE}; ${resendEmail(row)}`,
				"invoice_email_attachment_whole",
			],
		),
		...[
			{ application_id: RESEND },
			{ application_id: INVOICE, email_date: "2026-04-02" },
		].map(
			(row): Case => [
				`${INVOICE_SETUP}; ${invoiceEmail()}; ${APPLY_INVOICE};
			${resendEmail({ status: "attached", ...row })}`,
				"invoice_email_application_id_deal_id_payment_id_email_date_fkey",
			],
		),
	]));
for (const [snapshot, id] of [
	["everything_about_deal", DEAL],
	["everything_about_party", CLIENT],
] as const) {
	test(`${snapshot} cannot run as the partner reader`, () =>
		rolledBack(async () => {
			await db.query("set local role engine_reader");
			await assert.rejects(db.query(`select next.${snapshot}($1)`, [id]), {
				code: "42501",
				message: `permission denied for function ${snapshot}`,
			});
		}));
}
