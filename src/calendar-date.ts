export function isCalendarDate(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
		return false;
	const time = Date.parse(`${value}T00:00:00Z`);
	return (
		Number.isFinite(time) && new Date(time).toISOString().startsWith(value)
	);
}

// A moment with its zone, on a day that exists.
export const isInstant = (value: unknown): value is string =>
	typeof value === "string" &&
	/T.*(Z|[+-]\d\d:\d\d)$/.test(value) &&
	isCalendarDate(value.slice(0, 10)) &&
	!Number.isNaN(Date.parse(value));
