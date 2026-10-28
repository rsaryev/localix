import { describe, expect, test } from 'bun:test'

import {
  lockMatches,
  npmManifest,
  SHIPPED_LOCKS,
  type NpmManifest,
  type NpmPackage,
} from './lsp-npm-lock'
import { LSP_PACKAGES } from './lsp-registry'

const npmServers = Object.values(LSP_PACKAGES).filter(
  (pkg): pkg is NpmPackage => pkg.source.type === 'npm',
)

describe('the lockfiles that ship with the npm servers', () => {
  test('there is at least one npm server to cover', () => {
    expect(npmServers.length).toBeGreaterThan(0)
  })

  for (const pkg of npmServers) {
    test(`${pkg.id} has a lockfile that pins its whole tree to the registry's versions`, () => {
      const text = SHIPPED_LOCKS[pkg.id]
      // Fix: `bun run --cwd apps/api lsp:update`, which locks what is missing or out of date.
      if (text === undefined)
        throw new Error(`${pkg.id}: no lockfile in language-server-locks.json`)
      expect(lockMatches(text, npmManifest(pkg))).toBe(true)
      // Every package carries the registry's integrity hash.
      const { packages } = Bun.JSONC.parse(text) as { packages: Record<string, string[]> }
      const entries = Object.values(packages)
      for (const entry of entries) expect(entry.at(-1)).toMatch(/^sha512-/)
    })
  }

  test('no lockfile is left for a server that is gone', () => {
    const ids = new Set(npmServers.map((pkg) => pkg.id))
    for (const id of Object.keys(SHIPPED_LOCKS)) expect(ids.has(id)).toBe(true)
  })
})

describe('lockMatches', () => {
  const manifest: NpmManifest = {
    name: 'localix-lsp-x',
    private: true,
    dependencies: { a: '1.0.0' },
  }
  const lock = (dependencies: Record<string, string>, name = 'localix-lsp-x') =>
    `{\n  "lockfileVersion": 2,\n  "workspaces": { "": { "name": "${name}", "dependencies": ${JSON.stringify(dependencies)}, }, },\n  "packages": {},\n}\n`

  test('is true for the same dependencies, false when a version, a package or the name differs', () => {
    expect(lockMatches(lock({ a: '1.0.0' }), manifest)).toBe(true)
    expect(lockMatches(lock({ a: '1.0.1' }), manifest)).toBe(false)
    expect(lockMatches(lock({ a: '1.0.0', b: '1.0.0' }), manifest)).toBe(false)
    expect(lockMatches(lock({ a: '1.0.0' }, 'other'), manifest)).toBe(false)
    expect(lockMatches('not a lockfile {', manifest)).toBe(false)
  })
})
