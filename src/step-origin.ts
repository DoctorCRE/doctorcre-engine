import { sql, type Transaction } from "kysely";
import type { DB, JsonObject } from "./next-database.d.ts";
import { asText } from "./reader.ts";

export const selectStepsWithOrigin = (db: Transaction<DB>) =>
	db
		.selectFrom("next_step as s")
		.leftJoinLateral(
			(eb) =>
				eb
					.selectFrom("change as creation")
					.select(["creation.changed_by_user_id", "creation.changed_by_job"])
					.where("creation.table_name", "=", "next_step")
					.where(
						"creation.record",
						"=",
						sql<JsonObject>`jsonb_build_object('id', s.id)`,
					)
					.where("creation.action", "=", "insert")
					.orderBy("creation.id")
					.limit(1)
					.as("origin"),
			(join) => join.onTrue(),
		)
		.leftJoin("party as setter", "setter.id", "origin.changed_by_user_id")
		.leftJoin("proposal as accepted", (join) =>
			join
				.onRef("accepted.id", "=", "s.id")
				.on("accepted.kind", "=", "next_step")
				.on("accepted.status", "=", "accepted"),
		)
		.select([
			"setter.name as set_by",
			asText(sql.ref("s.created_at")).as("set_at"),
			sql<string | null>`case
				when s.call_activity_id is not null then 'call'
				when accepted.activity_kind is not null then accepted.activity_kind
				when origin.changed_by_job = 'cadence' then 'cadence'
			end`.as("set_from"),
		]);

export type StepOrigin = Awaited<
	ReturnType<ReturnType<typeof selectStepsWithOrigin>["execute"]>
>[number];
