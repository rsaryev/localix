import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { repoRoot } from './lib/paths.mjs'

// `bun run clean` is `turbo clean` (every workspace's `clean`) plus the root's own outputs. It
// must remove what the scripts write, or stale outputs outlive the code that wrote them: the
// mini app kit cache reached 7GB, and package `.turbo` logs outlived their deleted packages.
const repo = repoRoot()
const workspaces = (await Bun.file(join(repo, 'package.json')).json()).workspaces as string[]
const manifests = workspaces.flatMap((pattern) => [
  ...new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: repo }),
])

test('the root clean removes the root Turbo directory, where the kit and its cache are staged', async () => {
  const root = await Bun.file(join(repo, 'package.json')).json()
  expect(root.scripts.clean).toMatch(
    /^bunx turbo clean && shx rm -rf (?=.*\.turbo)(?=.*node_modules)/,
  )
})

test('every workspace clean removes its Turbo logs and what its build writes', async () => {
  const missing: string[] = []
  for (const manifest of manifests) {
    // `vendor/` holds upstream code that changes only in a deliberate sync.
    if (manifest.startsWith('vendor/')) continue
    const { scripts = {} } = await Bun.file(join(repo, manifest)).json()
    // A workspace with no scripts runs no Turbo task, so it has no logs either.
    if (Object.keys(scripts).length === 0) continue
    const removed = String(scripts.clean ?? '').split(/\s+/)
    const expected = ['.turbo']
    if (/rm -rf dist|vite build|tsconfig\.build\.json/.test(String(scripts.build ?? ''))) {
      expected.push('dist')
    }
    for (const path of expected) {
      if (!removed.includes(path)) missing.push(`${manifest}: ${path}`)
    }
  }
  expect(missing).toEqual([])
})
