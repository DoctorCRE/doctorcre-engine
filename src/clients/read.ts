import { type Kysely, type RawBuilder, sql, type Transaction } from "kysely";
import type { DB } from "../database.d.ts";
import { isOpenBoardDeal, selectNextDeals } from "../deals/next-board.ts";
import { failureKind } from "../failure.ts";
import type { DB as NextDB } from "../next-database.d.ts";
import {
	nameOldRecords,
	readOldRecordNames,
	recordLinks,
} from "../old-record-names.ts";
import { asText } from "../reader.ts";
import { UUID } from "../uuid.ts";

export const PARTNERS = ["joe", "dell"] as const;
export const SORTS = [
	"name",
	"recent",
	"vertical",
	"deal_type",
	"last_deal_desc",
	"last_deal_asc",
] as const;
export const PIPELINES = ["any", "active", "other", "unknown"] as const;
export const CONTRACTS = [
	"vendor-directory.v1",
	"vendor-directory.v2",
] as const;
export const PAGE_SIZE = 25;

export type Contract = (typeof CONTRACTS)[number];
export type Dataset = keyof typeof DATASETS;
// The old query echo, in its key order.
export type ListQuery<D extends Dataset, Sort extends string> = {
	dataset: D;
	contract?: Contract;
	scope: "team" | "mine";
	q: string | null;
	owner: "all" | (typeof PARTNERS)[number];
	territory: string | null;
	sort: Sort;
	page: number;
	page_size: typeof PAGE_SIZE;
};
export type ClientQuery = ListQuery<"clients", (typeof SORTS)[number]> & {
	status: string | null;
	type: string | null;
	pipeline: (typeof PIPELINES)[number];
	// "" asks for clients with no practice type.
	practice_type?: string;
	// "any", or one account's party id.
	national_account?: string;
	tiles?: true;
};
export type Stamp = { observedAt: Date; correlationId: string };

const STATUS = {
	QUERY_INVALID: 400,
	AUTHORIZATION_REFUSED: 403,
	RECORD_NOT_FOUND: 404,
	VIEWER_OWNER_UNKNOWN: 409,
	INTERNAL_ERROR: 500,
	DEPENDENCY_UNAVAILABLE: 503,
	DEPENDENCY_NOT_PROVISIONED: 503,
} as const;
type Dependency = "read_access" | "read_source" | "read_credential";
type RefusalBody = {
	error: keyof typeof STATUS;
	detail?: { parameter: string; reason?: string; limit?: number };
	dependency?: Dependency;
};

export class BusinessRefusal {
	readonly body: RefusalBody;
	readonly status: (typeof STATUS)[keyof typeof STATUS];
	constructor(body: RefusalBody) {
		this.body = body;
		this.status = STATUS[body.error];
	}
}

export const invalid = (detail: NonNullable<RefusalBody["detail"]>) =>
	new BusinessRefusal({ error: "QUERY_INVALID", detail });

// The old reader's SQLSTATE and driver codes for a read it could not run.
const UNPROVISIONED = new Map<string, Dependency>([
	["42501", "read_access"],
	["42P01", "read_source"],
	["42703", "read_source"],
	["3F000", "read_source"],
	["3D000", "read_source"],
	["28000", "read_credential"],
	["28P01", "read_credential"],
]);
const UNAVAILABLE = new Set([
	"ECONNRESET",
	"ECONNREFUSED",
	"ETIMEDOUT",
	"ENOTFOUND",
	"08000",
	"57P01",
]);

export function refusalOf(error: unknown) {
	if (error instanceof BusinessRefusal) return error;
	const code =
		typeof error === "object" && error !== null && "code" in error
			? String(error.code)
			: "";
	const dependency = UNPROVISIONED.get(code);
	if (dependency)
		return new BusinessRefusal({
			error: "DEPENDENCY_NOT_PROVISIONED",
			dependency,
		});
	if (UNAVAILABLE.has(code))
		return new BusinessRefusal({ error: "DEPENDENCY_UNAVAILABLE" });
	console.warn("read failed:", failureKind(error));
	return new BusinessRefusal({ error: "INTERNAL_ERROR" });
}

