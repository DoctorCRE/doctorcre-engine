import { Hono } from "hono";
import { answerNextRead, checkFields, Refusal, refuse } from "../answer.ts";
import { isOneOf, PARTNERS } from "../clients/read.ts";
import type { DatabaseEnv } from "../reader.ts";
import {
	type MeetingsQuery,
	pageAfter,
	readVendorMeetings,
	VIEWS,
} from "./meetings.ts";

export const vendorMeetings = new Hono<DatabaseEnv>();

// A repeated field stands for the old input's list, which the read refused.
function queryOf(params: URLSearchParams): MeetingsQuery | null {
	const [q = "", ...otherQ] = params.getAll("q");
	const [cursor, ...otherCursors] = params.getAll("cursor");
	const view =
		VIEWS.find((given) => given === params.get("view")) ?? "research";
	const limit = Number(params.get("limit") ?? 25);
	const valid =
		!otherQ.length &&
		!otherCursors.length &&
		q.length <= 80 &&
		Number.isInteger(limit) &&
		limit >= 1 &&
		limit <= 50;
	const after = valid && pageAfter(cursor, view, q);
	return after ? { view, q, limit, after } : null;
}

vendorMeetings.get("/vendor-meetings", async (c) => {
	const params = new URL(c.req.url).searchParams;
	const refused = checkFields(params, ["view", "q", "limit", "cursor"], {
		vocabularies: { view: VIEWS },
		numbers: ["limit"],
	});
	if (refused) return refuse(c, refused);
	if (!isOneOf(PARTNERS, c.get("partner").slug))
		return refuse(c, new Refusal(403, "AUTHORIZATION_REFUSED"));
	const query = queryOf(params);
	if (!query)
		return refuse(c, new Refusal(400, "vendor_meetings_query_invalid"));
	return answerNextRead(c, "read-vendor-meetings", async (db, userId) => {
		return (
			(await readVendorMeetings(db, userId, query)) ??
			new Refusal(500, "vendor_meetings_unavailable")
		);
	});
});
