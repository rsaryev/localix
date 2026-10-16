export function sameStrings(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function describeSetDifference(expected: readonly string[], actual: readonly string[]): string {
	const expectedSet = new Set(expected);
	const actualSet = new Set(actual);
	const missing = expected.filter((value) => !actualSet.has(value));
	const extra = actual.filter((value) => !expectedSet.has(value));
	return [missing.length > 0 ? `missing: ${missing.join(", ")}` : "", extra.length > 0 ? `extra: ${extra.join(", ")}` : ""]
		.filter(Boolean)
		.join("; ");
}

export function assertExactModelIds(label: string, expected: Iterable<string>, actual: Iterable<string>): void {
	const expectedIds = Array.from(new Set(expected)).sort();
	const actualIds = Array.from(new Set(actual)).sort();
	if (sameStrings(expectedIds, actualIds)) return;
	throw new Error(`${label} model IDs do not match (${describeSetDifference(expectedIds, actualIds)})`);
}
