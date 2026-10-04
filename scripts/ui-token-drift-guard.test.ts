import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { UI_TOKEN_RULES as RULES } from '../apps/api/src/contracts/ui-token-rules'
import { assertPositiveControl, scanSources } from '../apps/api/src/lib/source-lint'

/**
 * Repo-wide guard for the design TOKENS a class string must come from.
 *
 * The rules are `apps/api/src/contracts/ui-token-rules.ts`, which says why each exists; this
 * applies them to the app AND every bundled plugin, and `plugin_build` applies the same list to
 * a plugin a person builds. It reads comment-stripped source (`scanSources`), so prose that
 * explains a removed literal does not trip it, and each rule carries a positive control proving
 * it still fires.
 */

const repoRoot = resolve(import.meta.dir, '..')

/**
 * Files that DEFINE a vocabulary rather than consume it, each with its reason. A new entry needs
 * a reason of the same kind — "it looked fine" is not one.
 */
const EXEMPT: ReadonlyArray<{ file: string; why: string }> = []

// A plugin's BACKEND carries no class strings, only prose — "prices are rounded through the
// venue's rules" is a sentence, not a radius — so plugins are scanned where their UI lives.
// The kit is where the primitives live: every consumer inherits a drifted value from there, so
// leaving it out would stop enforcing the rules on the code they were written for.
const INCLUDE = [
  'apps/ui/src/**/*.{ts,tsx}',
  'packages/kit/src/**/*.{ts,tsx}',
  'plugins/**/*.tsx',
  'plugins/**/ui/**/*.ts',
  'plugins/**/frontend/**/*.ts',
]
// The kit's `src/testing/` is the renamed home of the `*.test-utils.ts` helpers: test support that
// plants shapes on purpose, never a class string a surface renders.
const isTest = (file: string) =>
  /\.(?:dom\.)?test\.tsx?$|\.test-utils\.tsx?$|^packages\/kit\/src\/testing\//u.test(file)

async function detect(root: string, minFiles = 1): Promise<string[]> {
  const exempt = new Set(EXEMPT.map((entry) => entry.file))
  const files = await scanSources({
    root,
    include: INCLUDE,
    skip: (file) => isTest(file) || exempt.has(file),
    minFiles,
  })
  const offenders: string[] = []
  for (const { file, code } of files) {
    for (const rule of RULES) {
      for (const match of code.matchAll(rule.pattern)) {
        const line = code.slice(0, match.index).split('\n').length
        offenders.push(`${file}:${line} ${match[0]} — ${rule.name}: ${rule.fix}`)
      }
    }
  }
  return offenders
}

describe('ui token drift', () => {
  test('every class string takes its value from a token', async () => {
    expect(await detect(repoRoot, 500)).toEqual([])
  })

  test('each rule still fires on its drifted shape (positive controls)', async () => {
    for (const rule of RULES) {
      await assertPositiveControl({
        subject: `a ${rule.name}`,
        file: 'apps/ui/src/features/planted/deep/Planted.tsx',
        offender: rule.offender,
        detect: async (root) => (await detect(root)).filter((hit) => hit.includes(rule.name)),
      })
    }
  })

  // A literal that is exactly `rounded` is a shape name on the board, but the bare class where a
  // class string starts — so the exemption must not reach a class attribute or a combiner.
  test('a bare rounded class is caught wherever a class string starts', async () => {
    const rule = RULES.find((entry) => entry.name === 'off-scale radius')!
    for (const offender of [
      '<div className="rounded">',
      '<div className={"rounded"}>',
      "const a = cn('rounded', open && 'bg-card')",
    ]) {
      await assertPositiveControl({
        subject: `a bare rounded class in ${offender}`,
        file: 'apps/ui/src/features/planted/deep/Planted.tsx',
        offender,
        detect: async (root) => (await detect(root)).filter((hit) => hit.includes(rule.name)),
      })
    }
  })

  test('token spellings are not mistaken for drift', async () => {
    const clean = [
      "const a = 'duration-(--dur-base) ease-(--ease-soft) ease-linear transition-colors'",
      "const b = 'z-(--z-popover) z-0 rounded-md rounded-full rounded-t-2xl size-10'",
      "const c = 'border-border-faint divide-border-soft shadow-(--shadow-raised) text-3xs'",
      "const e = 'text-status-error bg-status-success/12 text-foreground bg-foreground/[0.04]'",
      'const rounded = Math.round(width)',
      'const d = rounded ? 1 : 0',
      // A shape NAME: the whole literal is `rounded`, and no class string starts there.
      'const g = { shape: \'rounded\', value: "rounded" }',
      "switch (kind) { case 'rounded': return shapePath('rounded', w, h) }",
      // A measure on text, a centre without a column, a named measure, an overlay's breakpoint.
      '<p className="max-w-2xl text-sm">',
      '<div className="mx-auto mt-4 h-1.5 w-14">',
      '<div className="mx-auto w-full max-w-(--reading-measure) max-sm:max-w-full px-6">',
      "const f = 'md:max-w-205 md:mx-auto md:w-full'",
    ].join('\n')
    await expect(
      assertPositiveControl({
        subject: 'token spellings',
        file: 'apps/ui/src/features/planted/Clean.tsx',
        offender: clean,
        detect: (root) => detect(root),
      }),
    ).rejects.toThrow('did NOT fire')
  })
})
