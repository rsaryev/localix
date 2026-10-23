import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import {
  reachesNodeBuiltins,
  repoRoot,
  resolveSpecifier,
  webEntries,
  type BuiltinReach,
} from './browser-graph'
import { runtimeImports } from './runtime-imports'

/**
 * Nothing the web app can reach may import a NODE builtin.
 *
 * Vite does not fail on one — it externalizes the module and hands the browser a stub,
 * so the app builds, ships, and throws `Module "node:dns" has been externalized for
 * browser compatibility` the first time that code path runs. The import that causes it
 * is never in the UI: it is one VALUE edge into server code, and every module that
 * server module imports comes along. The last one was a single line —
 * `export { TIP_SIGNALS } from './features/capabilities/contracts'` in the api's
 * type-only client barrel — which pulled the chat contracts and the plugin-sdk BACKEND
 * (`node:dns`, `node:net`, `node:fs/promises`) into the browser graph.
 *
 * So the rule is not "don't import node builtins in the UI" — nobody does that. It is
 * this: the module graph REACHABLE from the web entry, walked the way a bundler
 * resolves it and without the tree-shaking that hides the edge in some builds, must
 * contain no `node:` import. That is what this walks.
 *
 * A value needed by both sides belongs in a narrow leaf (`apps/api/package.json`
 * exports a subpath per rule), never in `@localixai/api/client`: that barrel is
 * type-only on purpose, and types erase while values drag their imports.
 */

function report(hits: readonly BuiltinReach[]): string[] {
  return hits.map(({ builtin, chain }) => `${builtin}\n    ${chain.join('\n    <- ')}`)
}

describe('the web graph reaches no node builtin', () => {
  test('nothing the web build pulls in imports node:*', () => {
    const entries = webEntries()
    // The globs must actually match, or this test passes by walking nothing — and the
    // two that reach OUTSIDE apps/ui (plugin UIs, feature contributions) are the ones
    // a rename would silently empty.
    expect(entries.length).toBeGreaterThan(10)
    expect(entries.some((entry) => entry.startsWith('mini-apps/'))).toBe(true)
    expect(entries.some((entry) => entry.includes('/contrib.'))).toBe(true)
    expect(report(reachesNodeBuiltins(entries))).toEqual([])
  })

  // Positive control: the walker only earns the test above if it would fire. The api's
  // chat contracts legitimately use `node:path` — server code, never the browser's.
  test('the walker finds a builtin that IS reachable', () => {
    const hits = reachesNodeBuiltins('apps/api/src/features/chat/contracts.ts')
    expect(hits.map((hit) => hit.builtin)).toContain('node:path')
  })

  test('the walker follows side effects, cycles, and lazy imports but skips type dependencies', () => {
    const dir = mkdtempSync(join(tmpdir(), 'localix-browser-graph-'))
    try {
      writeFileSync(
        join(dir, 'entry.ts'),
        [
          "import './setup.js'",
          "import type { Shape } from './types.ts'",
          'const example = \'import("node:net")\'',
          "const load = () => import(/* fixture */ './lazy.js')",
        ].join('\n'),
      )
      writeFileSync(join(dir, 'setup.js'), "export * from './cycle.js'")
      writeFileSync(join(dir, 'cycle.js'), "import './setup.js'; import 'node:fs'")
      writeFileSync(join(dir, 'types.ts'), "import 'node:os'; export type Shape = string")
      writeFileSync(join(dir, 'lazy.js'), "import 'node:path'")
      const hits = reachesNodeBuiltins(join(dir, 'entry.ts'))
      expect(hits.map((hit) => hit.builtin).sort()).toEqual(['node:fs', 'node:path'])
      const sharedHits = reachesNodeBuiltins([join(dir, 'entry.ts'), join(dir, 'lazy.js')])
      expect(sharedHits.map((hit) => hit.builtin).sort()).toEqual(['node:fs', 'node:path'])
      expect(hits.find((hit) => hit.builtin === 'node:fs')?.chain).toEqual(
        ['cycle.js', 'setup.js', 'entry.ts'].map((file) => relative(repoRoot, join(dir, file))),
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // Positive control for the kit edge: an unresolved `@localixai/kit/<id>` ends the walk there
  // without a word, so both of its doors must resolve to a real file.
  test('the walker follows both kit doors: the package export and a host-lent module', () => {
    const importer = resolve(repoRoot, 'apps/ui/src/app/main.tsx')
    const exported = resolveSpecifier('@localixai/kit/button', importer)
    const lent = resolveSpecifier('@localixai/kit/code-editor', importer)
    expect(exported && relative(repoRoot, exported)).toBe('packages/kit/src/entries/button.ts')
    expect(lent && relative(repoRoot, lent)).toBe('apps/ui/src/app/kit/code-editor.ts')
  })
})

function hasClientBarrelValueEdge(source: string, filename = 'fixture.ts'): boolean {
  return runtimeImports(source, filename).includes('@localixai/api/client')
}

describe('the api client barrel stays type-only', () => {
  test('UI values use narrow API exports instead of the client barrel', () => {
    const offenders: string[] = []
    for (const file of new Bun.Glob('apps/ui/src/**/*.{ts,tsx}').scanSync({ cwd: repoRoot })) {
      if (/\.(?:dom\.)?test\.tsx?$/u.test(file)) continue
      const source = readFileSync(resolve(repoRoot, file), 'utf8')
      if (hasClientBarrelValueEdge(source, file)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  test('runtime edges include mixed imports and re-exports but exclude erased types', () => {
    const source = [
      "import './setup'",
      "import type { Profile } from '@localixai/api/client'",
      "export type { Profile } from '@localixai/api/client'",
    ].join('\n')
    expect(hasClientBarrelValueEdge(source)).toBe(false)
    for (const statement of [
      "import { type Profile } from '@localixai/api/client'",
      "import { type Profile, LIMIT } from '@localixai/api/client'",
      "export { LIMIT as localLimit } from '@localixai/api/client'",
      "export * from '@localixai/api/client'",
      "import '@localixai/api/client'",
      "const module = import('@localixai/api/client')",
    ]) {
      expect(hasClientBarrelValueEdge(statement)).toBe(true)
    }
  })

  // The barrel is the single easiest way to reintroduce the whole failure: it re-exports
  // from the server's own contracts, so ONE value export there is a bundle away from
  // `node:dns`. Values shared with the browser get their own subpath in the export map.
  test('client.ts compatibility values reach no node builtin', () => {
    const source = readFileSync(resolve(repoRoot, 'apps/api/src/client.ts'), 'utf8')
    const valueEdges = runtimeImports(source).filter((specifier) => specifier.startsWith('.'))
    const offenders = valueEdges.filter((specifier) => {
      const target = resolveSpecifier(specifier, resolve(repoRoot, 'apps/api/src/client.ts'))
      return target !== null && reachesNodeBuiltins(relative(repoRoot, target)).length > 0
    })
    expect(offenders).toEqual([])
  })
})