const DATASETS = {
	clients: {
		source: "client",
		source_ref: "client+party+client_status+client_type",
		note: "Status and ETL are what someone entered on this record. They are shown as entered, and they are not proof that an agreement was signed or that anyone was put on the work.",
	},
	vendors: {
		source: "vendor",
		source_ref: "vendor+party+vendor_category+vendor_stage+vendor_disposition",
		note: "Stage, disposition and relationship level are what someone entered on this record. They are shown as entered, and they are not proof of a commitment either way.",
	},
};
const FRESH_FOR_MS = 60_000;
const NOT_IN_THIS_READ = [
	"assignments",
	"negotiations",
	"deals",
	"email",
	"documents",
	"history",
];

type Column = RawBuilder<unknown>;
type ActiveDeal = { id: string; name: string };

const oldActiveDeals = sql<ActiveDeal[]>`coalesce((
	select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name, d.id)
	from deal d where d.client_id = c.id and d.outcome is null
		and d.closed_on is null and d.invoiced_on is null
		and d.phase not in ('closed', 'invoiced', 'dead')
), '[]'::jsonb)`;

function nextActiveDeals(db: Transaction<NextDB>): RawBuilder<ActiveDeal[]> {
	const deals = selectNextDeals(db)
		.whereRef("c.party_id", "=", sql.ref("client.party_id"))
		.as("deals");
	return sql`coalesce((
		select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name, id)
		from ${deals} where ${isOpenBoardDeal}
	), '[]'::jsonb)`;
}

const lastDealAt = sql<
	string | null
>`(select max(d.closed_on) from deal d where d.client_id = c.id)`;
const ORDER = {
	name: sql`lower(p.name) asc, c.id asc`,
	recent: sql`c.updated_at desc, c.id asc`,
	vertical: sql`lower(c.vertical) asc nulls last, lower(p.name), c.id`,
	deal_type: sql`lower(c.deal_type_label) asc nulls last, lower(p.name), c.id`,
	last_deal_desc: sql`${lastDealAt} desc nulls last, lower(p.name), c.id`,
	last_deal_asc: sql`${lastDealAt} asc nulls last, lower(p.name), c.id`,
};

const nextClientDataset = {
	...DATASETS.clients,
	note: "Status reflects the client's deals and their recorded relationship status.",
};

const source = (
	dataset: (typeof DATASETS)[Dataset],
	{ observedAt, correlationId }: Stamp,
) => ({
	source: dataset.source,
	source_ref: dataset.source_ref,
	observed_at: observedAt.toISOString(),
	valid_until: new Date(observedAt.valueOf() + FRESH_FOR_MS).toISOString(),
	freshness: "fresh",
	correlation_id: correlationId,
	safe_explanation:
		"Fresh because this is a no-store request-time canonical database read of live business records; valid for 60 seconds.",
});

// The old list envelope, with the rows, facets and partial signal in between.
export function listAnswer<
	Body extends { rows: unknown[]; facets: object; partial: object | null },
>(
	viewer: string,
	query: ListQuery<Dataset, string>,
	total: number,
	body: Body,
	stamp: Stamp,
	dataset = DATASETS[query.dataset],
) {
	const page_count = Math.max(1, Math.ceil(total / PAGE_SIZE));
	return {
		viewer,
		dataset: query.dataset,
		query,
		total,
		page: query.page,
		page_size: PAGE_SIZE,
		page_count,
		out_of_range: query.page > page_count,
		...body,
		recorded_field_note: dataset.note,
		source: source(dataset, stamp),
	};
}

// The old single-record envelope.
export const recordAnswer = <Row>(
	dataset: Dataset,
	viewer: string,
	record: Row,
	partial: object | null,
	stamp: Stamp,
	metadata = DATASETS[dataset],
) => ({
	viewer,
	dataset,
	record,
	partial,
	not_in_this_read: NOT_IN_THIS_READ,
	recorded_field_note: metadata.note,
	source: source(metadata, stamp),
});

