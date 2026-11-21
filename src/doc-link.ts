import { createHash } from "node:crypto";
import { sql } from "kysely";
import { nextTransaction } from "./next-connection.ts";

export function credentialHash(credential: string) {
	return createHash("sha256").update(credential).digest("hex");
}

export function readDocLinkHash(authorization: string | undefined) {
	const credential = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i)?.[1];
	return credential && credentialHash(credential);
}

export function docLinkRefusal(status: 401 | 426 | 503) {
	const error = {
		401: "unauthorized",
		426: "websocket_required",
		503: "doc_link_unavailable",
	}[status];
	return Response.json(
		{ error },
		{
			status,
			headers: { "Cache-Control": "no-store" },
		},
	);
}

export function findDocLinkOwner(connection: string, hash: string) {
	return nextTransaction(connection, "save", async (tx) => {
		await sql`select set_config('engine.doc_link_hash', ${hash}, true)`.execute(
			tx,
		);
		const link = await tx
			.selectFrom("doc_link")
			.select("owner_user_id")
			.where("credential_hash", "=", hash)
			.executeTakeFirst();
		return link?.owner_user_id;
	});
}
