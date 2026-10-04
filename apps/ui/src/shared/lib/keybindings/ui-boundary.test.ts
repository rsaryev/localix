import { describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../../../../../..')
// The app's own tree AND the kit its primitives moved to: a shortcut handler that left
// `apps/ui/src` for `packages/kit/src` still ships in this app, and scanning only the app would
// let it pass by moving rather than by being fixed.
const SRC_ROOTS = ['apps/ui/src', 'packages/kit/src']
// The one platform formatter, which is where the OS glyphs are allowed to be spelled.
const PLATFORM_FORMATTER = 'packages/kit/src/keyboard/chord.ts'
const HARDCODED_OS_HINT = /(['"`])[^\n'"`]*(?:⌘|⌥|Ctrl\/Cmd|⌘\/Ctrl|Alt\/⌥)[^\n'"`]*\1/u
// A parenthesized Ctrl/Meta pair is the common primary-modifier anti-pattern:
// `(event.metaKey || event.ctrlKey) && ...`. Do not reject broader guards such
// as `ctrlKey || metaKey || altKey`, where the intent is "any modifier".
const FOLDED_PRIMARY_MODIFIER =
  /\(\s*(?:\w+\.)?(?:metaKey\s*\|\|\s*(?:\w+\.)?ctrlKey|ctrlKey\s*\|\|\s*(?:\w+\.)?metaKey)\s*\)/u

/** Every production source under the scanned roots, as a repo-relative path. */
function* productionSources(): Generator<string> {
  for (const root of SRC_ROOTS) {
    for (const path of new Bun.Glob('**/*.{ts,tsx}').scanSync({ cwd: resolve(REPO_ROOT, root) })) {
      if (!path.includes('.test.')) yield `${root}/${path}`
    }
  }
}

describe('OS-native shortcut presentation boundary', () => {
  it('routes production shortcut hints through the platform formatter', async () => {
    const violations: string[] = []
    for (const path of productionSources()) {
      if (path === PLATFORM_FORMATTER) continue
      const lines = (await Bun.file(resolve(REPO_ROOT, path)).text()).split('\n')
      for (const [index, line] of lines.entries()) {
        if (HARDCODED_OS_HINT.test(line)) violations.push(`${path}:${index + 1}`)
      }
    }

    expect(violations).toEqual([])
  })

  it('does not fold physical Ctrl and Meta together in production shortcut handlers', async () => {
    const violations: string[] = []
    for (const path of productionSources()) {
      const lines = (await Bun.file(resolve(REPO_ROOT, path)).text()).split('\n')
      for (const [index, line] of lines.entries()) {
        if (FOLDED_PRIMARY_MODIFIER.test(line)) violations.push(`${path}:${index + 1}`)
      }
    }

    expect(violations).toEqual([])
  })
})
