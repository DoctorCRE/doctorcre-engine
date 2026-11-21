import { sql, type Transaction } from "kysely";
import { BusinessRefusal, readNextClient } from "./clients/read.ts";
import type { JsonObject } from "./database.d.ts";
import { readNextDealDetail } from "./deals/next-detail.ts";
import { readNextLeadDetail } from "./leads/detail.ts";
import type { DB } from "./next-database.d.ts";
import { readSearchRecords } from "./search/records.ts";

export type RecordKind = "deal" | "lead" | "client";
export type Source = {
	ref: { kind: RecordKind; id: string };
	label: string;
	href: string;
};

const recordLink = {
	deal: "/deals?deal=",
	lead: "/leads?lead=",
	client: "/clients?record=",
};

function match(
	kind: RecordKind,
	id: string,
	name: string,
	key = id,
	city: string | null = null,
) {
	return {
		ref: { kind, id },
		label: name,
		href: recordLink[kind] + encodeURIComponent(key),
		city,
	};
}

export async function findDocRecords(
	db: Transaction<DB>,
	query: string,
	kind: RecordKind | "all",
) {
	const { deals, parties } = await readSearchRecords(db, query);
	if (!deals || !parties) throw new Error("Doc search returned no result");
	const include = (candidate: RecordKind) =>
		kind === "all" || kind === candidate;
	const matches = include("deal")
		? deals.map(({ id, name }) => match("deal", id, name))
		: [];
	for (const { id, name, city, lead_id, roles } of parties) {
		if (lead_id && include("lead"))
			matches.push(match("lead", id, name, lead_id, city));
		if (roles.includes("client") && include("client"))
			matches.push(match("client", id, name, id, city));
	}
	return matches.slice(0, 10);
}

async function recordFacts(
	db: Transaction<DB>,
	source: Source,
	partner: string,
) {
	const { kind, id } = source.ref;
	switch (kind) {
		case "deal": {
			const deal = await readNextDealDetail(db, id);
			return "error" in deal ? null : { owner: deal.owner, phase: deal.phase };
		}
		case "lead": {
			const lead = await readNextLeadDetail(db, id, {
				correspondence: null,
				stageHistory: null,
			});
			if (lead.error) throw new Error("Doc lead read failed");
			if (!("detail" in lead) || !lead.detail) return null;
			return {
				owner: lead.detail.owner_label ?? null,
				stage: lead.detail.stage_label ?? lead.detail.stage,
			};
		}
		case "client": {
			try {
				const { record } = await readNextClient(db, partner, id, null, {
					observedAt: new Date(),
					correlationId: crypto.randomUUID(),
				});
				return { owner: record.owner_label, status: record.recorded_status };
			} catch (error) {
				if (
					error instanceof BusinessRefusal &&
					error.body.error === "RECORD_NOT_FOUND"
				)
					return null;
				throw error;
			}
		}
	}
}

export async function readDocRecord(
	db: Transaction<DB>,
	source: Source,
	partner: string,
) {
	const facts = await recordFacts(db, source, partner);
	if (!facts) return null;
	const {
		ref: { kind, id },
		label: name,
	} = source;
	const target = kind === "deal" ? "deal_id" : "party_id";
	const targetColumn = sql.ref(target);
	const {
		rows: [related],
	} = await sql<JsonObject>`
		select
			(select coalesce(jsonb_agg(to_jsonb(step)), '[]') from (
				select s.what, s.due_on, owner.name as owner
				from next_step s left join party owner on owner.id = s.owner_party_id
				where s.${targetColumn} = ${id} and s.status = 'open'
				order by s.due_on, s.id
			) step) as next_steps,
			(select coalesce(jsonb_agg(to_jsonb(entry)), '[]') from (
				select a.kind, a.happened_at, a.summary
				from activity_about link join activity a on a.id = link.activity_id
				where link.${targetColumn} = ${id} and a.kind <> 'email' and a.summary is not null
				order by a.happened_at desc, a.id desc limit 5
			) entry) as activity
	`.execute(db);
	return { name, ...facts, ...related };
}
