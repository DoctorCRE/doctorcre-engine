import { type Context, Hono } from "hono";
import { nextPartnerRead } from "../next-connection.ts";
import { type DatabaseEnv, type Reader, readSnapshot } from "../reader.ts";
import { isOneOf } from "../request-shape.ts";
import { UUID } from "../uuid.ts";
import {
	readNextVendor,
	readNextVendorList,
	readVendor,
	readVendorList,
	VENDOR_SORTS,
	type VendorQuery,
} from "../vendors/read.ts";
import {
	BusinessRefusal,
	type ClientQuery,
	CONTRACTS,
	type Contract,
	type Dataset,
	invalid,
	type ListQuery,
	PAGE_SIZE,
	PARTNERS,
	PIPELINES,
	readClient,
	readClientList,
	readNextClient,
	readNextClientList,
	refusalOf,
	SORTS,
	type Stamp,
} from "./read.ts";

const SHARED_FIELDS = [
	"contract",
	"viewer",
	"scope",
	"q",
	"sort",
	"page",
	"owner",
];
const LIST_FIELDS = {
	clients: [...SHARED_FIELDS, "status", "type", "pipeline"],
	vendors: [
		...SHARED_FIELDS,
		"category",
		"stage",
		"disposition",
		"territory",
		"quiet",
		"no_category",
	],
};
const RECORD_FIELDS = ["viewer", "contract"];
const SCOPES = ["team", "mine"] as const;
const OWNERS = ["all", ...PARTNERS] as const;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const PAGE = /^[1-9][0-9]{0,3}$/;
const MAX_PAGE = 200;
const MAX_SEARCH = 80;
// biome-ignore lint/suspicious/noControlCharactersInRegex: the old refusal of control characters
const CONTROL = /[\u0000-\u001f\u007f]/;

function checkFields(
	params: URLSearchParams,
	allowed: string[],
	viewer: string,
) {
	for (const key of params.keys())
		if (!allowed.includes(key))
			throw invalid({ parameter: key, reason: "unsupported" });
	// `viewer` is a label a bookmark may carry, never a selector.
	if (params.has("viewer") && params.get("viewer") !== viewer)
		throw new BusinessRefusal({ error: "AUTHORIZATION_REFUSED" });
}

function oneOf<T extends string, F>(
	params: URLSearchParams,
	key: string,
	allowed: readonly T[],
	fallback: F,
): T | F {
	const given = params.get(key);
	if (!given) return fallback;
	if (!isOneOf(allowed, given))
		throw invalid({ parameter: key, reason: "unsupported_value" });
	return given;
}

function slug(params: URLSearchParams, key: string) {
	const given = params.get(key);
	if (!given || given === "any") return null;
	if (!SLUG.test(given)) throw invalid({ parameter: key, reason: "malformed" });
	return given;
}

function search(params: URLSearchParams) {
	const q = params.get("q")?.trim();
	if (!q) return null;
	if (q.length > MAX_SEARCH)
		throw invalid({ parameter: "q", reason: "too_long", limit: MAX_SEARCH });
	if (CONTROL.test(q)) throw invalid({ parameter: "q", reason: "malformed" });
	return q;
}

function page(params: URLSearchParams) {
	const given = params.get("page");
	if (!given) return 1;
	if (!PAGE.test(given))
		throw invalid({ parameter: "page", reason: "malformed" });
	if (Number(given) > MAX_PAGE)
		throw invalid({
			parameter: "page",
			reason: "out_of_bounds",
			limit: MAX_PAGE,
		});
	return Number(given);
}

// Unlike the search, a territory is not trimmed and is refused without a reason.
function territory(params: URLSearchParams) {
	const given = params.get("territory") ?? "";
	if (given.length > MAX_SEARCH || CONTROL.test(given))
		throw invalid({ parameter: "territory" });
	return given || null;
}

function listQuery<D extends Dataset, Sort extends string>(
	dataset: D,
	params: URLSearchParams,
	viewer: string,
	sorts: readonly ("name" | Sort)[],
	defaultSort: "name" | Sort = "name",
): ListQuery<D, "name" | Sort> {
	checkFields(params, LIST_FIELDS[dataset], viewer);
	const contract = oneOf(params, "contract", CONTRACTS, null);
	return {
		dataset,
		...(contract ? { contract } : {}),
		scope: oneOf(params, "scope", SCOPES, "team"),
		q: search(params),
		owner: oneOf(params, "owner", OWNERS, "all"),
		territory: territory(params),
		sort: oneOf(params, "sort", sorts, defaultSort),
		page: page(params),
		page_size: PAGE_SIZE,
	};
}

const clientQuery = (params: URLSearchParams, viewer: string): ClientQuery => ({
	...listQuery("clients", params, viewer, SORTS),
	status: slug(params, "status"),
	type: slug(params, "type"),
	pipeline: oneOf(params, "pipeline", PIPELINES, "any"),
});

