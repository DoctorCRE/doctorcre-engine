import { Hono } from "hono";
import {
	answer,
	answerNextRead,
	checkFields,
	Refusal,
	refuse,
} from "../answer.ts";
import { failureKind } from "../failure.ts";
import { type DatabaseEnv, readSnapshot } from "../reader.ts";
import { isUuid } from "../uuid.ts";
import { readBoard, WORKSPACES } from "./board.ts";
import { readCalendarDates, readNextCalendarDates } from "./calendar.ts";
import { readCaptureQueue } from "./capture-queue.ts";
import { decodeCursor, readChanges } from "./changes.ts";
import { readClientFit } from "./client-fit.ts";
import { readDealDetail } from "./detail.ts";
import { readNextBoard } from "./next-board.ts";
import {
	readNextDealDetail,
	readNextDealDocumentText,
	readNextDealEmailThread,
} from "./next-detail.ts";
import { lookupRefusal } from "./resolve.ts";

export const dealSourceReads = new Hono<DatabaseEnv>()
	.get(
		"/deals/:deal/documents/:document/text",
		async (c): Promise<Response> => {
			const refused = checkFields(new URL(c.req.url).searchParams, []);
			if (refused) return refuse(c, refused);
			const { deal, document } = c.req.param();
			if (!isUuid(deal) || !isUuid(document))
				return refuse(c, new Refusal(404, "not_found"));
			return answerNextRead(
				c,
				"read-deal-document-text",
				async (db) =>
					(await readNextDealDocumentText(db, { deal, document })) ??
					new Refusal(404, "not_found"),
			);
		},
	)
	.get("/deals/:deal/emails/:email", async (c): Promise<Response> => {
		const refused = checkFields(new URL(c.req.url).searchParams, []);
		if (refused) return refuse(c, refused);
		const { deal, email } = c.req.param();
		if (!isUuid(deal) || !isUuid(email))
			return refuse(c, new Refusal(404, "not_found"));
		return answerNextRead(
			c,
			"read-deal-email-thread",
			async (db, userId) =>
				(await readNextDealEmailThread(db, userId, { deal, email })) ??
				new Refusal(404, "not_found"),
		);
	});

export const deals = new Hono<
	DatabaseEnv & {
		Bindings: { DEALS_READ_SCHEMA?: string };
	}
>();

deals.get("/deals", async (c): Promise<Response> => {
	const params = new URL(c.req.url).searchParams;
	const refused = checkFields(params, ["workspace", "account_client_id"], {
		vocabularies: { workspace: WORKSPACES },
	});
	if (refused) return refuse(c, refused);
	const given = params.get("workspace");
	const input = {
		partner: c.get("partner").slug,
		workspace: WORKSPACES.find((workspace) => workspace === given) ?? "all",
		account_client_id: params.get("account_client_id"),
	};
	return c.env.DEALS_READ_SCHEMA === "next"
		? answerNextRead(c, "deal-room-board", (db) => readNextBoard(db, input))
		: answer(c, "deal-room-board", (db) => readBoard(db, input));
});

deals.get("/calendar/critical-dates", async (c): Promise<Response> => {
	const refused = checkFields(new URL(c.req.url).searchParams, []);
	if (refused) return refuse(c, refused);
	return c.env.DEALS_READ_SCHEMA === "next"
		? answerNextRead(c, "calendar-critical-dates", readNextCalendarDates)
		: answer(c, "calendar-critical-dates", readCalendarDates);
});

// The deal page's argument is its path, never a query field.
function dealArguments(url: string, deal?: string) {
	const params = new URL(url).searchParams;
	params.delete("deal");
	if (deal !== undefined) params.set("deal", deal);
	return params;
}

deals.get("/deals/", (c) =>
	refuse(
		c,
		checkFields(dealArguments(c.req.url), ["deal"]) ??
			new Refusal(400, "missing_required", { fields: ["deal"] }),
	),
);

deals.get("/deals/:deal{.+}", async (c): Promise<Response> => {
	const deal = c.req.param("deal");
	const refused = checkFields(dealArguments(c.req.url, deal), ["deal"]);
	if (refused) return refuse(c, refused);
	if (c.env.DEALS_READ_SCHEMA === "next") {
		return answerNextRead(c, "get-deal-room", async (db, userId) => {
			const detail = isUuid(deal)
				? await readNextDealDetail(db, deal, userId)
				: null;
			return !detail || "error" in detail
				? new Refusal(404, "not_found")
				: detail;
		});
	}
	return answer(c, "get-deal-room", async (db) => {
		const detail = await readDealDetail(db, deal);
		if (!("error" in detail)) return detail;
		return detail.error === "not_found"
			? new Refusal(404, "not_found")
			: lookupRefusal(detail);
	});
});

deals.get("/client-fit", async (c) => {
	const params = new URL(c.req.url).searchParams;
	const refused = checkFields(params, ["vertical", "city", "state"]);
	if (refused) return refuse(c, refused);
	return answerNextRead(c, "ideal-client-profile", async (db) => {
		const fit = await readClientFit(db, {
			vertical: params.get("vertical") || null,
			city: params.get("city") || null,
			state: params.get("state") || null,
		});
		// The old system's limit error was not public, so it answered generically.
		return "error" in fit ? new Refusal(422, "unhandled_verb_failure") : fit;
	});
});

deals.get("/capture-queue", async (c) => {
	const refused = checkFields(new URL(c.req.url).searchParams, []);
	return refused
		? refuse(c, refused)
		: answer(c, "capture-queue", readCaptureQueue);
});

// The old feed checked the partner, then the method, then the cursor, ignored
// any other query field and answered with bare error bodies.
deals.all("/pipeline/changes", async (c) => {
	if (c.req.method !== "GET")
		return c.json({ error: "method_not_allowed" }, 405);
	const given = new URL(c.req.url).searchParams.get("cursor") || "";
	const after = given ? decodeCursor(given) : null;
	if (after === undefined) return c.json({ error: "invalid_cursor" }, 400);
	const database = c.env.DATABASE;
	try {
		if (database)
			return c.json(
				await readSnapshot(database.connectionString, (db) =>
					readChanges(db, after, given),
				),
			);
	} catch (error) {
		console.warn("read failed:", failureKind(error));
	}
	// The old feed answered any failure this way, a missing database included.
	return refuse(c, new Refusal(503, "database_unavailable"));
});
