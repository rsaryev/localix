/**
 * THE POSITIVE CONTROL — the assertion that makes a source lint's green mean something.
 *
 * Every rule in a source lint is satisfied by an EMPTY offender list. So is a completely blind
 * detector. That symmetry is not a theoretical worry: `wire-contract.test.ts` shipped four rules,
 * each with a "the lint would catch it" control beside it, and every one of those controls fed a
 * string to the regex CONSTANT — never to the pipeline that feeds the constant. Neutering
 * `stripComments` to `return ''` left all ten tests in that file green while all four rules read an
 * empty string. The rules were dead and the suite said so in the affirmative.
 *
 * A guard whose goal state is zero hits cannot be falsified by counting hits. It can only be
 * falsified by pushing a KNOWN offender through the REAL detector and watching it come back.
 *
 * So `auditDetector` plants the original bug shapes on disk — one directory DOWN, so the recursion
 * is exercised rather than assumed — walks them with the real walker, matches them with the real
 * matcher, and demands:
 *
 *   1. the walker recursed, and skipped the `.test.ts` beside them   (a non-recursive walk is blind)
 *   2. the rule FIRES on the planted bug                             (a stripper that returns '' is blind)
 *   3. the rule stays SILENT on the same shape written as a comment  (a stripper that strips nothing
 *                                                                     is a lint that watches prose)
 *
 * It returns the findings rather than throwing them, so the KIT'S OWN tests can hand it a mutated
 * detector and assert that the findings appear. That is the mutation matrix, and it is why this
 * harness is itself falsifiable instead of one more thing everybody trusts.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { type SourceDetector, sourceDetector } from './detector'
import { offendersIn } from './scan'

/**
 * One rule, and the two files that prove the detector can tell CODE from PROSE.
 *
 * Whatever a source lint is looking for, its correctness reduces to that single question — so this
 * one shape serves both polarities of lint in the repo:
 *
 *   - an OFFENDER lint ("no wire hand-rolls `name = 'AbortError'`") passes on an empty match. `bug`
 *     is the forbidden code, which the detector MUST match; `clean` is the compliant call with the
 *     forbidden shape in the comment that explains why it is forbidden — which it must NOT match.
 *   - a PRESENCE lint ("`closePosition` calls `resolveCloseTarget` before the native branch") passes
 *     on a match. `bug` is the guard PRESENT in code, which the detector MUST see; `clean` is the
 *     guard COMMENTED OUT — which it must NOT see, so that commenting the guard out turns the lint
 *     red instead of leaving its token sitting in the comment for the lint to find.
 *
 * Same audit, same failure it rules out: a detector that reads prose as code.
 */
export interface OffenderShape {
  /** Names the rule in a failure. */
  readonly rule: string
  /** The rule as the lint actually applies it. */
  readonly pattern: RegExp
  /**
   * The code the detector MUST match, EXACTLY as it was once written. Not a paraphrase: the control
   * is only worth anything if the thing it plants is the thing that shipped.
   */
  readonly bug: string
  /**
   * The same shape, in a COMMENT — which the detector must NOT match. That is the trap: a wire's
   * header legitimately explains why it does not hand-roll the abort error, and a commented-out
   * guard leaves its own name behind. A lint that reads prose finds what it is looking for in both.
   */
  readonly clean: string
}

/**
 * Push each shape through the real detector and report every way it came back blind.
 * An empty array means the detector provably still works. Anything else is a lint that has stopped
 * guarding whatever it claims to guard.
 */
export function auditDetector(
  shapes: readonly OffenderShape[],
  detector: SourceDetector = sourceDetector,
): string[] {
  if (shapes.length === 0)
    return ['auditDetector: no shapes to plant — a control that controls nothing is not a control.']

  const fixture = mkdtempSync(join(tmpdir(), 'source-lint-control-'))
  const findings: string[] = []
  try {
    for (const { rule, pattern, bug, clean } of shapes) {
      const root = join(fixture, rule)
      const nested = join(root, 'nested', 'deep')
      mkdirSync(nested, { recursive: true })
      const offender = join(nested, 'offender.mjs')
      const compliant = join(root, 'compliant.ts')
      writeFileSync(offender, bug)
      writeFileSync(compliant, clean)
      // The same bug in a TEST file: the walker must not read it, or the lint reports its own
      // fixtures as violations and someone deletes the lint to make the noise stop.
      writeFileSync(join(root, 'ignored.test.ts'), bug)

      const found = detector.walk(root)
      const seen = found.map((f) => relative(root, f)).sort()
      const expected = ['compliant.ts', join('nested', 'deep', 'offender.mjs')]
      if (seen.join('|') !== expected.join('|')) {
        findings.push(
          `${rule}: the walker did not find what it was pointed at. Expected [${expected.join(', ')}], ` +
            `got [${seen.join(', ') || '<nothing>'}]. A walk that does not recurse cannot see a wire one ` +
            'folder down — and an empty file list is exactly what a clean tree looks like.',
        )
        continue
      }

      const hits = offendersIn(found, pattern, detector).map((f) => relative(root, f))
      if (!hits.includes(join('nested', 'deep', 'offender.mjs'))) {
        findings.push(
          `${rule}: the REAL detector did not report the planted offender. The rule is dead: it is ` +
            'reading nothing, or matching nothing. Every assertion downstream of it is passing by ' +
            'default.',
        )
      }
      if (hits.includes('compliant.ts')) {
        findings.push(
          `${rule}: the detector reported COMPLIANT code as an offender — it is matching the bug shape ` +
            'inside a comment. This lint is watching prose, so the guarded code can be commented out ' +
            'entirely and it will still find every token it looks for.',
        )
      }
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
  return findings
}
