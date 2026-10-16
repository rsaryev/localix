/** `YYYY-MM-DD` as is, a month-only `YYYY-MM` as its first day; anything else is no date. */
export function normalizeReleaseDate(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value.trim());
	if (!match) return undefined;
	const date = `${match[1]}-${match[2]}-${match[3] ?? "01"}`;
	const parsed = new Date(`${date}T00:00:00Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date) ? date : undefined;
}

/** A unix-seconds catalog stamp (OpenRouter `created`, AI Gateway `released`) as `YYYY-MM-DD`. */
export function releaseDateFromUnixSeconds(value: unknown): string | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
	const date = new Date(value * 1000);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}