const vendorQuery = (
	params: URLSearchParams,
	viewer: string,
	defaultSort: VendorQuery["sort"],
): VendorQuery => ({
	...listQuery("vendors", params, viewer, VENDOR_SORTS, defaultSort),
	category: slug(params, "category"),
	stage: slug(params, "stage"),
	disposition: slug(params, "disposition"),
	// Absent unless asked, so an unfiltered list keeps its old echo.
	...(oneOf(params, "quiet", ["true"], null) && { quiet: true }),
	...(noCategory(params) && { no_category: true }),
});

function noCategory(params: URLSearchParams) {
	const asked = oneOf(params, "no_category", ["true"], null) !== null;
	if (asked && params.has("category"))
		throw invalid({ parameter: "no_category", reason: "unsupported" });
	return asked;
}

// The old door's correlation id: the caller's own, if it is a UUID.
function stampOf(c: Context<DirectoryEnv>): Stamp {
	const given = c.req.header("x-correlation-id")?.trim();
	return {
		observedAt: new Date(),
		correlationId:
			given && UUID.test(given) ? given.toLowerCase() : crypto.randomUUID(),
	};
}

type DirectoryEnv = DatabaseEnv & {
	Bindings: { DIRECTORY_READ_SCHEMA?: string };
};
type LegacyRead = (db: Reader, stamp: Stamp) => Promise<object>;
type NextReader = Parameters<typeof readNextClient>[0];
type NextRead = (db: NextReader, stamp: Stamp) => Promise<object>;

// The old door checked its database, then the query, then the partner.
async function answer(
	c: Context<DirectoryEnv>,
	parse: (
		params: URLSearchParams,
		viewer: string,
	) => LegacyRead | { next: NextRead },
) {
	const viewer = c.get("partner").slug;
	const database = c.env.DATABASE;
	try {
		if (!database)
			throw new BusinessRefusal({ error: "DEPENDENCY_UNAVAILABLE" });
		const read = parse(new URL(c.req.url).searchParams, viewer);
		if (!isOneOf(PARTNERS, viewer))
			throw new BusinessRefusal({ error: "AUTHORIZATION_REFUSED" });
		const stamp = stampOf(c);
		return c.json(
			typeof read === "function"
				? await readSnapshot(database.connectionString, (db) => read(db, stamp))
				: await nextPartnerRead(database.connectionString, viewer, (db) =>
						read.next(db, stamp),
					),
		);
	} catch (error) {
		const refusal = refusalOf(error);
		return c.json(refusal.body, refusal.status);
	}
}

export const directory = new Hono<DirectoryEnv>();

directory.get("/clients", (c) =>
	answer(c, (params, viewer) => {
		const query = clientQuery(params, viewer);
		if (c.env.DIRECTORY_READ_SCHEMA === "next")
			return {
				next: (db, stamp) => readNextClientList(db, viewer, query, stamp),
			};
		return (db, stamp) => readClientList(db, viewer, query, stamp);
	}),
);
type RecordRead<Db> = (
	db: Db,
	viewer: string,
	id: string,
	contract: Contract | null,
	stamp: Stamp,
) => Promise<object>;

async function record(
	c: Context<DirectoryEnv>,
	id: string,
	read: RecordRead<Reader>,
	readNext?: RecordRead<NextReader>,
) {
	const next = c.env.DIRECTORY_READ_SCHEMA === "next" ? readNext : undefined;
	if (!UUID.test(id) && !(next && (id.startsWith("C-") || id.startsWith("V-"))))
		return c.json({ error: "not_found" }, 404);
	return answer(c, (params, viewer) => {
		checkFields(params, RECORD_FIELDS, viewer);
		const contract = oneOf(params, "contract", CONTRACTS, null);
		if (next)
			return { next: (db, stamp) => next(db, viewer, id, contract, stamp) };
		return (db, stamp) => read(db, viewer, id, contract, stamp);
	});
}

// Values are decoded, so only the pattern keeps an encoded id from passing as a UUID.
const UUID_SEGMENT = "[0-9A-Fa-f-]+";

directory.get(`/clients/:id{(?:${UUID_SEGMENT}|C-[^/]+)}`, (c) =>
	record(c, c.req.param("id"), readClient, readNextClient),
);
directory.get("/vendors", (c) =>
	answer(c, (params, viewer) => {
		const next = c.env.DIRECTORY_READ_SCHEMA === "next";
		// The old list keeps its old default and echo.
		const query = vendorQuery(params, viewer, next ? "relationship" : "name");
		if (next)
			return {
				next: (db, stamp) => readNextVendorList(db, viewer, query, stamp),
			};
		if (query.quiet)
			throw invalid({ parameter: "quiet", reason: "unsupported" });
		if (query.no_category)
			throw invalid({ parameter: "no_category", reason: "unsupported" });
		return (db, stamp) => readVendorList(db, viewer, query, stamp);
	}),
);
directory.get(`/vendors/:id{(?:${UUID_SEGMENT}|V-[^/]+)}`, (c) =>
	record(c, c.req.param("id"), readVendor, readNextVendor),
);
