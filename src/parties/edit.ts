import { Refusal } from "../answer.ts";
import type { JsonObject } from "../database.d.ts";
import { type Check, fitting, optional, orNull } from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";

type Seen = string | number | boolean | string[] | null;

// A copied value may be blank, so what a partner saw is any value of the field's kind.
const isSeen = (value: unknown): value is Seen =>
	value === null ||
	(typeof value === "string" && !value.includes("\0")) ||
	typeof value === "number" ||
	typeof value === "boolean" ||
	(Array.isArray(value) && value.every((item) => typeof item === "string"));

// A field a partner changes names the value they saw, so a change made since is not overwritten.
export const edit = <T>(check: Check<T>) =>
	optional(fitting({ from: isSeen, to: orNull(check) }));

export const trimmed = (value: unknown) =>
	typeof value === "string" ? value.trim() || null : value;

const same = (seen: unknown, current: unknown) =>
	JSON.stringify(Array.isArray(seen) ? [...seen].sort() : trimmed(seen)) ===
	JSON.stringify(
		Array.isArray(current) ? [...current].sort() : trimmed(current),
	);

// The fields a request changes, refused together with the current record if any changed since.
export function unchangedSince<Field extends string>(
	request: Partial<Record<Field, { from: unknown } | undefined>>,
	fields: readonly Field[],
	current: Record<Field, unknown> & JsonObject,
) {
	const stale = fields.filter(
		(field) => !same(request[field]?.from, current[field]),
	);
	if (stale.length)
		throw new SaveRefusal(
			new Refusal(409, "version_conflict", { fields: stale, current }),
		);
}

export const changing = <Field extends string>(
	request: Partial<Record<Field, unknown>>,
	fields: readonly Field[],
) => fields.filter((field) => request[field] !== undefined);
