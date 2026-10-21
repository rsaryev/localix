// Temporary directories that clean themselves up. A bare `mkdtemp` in a test is a leak the moment
// an assertion throws before its `rm`; these register the removal with the test runner instead.
import { afterAll, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** File contents keyed by path relative to the directory; nested paths create their folders. */
export type FileTree = Record<string, string | Uint8Array>

/**
 * Create a fresh directory under the OS temp dir, optionally filled with `tree`.
 *
 * `root` moves it elsewhere, for the one fixture an OS temp dir cannot hold: code that has to
 * resolve the repository's own packages from `node_modules` (a plugin backend importing `hono`, a
 * migration importing `kysely`). Keep such a root git-ignored and outside every source tree a lint
 * walks, or a scan can meet the fixture half-written; never a test's own folder.
 */
export function makeTempDir(
  prefix = 'localix-test',
  tree: FileTree = {},
  root: string = tmpdir(),
): string {
  mkdirSync(root, { recursive: true })
  const dir = mkdtempSync(join(root, `${prefix}-`))
  writeTree(dir, tree)
  return dir
}

/** Write `tree` into `dir`, creating parent folders as needed. */
export function writeTree(dir: string, tree: FileTree): void {
  for (const [path, contents] of Object.entries(tree)) {
    const file = join(dir, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, contents)
  }
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
}

/**
 * A temp directory per test: call at describe or file level, read `dir()` inside a test. Each test
 * gets a new, empty directory and it is removed after the test, pass or fail.
 */
export function tempDirPerTest(prefix?: string, tree?: FileTree): () => string {
  let current: string | undefined
  afterEach(() => {
    if (current) removeDir(current)
    current = undefined
  })
  return () => (current ??= makeTempDir(prefix, tree))
}

/** One temp directory shared by every test in the file or describe, removed after the last one. */
export function tempDirPerFile(prefix?: string, tree?: FileTree): () => string {
  let current: string | undefined
  afterAll(() => {
    if (current) removeDir(current)
  })
  return () => (current ??= makeTempDir(prefix, tree))
}