const PIPELINE = { active: true, other: false, unknown: null } as const;

const liveClients = (db: Kysely<DB>) =>
	db
		.selectFrom("client as c")
		.innerJoin("party as p", "p.id", "c.party_id")
		.leftJoin("client_status as cs", "cs.slug", "c.status")
		.leftJoin("client_type as ct", "ct.slug", "c.client_type")
		.where("c.merged_into", "is", null)
		.where("p.merged_into", "is", null)
		.where("p.deleted_at", "is", null);
export const partnerId = (db: Kysely<DB>, slug: string) =>
	db.selectFrom("actor").select("id").where("slug", "=", slug);

// Null, not false, when the record has an owner and the viewer has no actor row.
export const ownedByViewer = (owner: Column, viewerId: string | null) =>
	sql<boolean | null>`(${owner} is not null and ${owner} = ${viewerId}::uuid)`;

// The searcher's %, _ and \ match themselves.
const directoryTerm = (q: string) => `%${q.replace(/([\\%_])/g, "\\$1")}%`;

export function searched(q: string, ref: Column) {
	const term = directoryTerm(q);
	return sql<boolean>`(p.name ilike ${term} escape '\\' or ${ref} ilike ${term} escape '\\' or p.ref ilike ${term} escape '\\')`;
}

// The legacy shape, for a caller that names no contract.
const shaped = <Row extends { last_deal_at: unknown; deal_type: unknown }>(
	row: Row,
	contract: Contract | null | undefined,
) => {
	if (contract) return row;
	const { last_deal_at: _, deal_type: __, ...legacy } = row;
	return legacy;
};

export const viewerIdOf = async (db: Kysely<DB>, viewer: string) =>
	(await partnerId(db, viewer).executeTakeFirst())?.id ?? null;

function matchingClients(db: Kysely<DB>, query: ClientQuery, viewer: string) {
	const { q, owner, status, type, pipeline } = query;
	let clients = liveClients(db);
	if (query.scope === "mine")
		clients = clients.where("c.owner_id", "=", partnerId(db, viewer));
	if (owner !== "all")
		clients = clients.where("c.owner_id", "=", partnerId(db, owner));
	if (q !== null) clients = clients.where(searched(q, sql.ref("c.roster_ref")));
	if (status !== null) clients = clients.where("c.status", "=", status);
	if (type !== null) clients = clients.where("c.client_type", "=", type);
	if (pipeline !== "any")
		clients = clients.where("cs.is_active_pipeline", "is", PIPELINE[pipeline]);
	return clients;
}

export async function readClientList(
	db: Kysely<DB>,
	viewer: string,
	query: ClientQuery,
	stamp: Stamp,
) {
	const ownerId = await viewerIdOf(db, viewer);
	const matching = matchingClients(db, query, viewer);
	const { total } = await matching
		.select(sql<number>`count(*)::int`.as("total"))
		.executeTakeFirstOrThrow();
	const rows = await matching
		.select((eb) => [
			"c.id",
			"c.roster_ref as ref",
			"p.name",
			"p.kind as party_kind",
			"p.city",
			"p.state",
			"c.status as recorded_status",
			"cs.label as recorded_status_label",
			"cs.is_active_pipeline as recorded_status_active_pipeline",
			"c.etl_status as recorded_etl_status",
			"c.client_type as recorded_client_type",
			"ct.label as recorded_client_type_label",
			"c.vertical",
			lastDealAt.as("last_deal_at"),
			"c.deal_type_label as deal_type",
			"c.owner_label",
			ownedByViewer(sql.ref("c.owner_id"), ownerId).as("owned_by_viewer"),
			asText(eb.ref("c.updated_at")).as("updated_at"),
		])
		.$if(query.contract === "vendor-directory.v2", (q) =>
			q.select(oldActiveDeals.as("active_deals")),
		)
		.orderBy(ORDER[query.sort])
		.limit(PAGE_SIZE)
		.offset((query.page - 1) * PAGE_SIZE)
		.execute();
	const statuses = await db
		.selectFrom("client_status")
		.select(["slug", "label", "is_active_pipeline"])
		.orderBy("sort")
		.orderBy("slug")
		.execute();
	const types = await db
		.selectFrom("client_type")
		.select(["slug", "label"])
		.orderBy("label")
		.orderBy("slug")
		.execute();
	if (query.scope === "mine" && ownerId === null)
		throw new BusinessRefusal({ error: "VIEWER_OWNER_UNKNOWN" });
	return listAnswer(
		viewer,
		query,
		total,
		{
			rows: rows.map((row) => shaped(row, query.contract)),
			facets: { statuses, types },
			// The status and type foreign keys always find a label, so the old
			// signal for an unlabelled code is always null.
			partial: null,
		},
		stamp,
	);
}

