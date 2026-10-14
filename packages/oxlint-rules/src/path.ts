/**
 * Path helpers for rules that key on WHERE a file lives.
 *
 * `context.filename` is absolute and platform-shaped. A rule that compares it directly is a rule
 * that passes on one machine and fails on another, so every path decision goes through here.
 */

/** Forward-slash form, so a suffix written in a rule reads the same on every platform. */
export function normalizePath(filename: string): string {
  return filename.replaceAll('\\', '/')
}

/** An entry in a rule's exemption list: the path that is allowed, and why it is allowed. */
export interface Exemption {
  /** Path suffix, forward-slash form, anchored at a directory boundary. */
  readonly suffix: string
  /** Why this file is a deliberate owner. Not a TODO. */
  readonly reason: string
}

/** The reason this file is exempt, or `null` when the rule applies to it. */
export function exemptionFor(filename: string, exemptions: readonly Exemption[]): string | null {
  const path = normalizePath(filename)
  return exemptions.find((entry) => path.endsWith(entry.suffix))?.reason ?? null
}

/** True when the path contains this `/`-delimited segment run. */
export function isUnder(filename: string, segment: string): boolean {
  return normalizePath(filename).includes(segment)
}

/**
 * Test files are excluded from rules that describe PRODUCT structure. A test may legitimately
 * construct the very shape the rule forbids in order to assert something about it.
 */
export function isTestFile(filename: string): boolean {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(normalizePath(filename))
}
