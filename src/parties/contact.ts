import { sql, type Transaction } from "kysely";
import type { DB } from "../next-database.d.ts";

export type Phone = { number: string; extension: string | null };

// A North American number typed any way is +1 and its ten digits. A trailing "x12" is its extension.
export function phoneNumber(typed: string): Phone | undefined {
	const [, main = "", extension] =
		typed.match(/^(.*?)(?:\s*(?:x|ext\.?)\s*(\d{1,6}))?$/i) ?? [];
	const digits = main.replace(/[\s().-]/g, "");
	const number = digits.startsWith("+")
		? digits
		: digits.replace(/^1?(\d{10})$/, "+1$1");
	return /^\+\d+$/.test(number)
		? { number, extension: extension ?? null }
		: undefined;
}

export type Contact = NonNullable<Awaited<ReturnType<typeof contactOf>>>;

// A person or company with its primary email and phone and, for a person, their current company.
export function contactOf(db: Transaction<DB>, party_id: string) {
	return db
		.selectFrom("party")
		.select(["id as party_id", "kind", "name", "city"])
		.select((eb) => [
			eb
				.selectFrom("party_email")
				.select("address")
				.whereRef("party_id", "=", "party.id")
				.where("is_primary", "=", true)
				.as("email"),
			eb
				.selectFrom("party_phone")
				.select(
					sql<Phone & { shown: string }>`jsonb_build_object('number', number,
						'extension', extension, 'shown', concat(number, ' x' || extension))`.as(
						"phone",
					),
				)
				.whereRef("party_id", "=", "party.id")
				.where("is_primary", "=", true)
				.as("phone"),
			eb
				.selectFrom("party_company as pc")
				.innerJoin("party as company", "company.id", "pc.company_id")
				.select(
					sql<{
						company_id: string;
						name: string;
						title: string | null;
					}>`jsonb_build_object('company_id', company.id, 'name', company.name, 'title', pc.title)`.as(
						"company",
					),
				)
				.whereRef("pc.person_id", "=", "party.id")
				.where("pc.ended_on", "is", null)
				.orderBy("pc.started_on", sql`desc nulls last`)
				.orderBy("pc.created_at", "desc")
				.limit(1)
				.as("company"),
		])
		.where("id", "=", party_id)
		.executeTakeFirst();
}