export async function readClient(
	db: Kysely<DB>,
	viewer: string,
	id: string,
	contract: Contract | null,
	stamp: Stamp,
) {
	const ownerId = await viewerIdOf(db, viewer);
	const record = await liveClients(db)
		.where("c.id", "=", id)
		.select((eb) => [
			"c.id",
			"c.roster_ref as ref",
			"p.name",
			"p.kind as party_kind",
			"p.city",
			"p.state",
			"p.county",
			"p.title",
			"p.specialty",
			"p.npi",
			"p.phone",
			"p.cell",
			"p.email",
			"p.contact_state",
			"p.contact_state_reason",
			"p.contact_state_until",
			"p.contact_state_cadence",
			"c.status as recorded_status",
			"cs.label as recorded_status_label",
			"cs.is_active_pipeline as recorded_status_active_pipeline",
			"cs.note as recorded_status_note",
			"c.etl_status as recorded_etl_status",
			"c.client_type as recorded_client_type",
			"ct.label as recorded_client_type_label",
			"c.vertical",
			lastDealAt.as("last_deal_at"),
			"c.deal_type_label as deal_type",
			"c.subtype",
			"c.acquisition_source",
			"c.acquisition_detail",
			"c.contact_label",
			"c.deal_type_label",
			"c.specialty_type_label",
			"c.possible_duplicate_label",
			"c.notes",
			"c.owner_label",
			ownedByViewer(sql.ref("c.owner_id"), ownerId).as("owned_by_viewer"),
			"c.version as record_version",
			asText(eb.ref("c.created_at")).as("created_at"),
			asText(eb.ref("c.updated_at")).as("updated_at"),
		])
		.$if(contract === "vendor-directory.v2", (q) =>
			q.select(oldActiveDeals.as("active_deals")),
		)
		.executeTakeFirst();
	if (!record) throw new BusinessRefusal({ error: "RECORD_NOT_FOUND" });
	return recordAnswer("clients", viewer, shaped(record, contract), null, stamp);
}

const nextStatuses = [
	{ slug: "roster", label: "Roster", is_active_pipeline: false },
	{ slug: "cold", label: "Cold", is_active_pipeline: false },
	{ slug: "engaged", label: "Engaged", is_active_pipeline: true },
	{ slug: "active_deal", label: "Active deal", is_active_pipeline: true },
	{ slug: "paused", label: "Paused", is_active_pipeline: false },
	{ slug: "past_client", label: "Past client", is_active_pipeline: false },
];

const activeStatuses = nextStatuses
	.filter((status) => status.is_active_pipeline)
	.map((status) => status.slug);
const nextPipeline = sql<boolean>`cs.status in (${sql.join(activeStatuses)})`;
const nextClientType = sql<
	string | null
>`coalesce(account.role, client.client_type)`;
const clientRef = sql<string>`coalesce((
	select min(value) from outside_id where party_id = client.party_id
		and source = 'old_system_ref' and value like 'C-%' having count(*) = 1
), client.party_id::text)`;

