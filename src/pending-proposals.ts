import type { Transaction } from "kysely";
import type { DB } from "./next-database.d.ts";

export const pendingProposals = (db: Transaction<DB>) =>
	db.selectFrom("proposal as p").where("p.status", "=", "pending");
