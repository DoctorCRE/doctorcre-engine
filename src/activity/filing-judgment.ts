import { sql, type Transaction } from "kysely";
import { z } from "zod";
import type { DB } from "../next-database.d.ts";
import { sortedHash } from "../save.ts";
import { UUID } from "../uuid.ts";
import {
	eligibleMailLinks,
	filingReceiptKey,
	filingReviewEvidence,
	filingReviewNeeded,
	hasFiledFacts,
	partnerSettledFiling,
} from "./filing-evidence.ts";
import { linkActivity, lockEmail, recordActivity } from "./next-record.ts";

export const filingDestination = z.strictObject({
	kind: z.enum(["deal", "vendor"]),
	id: z.string().regex(UUID),
});
type Destination = z.infer<typeof filingDestination>;
type Fact = { destination: Destination; text: string; quote: string };
type Filing = {
	id: string;
	activity_id: string;
	message_id: string | null;
	destinations: Destination[];
};

const about = ({ kind, id }: Destination) =>
	kind === "deal" ? { deal_id: id } : { party_id: id };

export async function saveFilingJudgment(
	tx: Transaction<DB>,
	job: Filing,
	facts: Fact[],
) {
	const source = job.activity_id;
	await lockEmail(tx, job.message_id ?? source);
	const sourceId = sql.val(source);
	const {
		rows: [email],
	} = await sql<{ happened_at: string }>`
		select to_jsonb(happened_at) #>> '{}' as happened_at
		from activity where id = ${source} and not exists (
			select from lead_email_source where activity_id = ${source}
		)
		and not ${hasFiledFacts(sourceId)} and not ${partnerSettledFiling(sourceId)}
	`.execute(tx);
	if (!email) return;

	const records = facts.map(({ destination }) => about(destination));
	const allowed = await eligibleMailLinks(tx, source, records, true);
	if (allowed.length !== facts.length) return;
	const links = await eligibleMailLinks(tx, source, records);
	const deal = facts.find(({ destination }) => destination.kind === "deal");
	const vendorIds = [
		...new Set(
			facts.flatMap(({ destination }) =>
				destination.kind === "vendor" ? [destination.id] : [],
			),
		),
	];
	const verifiedVendors =
		!vendorIds.length ||
		(
			await sql`select id from mail_sender_vendors(${source}) as vendor(id)
			where id = any(${vendorIds}::uuid[])`.execute(tx)
		).rows.length === vendorIds.length;
	const activeDeal =
		deal &&
		(await sql`select d.id from deal d where d.id = ${deal.destination.id}
		and coalesce((select phase from deal_phase_change where deal_id = d.id
			order by happened_at desc limit 1), '') not in ('closed', 'dead')
	`.execute(tx));
	if (
		!facts.length ||
		links.length !== facts.length ||
		!verifiedVendors ||
		activeDeal?.rows.length === 0
	) {
		const destinations = facts.length
			? allowed
			: await eligibleMailLinks(tx, source, job.destinations.map(about), true);
		if (!destinations.length) return;
		const offersDeal = destinations.some(
			(destination) => "deal_id" in destination,
		);
		const offersVendor = destinations.some(
			(destination) => "party_id" in destination,
		);
		const scope =
			offersDeal && offersVendor ? "both" : offersVendor ? "vendor" : "deal";
		await stampMailFiling(tx);
		await sql`insert into proposal (kind, activity_id, activity_kind, evidence, proposed_by_job, filing_scope)
			select 'possible_new_deal', ${source}, 'email', ${filingReviewEvidence}, 'mail_capture', ${scope}
			where not exists (select from proposal p where p.activity_id = ${source} and (
				p.kind = 'possible_new_deal' or (not ${offersVendor} and p.kind = 'file_to_deal' and p.status = 'pending'
					and ${filingReviewNeeded(sourceId, sql.ref("p.deal_id"))})
			)) on conflict do nothing`.execute(tx);
		return;
	}

	await stampMailFiling(tx);
	await linkActivity(tx, source, links);
	const key = filingReceiptKey(sourceId);
	const saved = [];
	for (const { destination, text, quote } of facts) {
		const { activity_id } = await recordActivity(tx, {
			idempotency_key: job.id,
			kind: "note",
			happened_at: email.happened_at,
			about: [about(destination)],
			summary: text,
			from_party_id: null,
			reached: null,
			email: null,
		});
		saved.push({ activity_id, destination, quote });
	}
	await tx
		.insertInto("save_receipt")
		.values({
			idempotency_key: key,
			verb: "file-email-facts",
			request_hash: sortedHash({ job_id: job.id, facts }),
			answer: {
				source_activity_id: source,
				job_id: job.id,
				deal_id: deal?.destination.id ?? null,
				facts: saved,
			},
		})
		.execute();
}

function stampMailFiling(tx: Transaction<DB>) {
	return sql`select set_config('engine.job', 'mail_capture', true)`.execute(tx);
}
