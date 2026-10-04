import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { missingTokens, themeTokensOf } from '../apps/api/src/contracts/ui-token-existence'
import { assertPositiveControl, scanSources } from '../apps/api/src/lib/source-lint'

/**
 * Repo-wide guard: a class that names a kit token names one the theme defines.
 *
 * Tailwind v4 emits nothing for `bg-surface-subtle` when `--color-surface-subtle` does not exist,
 * so a misspelt token paints nothing and passes the build, the types and a glance at the screen.
 * The rule and its reasoning live in `apps/api/src/contracts/ui-token-existence.ts`; this applies
 * it to the app, the kit, the SDK and every bundled plugin, against the kit's own theme file —
 * read here, not copied, so a token added to the theme is usable the moment it exists.
 */

const repoRoot = resolve(import.meta.dir, '..')
const THEME = 'packages/kit/styles/tailwind-theme.css'
const tokens = themeTokensOf(readFileSync(resolve(repoRoot, THEME), 'utf8'))

const INCLUDE = [
  'apps/ui/src/**/*.{ts,tsx}',
  'packages/kit/src/**/*.{ts,tsx}',
  'packages/plugin-sdk/src/**/*.{ts,tsx}',
  'plugins/**/*.tsx',
  'plugins/**/ui/**/*.ts',
  'plugins/**/frontend/**/*.ts',
]
// Tests plant absent tokens on purpose (`not.toContain('bg-surface')`); the kit's `src/testing/`
// is test support in the same sense.
const isTest = (file: string) =>
  /\.(?:dom\.)?test\.tsx?$|\.test-utils\.tsx?$|^packages\/kit\/src\/testing\//u.test(file)

async function detect(root: string, minFiles = 1): Promise<string[]> {
  const files = await scanSources({ root, include: INCLUDE, skip: isTest, minFiles })
  const offenders: string[] = []
  for (const { file, code } of files) {
    for (const hit of missingTokens(code, tokens)) {
      const line = code.slice(0, hit.index).split('\n').length
      offenders.push(`${file}:${line} ${hit.match} — no --${hit.kind}-${hit.token}: ${hit.fix}`)
    }
  }
  return offenders
}

describe('ui token existence', () => {
  test('the theme is read, not assumed', () => {
    // A theme that parsed to nothing would flag every class — or, with a broken detector, none.
    expect(tokens.colors.has('surface-hover')).toBe(true)
    expect(tokens.colors.has('text-soft')).toBe(true)
    expect(tokens.radii.has('md')).toBe(true)
  })

  test("Tailwind's stock layer does not define a kit token", () => {
    const stock = themeTokensOf('@theme default { --radius-xs: 0.125rem; --color-surface: #fff; }')
    expect(stock.radii.size + stock.colors.size).toBe(0)
  })

  test('every kit-family class names a token the theme defines', async () => {
    expect(await detect(repoRoot, 500)).toEqual([])
  })

  test('a class naming an absent token is caught (positive controls)', async () => {
    for (const offender of [
      '<pre className="rounded-md bg-surface-subtle p-3">',
      "const a = 'odd:bg-surface-subtle/25 hover:text-text-muted'",
      "const b = 'text-status-danger'",
      "const c = 'rounded-3xl'",
      "const d = 'bg-status-error text-destructive-foreground'",
    ]) {
      await assertPositiveControl({
        subject: `an absent token in ${offender}`,
        file: 'apps/ui/src/features/planted/deep/Planted.tsx',
        offender,
        detect: (root) => detect(root),
      })
    }
  })

  test('a class naming a defined token is not flagged', async () => {
    const clean = [
      '<div className="bg-surface-hover text-text-soft border-border-faint rounded-md">',
      "const a = 'hover:bg-surface-active/50 text-status-error bg-field-fill ring-sidebar-ring'",
      "const b = 'bg-card text-popover-foreground border-t-border-soft rounded-t-xl rounded-full'",
      "const c = 'rounded-none rounded-t bg-(--surface-sunken) text-[var(--text-soft)]'",
      "const d = 'var(--color-surface-subtle)'",
      // A module path is not a class, however much its file name reads like one.
      "export * from './text-input-completion-port'",
    ].join('\n')
    await expect(
      assertPositiveControl({
        subject: 'defined tokens',
        file: 'apps/ui/src/features/planted/Clean.tsx',
        offender: clean,
        detect: (root) => detect(root),
      }),
    ).rejects.toThrow('did NOT fire')
  })
})
