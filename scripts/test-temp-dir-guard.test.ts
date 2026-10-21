import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * Tests never make scratch folders beside themselves.
 *
 * A test that created its temp dir with `mkdtemp(join(import.meta.dir, …))` put a half-written
 * fixture INSIDE the source tree. Every lint that walks `src` (the plugin-sdk exports guard, the
 * architecture checks) could list a file there and then fail to read it the moment the test removed
 * it, which turned a pre-push red on a file nobody had touched; a crashed run also left the folder
 * behind for good. Temp dirs come from `@localixai/testing` (`makeTempDir`, `tempDirPerTest`) under
 * the OS temp dir. A fixture that must resolve the repository's own packages takes the package's
 * git-ignored scratch root instead (`apps/api/src/testing/scratch-dir.ts`), never its own folder.
 */

const repoRoot = resolve(import.meta.dir, '..')
const ROOTS = ['apps', 'packages', 'plugins', 'scripts']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.turbo', 'target', 'tmp'])
const TEST_FILE = /\.test\.(ts|tsx|mjs)$/

/** A folder made relative to the test's own directory or the working directory. */
const BESIDE_ITSELF: readonly RegExp[] = [
  /mkdtemp(?:Sync)?\(\s*(?:path\.)?join\(\s*(?:import\.meta\.dir(?:name)?|__dirname|process\.cwd\(\))/,
  /join\(\s*(?:import\.meta\.dir(?:name)?|__dirname)\s*,\s*[`'"](?:\.tmp|__tmp|tmp[`'"/])/,
]

function testFiles(dir: string): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    if (SKIP_DIRS.has(entry.name)) return []
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return testFiles(full)
    return TEST_FILE.test(entry.name) ? [full] : []
  })
}

describe('test scratch folders', () => {
  test('the patterns catch the forms that wrote into the source tree', () => {
    const planted = [
      "dir = await mkdtemp(join(import.meta.dir, '.rg-fixture-'))",
      'sizeDir = await mkdtemp(path.join(import.meta.dir, ".sizeonly-test-"))',
      'const tempDir = join(import.meta.dir, `.tmp-context-store-${randomUUID()}`)',
      "const TMP = path.join(import.meta.dir, '__tmp_oauth__')",
      "const TMP_ROOT = path.join(import.meta.dir, 'tmp', `market-${id}`)",
      "folder = await mkdtemp(join(process.cwd(), 'tmp', 'migration-ledger-'))",
    ]
    for (const line of planted) expect(BESIDE_ITSELF.some((rule) => rule.test(line))).toBe(true)
    expect(
      BESIDE_ITSELF.some((rule) => rule.test("readFileSync(join(import.meta.dir, 'a.ts'))")),
    ).toBe(false)
  })

  test('no test makes one beside itself', () => {
    // This file names the forms it forbids, as examples.
    const files = ROOTS.flatMap((root) => testFiles(join(repoRoot, root))).filter(
      (file) => file !== import.meta.path,
    )
    // The walk has to reach the suites it guards, or an empty scan would pass.
    expect(files.length).toBeGreaterThan(1000)
    const offenders = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          BESIDE_ITSELF.some((rule) => rule.test(line))
            ? [`${relative(repoRoot, file)}:${index + 1}  ${line.trim()}`]
            : [],
        ),
    )
    expect(offenders).toEqual([])
  })
})