const nextOrder = {
	name: sql`lower(p.name), client.party_id`,
	recent: sql`client.changed_at desc, client.party_id`,
	vertical: sql`lower(v.vertical) nulls last, lower(p.name), client.party_id`,
	deal_type: sql`lower(p.name), client.party_id`,
	last_deal_desc: sql`last_deal_at desc nulls last, lower(p.name), client.party_id`,
	last_deal_asc: sql`last_deal_at asc nulls last, lower(p.name), client.party_id`,
};

const nextClients = (db: Transaction<NextDB>) =>
	db
		.selectFrom("client")
		.innerJoin("party as p", "p.id", "client.party_id")
		.innerJoin("client_status as cs", "cs.party_id", "client.party_id")
		.leftJoin("client_type as ct", "ct.slug", "client.client_type")
		.leftJoin("party_role as account", (join) =>
			join
				.onRef("account.party_id", "=", "client.party_id")
				.on("account.role", "=", "national_account"),
		)
		.leftJoin("role as account_type", "account_type.slug", "account.role")
		.leftJoin("client_vertical as v", "v.party_id", "client.party_id")
		.leftJoin("party as owner", "owner.id", "client.owner_user_id");

type NextClients = ReturnType<typeof nextClients>;

const nextClientRows = (
	db: Transaction<NextDB>,
	clients: NextClients,
	viewerId: string | null,
) =>
	clients.select((eb) => [
		"client.party_id as id",
		clientRef.as("ref"),
		"p.name",
		sql<string>`case p.kind when 'company' then 'org' else p.kind end`.as(
			"party_kind",
		),
		"p.city",
		sql<null>`null`.as("state"),
		"cs.status as recorded_status",
		sql<string>`upper(left(cs.status, 1)) || replace(substr(cs.status, 2), '_', ' ')`.as(
			"recorded_status_label",
		),
		nextPipeline.as("recorded_status_active_pipeline"),
		sql<null>`null`.as("recorded_etl_status"),
		nextClientType.as("recorded_client_type"),
		eb.fn
			.coalesce("account_type.label", "ct.label")
			.as("recorded_client_type_label"),
		"v.vertical",
		sql<string | null>`(select max(closed_on) from ${selectNextDeals(db)
			.whereRef("c.party_id", "=", sql.ref("client.party_id"))
			.as("deals")})`.as("last_deal_at"),
		sql<null>`null`.as("deal_type"),
		"owner.name as owner_label",
		ownedByViewer(sql.ref("client.owner_user_id"), viewerId).as(
			"owned_by_viewer",
		),
		asText(eb.ref("client.changed_at")).as("updated_at"),
	]);

const nextPartnerId = (db: Transaction<NextDB>, slug: string) =>
	db.selectFrom("app_user").select("id").where("slug", "=", slug);

const currentAccountLocations = (db: Transaction<NextDB>) =>
	db
		.selectFrom("client_brand as b")
		.innerJoin("national_account as na", "na.party_id", "b.brand_id")
		.select(["b.location_id", "b.brand_id"])
		.where(
			sql<boolean>`daterange(b.started_on, b.ended_on) @> (now() at time zone 'America/Chicago')::date`,
		);

function matchingNextClients(
	db: Transaction<NextDB>,
	query: ClientQuery,
	viewer: string,
) {
	const { q, owner, status, type, pipeline } = query;
	let clients = nextClients(db);
	if (query.scope === "mine")
		clients = clients.where(
			"client.owner_user_id",
			"=",
			nextPartnerId(db, viewer),
		);
	if (owner !== "all")
		clients = clients.where(
			"client.owner_user_id",
			"=",
			nextPartnerId(db, owner),
		);
	if (q !== null) {
		const term = directoryTerm(q);
		clients = clients.where((eb) =>
			eb.or([eb("p.name", "ilike", term), eb(clientRef, "ilike", term)]),
		);
	}
	if (status !== null) clients = clients.where("cs.status", "=", status);
	if (type !== null) clients = clients.where(nextClientType, "=", type);
	if (pipeline !== "any")
		clients = clients.where(nextPipeline, "is", PIPELINE[pipeline]);
	const { practice_type, national_account } = query;
	if (practice_type === "") clients = clients.where("v.vertical", "is", null);
	else if (practice_type !== undefined)
		clients = clients.where(
			sql`lower(v.vertical)`,
			"=",
			practice_type.toLowerCase(),
		);
	if (national_account !== undefined)
		clients = clients.where(({ exists }) =>
			exists(
				currentAccountLocations(db)
					.whereRef("b.location_id", "=", sql.ref("client.party_id"))
					.$if(national_account !== "any", (q) =>
						q.where("b.brand_id", "=", national_account),
					),
			),
		);
	return clients;
}

