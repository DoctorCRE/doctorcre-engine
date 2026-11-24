import { Refusal } from "./answer.ts";
import { isCalendarDate } from "./calendar-date.ts";
import type { JsonObject } from "./database.d.ts";
import { isArguments } from "./save-door.ts";
import { UUID } from "./uuid.ts";

export type Check<T> = (value: unknown) => value is T;
export type Shape = Readonly<Record<string, Check<unknown>>>;
type Checked<C> = C extends Check<infer T> ? T : never;
type Leavable<S extends Shape> = {
	[K in keyof S]: undefined extends Checked<S[K]> ? K : never;
}[keyof S];
// A field the shape lets a caller leave out is an optional property.
export type Fitted<S extends Shape> = {
	[K in Exclude<keyof S, Leavable<S>>]: Checked<S[K]>;
} & { [K in Leavable<S>]?: Exclude<Checked<S[K]>, undefined> };

export const isText: Check<string> = (value): value is string =>
	typeof value === "string" && value.trim() !== "";
export const isStoredText: Check<string> = (value): value is string =>
	isText(value) && !value.includes("\0");
export const isUuid: Check<string> = (value): value is string =>
	typeof value === "string" && UUID.test(value);
export const isChangeId: Check<number> = (value): value is number =>
	Number.isSafeInteger(value) && Number(value) >= 0;
export const isAmount: Check<number> = (value): value is number =>
	typeof value === "number" && Number.isFinite(value);
export const isBoolean: Check<boolean> = (value): value is boolean =>
	typeof value === "boolean";
// A moment with its zone, such as 2026-01-05T15:00:00Z.
export const isInstant: Check<string> = (value): value is string =>
	typeof value === "string" &&
	/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-](0\d|1[0-5]):[0-5]\d)$/.test(value) &&
	!value.startsWith("0000-") &&
	isCalendarDate(value.slice(0, 10)) &&
	Number.isFinite(Date.parse(value));
export const isOneOf = <T extends string | number>(
	allowed: readonly T[],
	value: unknown,
): value is T => (allowed as readonly unknown[]).includes(value);
export const optional =
	<T>(check: Check<T>): Check<T | undefined> =>
	(value): value is T | undefined =>
		value === undefined || check(value);
export const orNull =
	<T>(check: Check<T>): Check<T | null> =>
	(value): value is T | null =>
		value === null || check(value);
// A field a caller may leave out or clear.
export const clearable = <T>(check: Check<T>) => optional(orNull(check));

// A value's fields that break its shape, and any field the shape does not name.
const misfits = (value: JsonObject, shape: Shape) => [
	...Object.entries(shape)
		.filter(([name, check]) => !check(value[name]))
		.map(([name]) => name),
	...Object.keys(value).filter((name) => !Object.hasOwn(shape, name)),
];
export const fitting =
	<S extends Shape>(shape: S): Check<Fitted<S>> =>
	(value): value is Fitted<S> =>
		isArguments(value) && misfits(value, shape).length === 0;

// A request missing `required` fields, or all of `oneOf`, or breaking its shape, is refused with their names.
export function fit<S extends Shape>(
	body: JsonObject,
	shape: S,
	required: readonly (keyof S & string)[],
	oneOf: readonly (keyof S & string)[] = [],
): Refusal | Fitted<S> {
	const absent = (name: string) => body[name] === undefined;
	const missing = [
		...required.filter(absent),
		...(oneOf.every(absent) ? oneOf : []),
	];
	if (missing.length)
		return new Refusal(400, "missing_required", { fields: missing });
	if (!fitting(shape)(body))
		return new Refusal(400, "invalid_field_value", {
			fields: misfits(body, shape),
		});
	return body;
}
