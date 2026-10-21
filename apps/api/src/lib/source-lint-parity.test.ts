/// <reference types="bun" />

import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import { codeOnly } from '@localixai/source-lint'
import { stripComments } from './source-lint'

// Walks the whole source tree: seconds under a parallel run of every package, not milliseconds.
setDefaultTimeout(30_000)

/**
 * TWO COMMENT STRIPPERS, ONE MEANING OF "CODE".
 *
 * This repo deliberately runs two source-lint kits and the split is a dependency-order fact, not a
 * redundancy: `@localixai/source-lint` is a base-layer package the repo-wide guards use (the
 * path-containment monopoly scan reads EVERY first-party tree, and `packages/*` may not depend on
 * `apps/api`), while `lib/source-lint.ts` is the apps/api-local kit its ~dozen in-tree contract tests
 * use. Both start by deciding what is CODE and what is a COMMENT, and every guard built on either one
 * inherits that decision.
 *
 * So a divergence does not fail anything — it BLINDS one family of guards. A stripper that mistakes a
 * URL inside a string for a line comment silently deletes the code a detector was meant to read, and
 * the guard goes green on a tree it never examined. Both stripped correctly on every case below when
 * this was written; nothing checked that they would keep agreeing.
 *
 * The corpus is the set of inputs where a naive `split('//')` or a non-greedy block match gets it
 * wrong. It is not a test OF either stripper (each has its own) — it pins their EQUIVALENCE.
 */

/** `[name, source]` — each source hides the marker `secret` in a specific syntactic position. */
const CASES: Array<[string, string]> = [
  ['a line comment', 'const a = 1 // secret\n'],
  ['a block comment', '/* secret */ const a = 1\n'],
  ['a jsdoc block', '/**\n * secret\n */\nconst a = 1\n'],
  ['`//` inside a single-quoted string', "const url = 'http://x/secret'\n"],
  ['`//` inside a template literal', 'const t = `http://x/secret`\n'],
  ['`/*` inside a double-quoted string', 'const s = "/* secret */"\n'],
  ['a regex literal containing `//`', 'const r = /a\\/\\/secret/\n'],
  ['a regex literal containing `/*`', 'const r = /[/*]secret/\n'],
  ['an escaped quote before `//`', "const s = 'it\\'s // secret'\n"],
  ['a URL inside a jsdoc', '/** see http://x/secret */\nconst a = 1\n'],
  ['a block comment that looks nested', '/* a /* b */ const secret = 1\n'],
  ['a division that reads like a comment', 'const q = a / /b/.source.length // secret\n'],
]

describe('the two source-lint kits agree on what counts as code', () => {
  test('every syntactic position resolves the same way in both strippers', () => {
    const disagreements = CASES.flatMap(([name, source]) => {
      const pkg = codeOnly(source).includes('secret')
      const local = stripComments(source).includes('secret')
      return pkg === local
        ? []
        : [
            `${name}: @localixai/source-lint says ${pkg ? 'CODE' : 'comment'}, apps/api says ${local ? 'CODE' : 'comment'}`,
          ]
    })
    expect(
      disagreements,
      disagreements.length === 0
        ? ''
        : [
            '',
            'The two strippers disagree. Whichever one is wrong, the guards built on it are now',
            'reading a different program than their authors think — a detector whose input was',
            'silently deleted reports a clean tree. Fix the stripper, not this test.',
            '',
            ...disagreements.map((d) => `  ${d}`),
            '',
          ].join('\n'),
    ).toEqual([])
  })

  test('and the corpus is not vacuous — it contains both outcomes', () => {
    // Without this, a pair of strippers that deleted EVERYTHING (or nothing) would agree on every
    // case and pass. The corpus has to exercise the distinction it claims to pin.
    const outcomes = new Set(CASES.map(([, source]) => codeOnly(source).includes('secret')))
    expect(outcomes, 'the corpus must contain both stripped and surviving cases').toEqual(
      new Set([true, false]),
    )
  })
})