// The three small counts under a tile; the rest of a tile's clients have no deal yet.
const mix = [
	sql<number>`count(*)::int`.as("total"),
	sql<number>`(count(*) filter (where cs.status = 'active_deal'))::int`.as(
		"open_deal",
	),
	sql<number>`(count(*) filter (where cs.status = 'past_client'))::int`.as(
		"past_client",
	),
];
type Mix = { total: number; open_deal: number; past_client: number };
const NONE: Mix = { total: 0, open_deal: 0, past_client: 0 };
const tile = ({ total, open_deal, past_client }: Mix) => ({
	total,
	open_deal,
	past_client,
	no_deal_yet: total - open_deal - past_client,
});

// Practice types are free text, so spellings that differ only in case share a tile.
async function readTiles(db: Transaction<NextDB>, clients: NextClients) {
	const types = await clients
		.select([
			sql<string | null>`mode() within group (order by v.vertical)`.as(
				"practice_type",
			),
			...mix,
		])
		.groupBy(sql`lower(v.vertical)`)
		.orderBy("total", "desc")
		.orderBy(sql`lower(v.vertical)`)
		.execute();
	const accounts = await clients
		.innerJoin(
			currentAccountLocations(db).as("a"),
			"a.location_id",
			"client.party_id",
		)
		.select([
			sql<number>`count(distinct a.brand_id)::int`.as("accounts"),
			...mix,
		])
		.executeTakeFirstOrThrow();
	const all = types.reduce(
		(sum, row) => ({
			total: sum.total + row.total,
			open_deal: sum.open_deal + row.open_deal,
			past_client: sum.past_client + row.past_client,
		}),
		NONE,
	);
	return {
		all: tile(all),
		national_accounts: { accounts: accounts.accounts, ...tile(accounts) },
		practice_types: types.flatMap(({ practice_type, ...counts }) =>
			practice_type === null ? [] : [{ practice_type, ...tile(counts) }],
		),
		not_set: tile(types.find((row) => row.practice_type === null) ?? NONE),
	};
}

export async function readNextClientList(
	db: Transaction<NextDB>,
	viewer: string,
	query: ClientQuery,
	stamp: Stamp,
) {
	const viewerId =
		(await nextPartnerId(db, viewer).executeTakeFirst())?.id ?? null;
	if (query.scope === "mine" && viewerId === null)
		throw new BusinessRefusal({ error: "VIEWER_OWNER_UNKNOWN" });
	const matching = matchingNextClients(db, query, viewer);
	const { total } = await matching
		.select(sql<number>`count(*)::int`.as("total"))
		.executeTakeFirstOrThrow();
	const rows = await nextClientRows(db, matching, viewerId)
		.$if(query.contract === "vendor-directory.v2", (q) =>
			q.select(nextActiveDeals(db).as("active_deals")),
		)
		.orderBy(nextOrder[query.sort])
		.limit(PAGE_SIZE)
		.offset((query.page - 1) * PAGE_SIZE)
		.execute();
	const types = await db
		.selectFrom("client_type")
		.select(["slug", "label"])
		.unionAll(
			db
				.selectFrom("role")
				.select(["slug", "label"])
				.where("slug", "=", "national_account"),
		)
		.orderBy("label")
		.orderBy("slug")
		.execute();
	return listAnswer(
		viewer,
		query,
		total,
		{
			rows: rows.map((row) => shaped(row, query.contract)),
			facets: { statuses: nextStatuses, types },
			...(query.tiles && { tiles: await readTiles(db, matching) }),
			partial: null,
		},
		stamp,
		nextClientDataset,
	);
}

