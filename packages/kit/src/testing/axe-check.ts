/**
 * Run axe over a rendered fragment. TEST-ONLY.
 *
 * The static `jsx-a11y` rules in `.oxlintrc.json` read source and catch a missing `alt` or an
 * unsupported ARIA attribute. They cannot see what a component actually renders: a button whose
 * only content is an icon has no accessible name, and nothing in the source says so — the name is
 * absent, and absence has no syntax. axe answers that question against the real tree.
 *
 * PAGE-level rules are excluded, because a fragment is not a page. `region` wants every node inside
 * a landmark, `page-has-heading-one` wants an `h1`; asserting either against a dialog body would be
 * asserting that the dialog is a document.
 */
import type { AxeResults, RunOptions } from 'axe-core'

/** Rules that only make sense for a whole document. */
const PAGE_LEVEL_RULES = [
  'region',
  'page-has-heading-one',
  'landmark-one-main',
  'html-has-lang',
  'html-lang-valid',
  'bypass',
  'document-title',
] as const

export interface AxeViolation {
  id: string
  impact: string | null
  help: string
  targets: string[]
}

/**
 * Violations axe found, as flat data. Returned rather than asserted so the caller decides what the
 * failure message says — and so a caller may deliberately allow one, with its reason next to it.
 */
export async function findAxeViolations(
  container: Element,
  options: RunOptions = {},
): Promise<AxeViolation[]> {
  const axe = (await import('axe-core')).default
  const results: AxeResults = await axe.run(container, {
    ...options,
    rules: {
      ...Object.fromEntries(PAGE_LEVEL_RULES.map((rule) => [rule, { enabled: false }])),
      ...options.rules,
    },
  })
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact ?? null,
    help: violation.help,
    targets: violation.nodes.flatMap((node) => node.target.map(String)),
  }))
}

/** A failure message that names the rule, what it wants, and where it hit. */
export function describeAxeViolations(violations: readonly AxeViolation[]): string {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help}\n    ${violation.targets.join(', ')}`,
    )
    .join('\n  ')
}