export async function readNextClient(
	db: Transaction<NextDB>,
	viewer: string,
	id: string,
	contract: Contract | null,
	stamp: Stamp,
) {
	const viewerId =
		(await nextPartnerId(db, viewer).executeTakeFirst())?.id ?? null;
	const requestedUuid = UUID.test(id) ? id : null;
	const alias = db
		.selectFrom("outside_id")
		.select("party_id")
		.where("source", "=", requestedUuid ? "old_system" : "old_system_ref")
		.where("value", "=", requestedUuid?.toLowerCase() ?? id);
	const record = await nextClientRows(db, nextClients(db), viewerId)
		.where((eb) =>
			eb.or([
				eb("client.party_id", "=", requestedUuid),
				eb("client.party_id", "=", alias),
			]),
		)
		.$if(contract === "vendor-directory.v2", (q) =>
			q.select(nextActiveDeals(db).as("active_deals")),
		)
		.orderBy(sql`client.party_id = ${requestedUuid}::uuid`, "desc")
		.leftJoin("active_do_not_contact as dnc", "dnc.party_id", "client.party_id")
		.select((eb) => [
			sql<null>`null`.as("county"),
			sql<
				string | null
			>`(select min(title) from party_company where person_id = p.id
				and (started_on is null or started_on <= current_date)
				and (ended_on is null or ended_on > current_date) having count(distinct title) = 1)`.as(
				"title",
			),
			sql<string | null>`(select string_agg(s.label, ', ' order by s.label)
				from party_specialty ps join specialty s on s.slug = ps.specialty where ps.person_id = p.id)`.as(
				"specialty",
			),
			"p.npi",
			sql<
				string | null
			>`(select concat(number, ' x' || extension) from party_phone where party_id = p.id and label = 'work'
				order by is_primary desc, created_at, id limit 1)`.as("phone"),
			sql<
				string | null
			>`(select concat(number, ' x' || extension) from party_phone where party_id = p.id and label = 'mobile'
				order by is_primary desc, created_at, id limit 1)`.as("cell"),
			sql<string | null>`(select address from party_email where party_id = p.id
				order by is_primary desc, created_at, id limit 1)`.as("email"),
			sql<
				string | null
			>`case when dnc.party_id is not null then 'do_not_contact' end`.as(
				"contact_state",
			),
			"dnc.reason as contact_state_reason",
			asText(eb.ref("dnc.until_date")).as("contact_state_until"),
			sql<null>`null`.as("contact_state_cadence"),
			sql<null>`null`.as("recorded_status_note"),
			"v.subtype",
			"p.how_found as acquisition_source",
			"p.how_found_detail as acquisition_detail",
			sql<null>`null`.as("contact_label"),
			sql<null>`null`.as("deal_type_label"),
			sql<null>`null`.as("specialty_type_label"),
			sql<null>`null`.as("possible_duplicate_label"),
			sql<
				string | null
			>`(select string_agg(a.summary, E'\n\n' order by a.happened_at, a.id)
				from outside_id o join activity a on a.id = md5('old_system:client:' || o.value || ':notes')::uuid
				where o.source = 'old_system' and o.party_id = p.id)`.as("notes"),
			sql<null>`null`.as("record_version"),
			asText(eb.ref("client.created_at")).as("created_at"),
		])
		.executeTakeFirst();
	if (!record) throw new BusinessRefusal({ error: "RECORD_NOT_FOUND" });
	const names = await readOldRecordNames(db, [record.notes]);
	return recordAnswer(
		"clients",
		viewer,
		shaped(
			{
				...record,
				id: requestedUuid ?? record.id,
				party_id: record.id,
				notes: record.notes && nameOldRecords(record.notes, names),
				record_links: recordLinks(names),
			},
			contract,
		),
		null,
		stamp,
		nextClientDataset,
	);
}
