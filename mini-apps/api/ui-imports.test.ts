/**
 * WHAT THE BROWSER IS ALLOWED TO REACH.
 *
 * The mini app owns both sides, so its UI imports types and pure helpers straight from `backend/`.
 * That is the intended convention — but a backend module is written by someone thinking about a
 * server, and one import is all it takes:
 *
 *   ui/register.tsx  →  backend/uri.ts  →  @localixai/mini-app-sdk/backend  →  createUserEntityStore
 *                                                                        →  node:fs/promises
 *
 * Vite externalizes `node:` modules for the browser, so that import threw the moment it was
 * evaluated. `register.tsx` is EAGER — registration cannot be lazy — so it threw at app boot and
 * the entire app rendered a BLACK SCREEN. Not the mini app: the app.
 *
 * Nothing caught it. Both typechecks passed (types do not know about bundlers). `vite build`
 * passed (externalizing is not an error). `bun test` passed (bun HAS node:fs). Only running it
 * failed, and the loop that built this had never run it.
 *
 * So this reads the source, the way the repo's other contracts do. It is cheap, and it is the only
 * check in the suite that knows the browser exists.
 *
 * THE RULE IS THE TRANSITIVE CLOSURE, not a ban on imports. An earlier version required a
 * browser-loaded backend module to import NOTHING, which is a proxy for the real danger and one
 * that misprices a safe leaf: `@localixai/mini-app-sdk/navigation` is a pure parser the URI grammar
 * legitimately shares with trading's. So this walks the graph the bundler would walk and fails on
 * what actually breaks — a `node:` builtin, or a module it cannot prove is safe.
 *
 * An npm package is followed the way VITE would follow it: through the `browser` export condition
 * its author published for exactly this environment. A package WITHOUT one is not assumed safe —
 * its node entry is walked instead, and any `node:` reach underneath it fails the same as ours
 * would. `jsonpath-plus` now belongs to the backend-only agent response filter, but it remains a
 * useful package-resolution fixture because it publishes distinct browser and node entries.
 */

import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { Glob } from 'bun'

const ROOT = import.meta.dir
const REPO = path.resolve(ROOT, '../..')

/** `import ... from 'x'` / `export ... from 'x'`, minus the type-only ones (they are erased). */
const RUNTIME_IMPORT_RE =
  /^\s*(?:import|export)\s+(?!type\s)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm

async function read(abs: string): Promise<string | null> {
  return Bun.file(abs)
    .text()
    .catch(() => null)
}

async function uiFiles(): Promise<string[]> {
  const out: string[] = []
  for await (const f of new Glob('ui/**/*.{ts,tsx}').scan(ROOT)) {
    if (!f.includes('.test.')) out.push(f)
  }
  return out
}

function runtimeImports(source: string): string[] {
  return [...source.matchAll(RUNTIME_IMPORT_RE)].map((m) => m[1]!)
}

/** Backend modules the UI imports for their RUNTIME value (a type import is erased). */
async function backendModulesTheBrowserLoads(): Promise<string[]> {
  const found = new Set<string>()
  for (const file of await uiFiles()) {
    const source = (await read(path.join(ROOT, file))) ?? ''
    for (const spec of runtimeImports(source)) {
      if (!spec.includes('backend/')) continue
      found.add(`${path.resolve(path.dirname(path.join(ROOT, file)), spec)}.ts`)
    }
  }
  return [...found].sort()
}

/**
 * The entry an npm package offers, preferring the condition the BUNDLER would pick for a browser.
 * Returns `null` when the package cannot be located at all — which the walk treats as a failure,
 * never a skip: an unreadable dependency is precisely the barrel case, since you cannot look at
 * `import { RESOURCE_SCHEMES } from '…/backend'` and see `node:fs`.
 */
async function packageEntry(spec: string): Promise<string | null> {
  const parts = spec.split('/')
  const pkgName = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
  const pkgDir = path.join(REPO, 'node_modules', pkgName)
  const manifestText = await read(path.join(pkgDir, 'package.json'))
  if (manifestText === null) return null
  const manifest = JSON.parse(manifestText) as {
    exports?: unknown
    browser?: unknown
    module?: unknown
    main?: unknown
  }
  const subpath = spec.slice(pkgName.length) || '.'
  const key = subpath === '.' ? '.' : `.${subpath}`
  const entryOf = (node: unknown): string | null => {
    if (typeof node === 'string') return node
    if (!node || typeof node !== 'object') return null
    const conditions = node as Record<string, unknown>
    // Browser first — that is the build the author published for this environment.
    for (const condition of ['browser', 'import', 'module', 'default']) {
      const resolved = entryOf(conditions[condition])
      if (resolved !== null) return resolved
    }
    return null
  }
  const exportsMap = manifest.exports
  const relative =
    (exportsMap && typeof exportsMap === 'object'
      ? entryOf((exportsMap as Record<string, unknown>)[key])
      : entryOf(exportsMap)) ??
    (typeof manifest.browser === 'string' ? manifest.browser : null) ??
    (typeof manifest.module === 'string' ? manifest.module : null) ??
    (typeof manifest.main === 'string' ? manifest.main : null)
  if (relative === null) return null
  const file = path.join(pkgDir, relative)
  return (await Bun.file(file).exists()) ? file : null
}

/**
 * Resolve one import specifier to a file the walk can keep reading, or `null` when it cannot be
 * followed at all. The workspace SDK is followable because it is source in this repo; an npm
 * package is followed through its published entry (see {@link packageEntry}).
 */
async function resolveSpecifier(spec: string, fromFile: string): Promise<string | null> {
  const candidates: string[] = []
  if (spec.startsWith('.')) {
    const base = path.resolve(path.dirname(fromFile), spec)
    candidates.push(`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), `${base}.js`)
  } else if (spec.startsWith('@localixai/mini-app-sdk')) {
    const sub = spec.slice('@localixai/mini-app-sdk'.length).replace(/^\//, '') || 'index'
    const base = path.join(REPO, 'packages/mini-app-sdk/src', sub)
    candidates.push(`${base}.ts`, path.join(base, 'index.ts'))
  } else {
    return packageEntry(spec)
  }
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) return candidate
  }
  return null
}

interface Reach {
  /** `<module> → <specifier>` for every edge the browser cannot survive. */
  offenders: string[]
  /** Every file the walk actually opened — a walk that opens nothing is vacuously green. */
  visited: Set<string>
}

/** Walk the runtime import graph from `entries` exactly as the bundler would. */
async function reachOf(entries: readonly string[]): Promise<Reach> {
  const offenders: string[] = []
  const visited = new Set<string>()
  const queue = [...entries]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (visited.has(file)) continue
    visited.add(file)
    const source = await read(file)
    if (source === null) continue
    for (const spec of runtimeImports(source)) {
      const where = `${path.relative(ROOT, file)} → ${spec}`
      if (spec.startsWith('node:')) {
        offenders.push(where)
        continue
      }
      const resolved = await resolveSpecifier(spec, file)
      if (resolved === null) offenders.push(where)
      else queue.push(resolved)
    }
  }
  return { offenders, visited }
}

describe('the UI really does load backend modules', () => {
  test('the scan is not void — it finds the ui tree', async () => {
    // A walk that opens nothing looks exactly like a clean tree.
    expect((await uiFiles()).length).toBeGreaterThan(5)
  })

  test('and it finds at least one backend module reached for its runtime value', async () => {
    // If this ever hits zero the guard below is vacuously green — either the convention changed,
    // or the detector stopped matching.
    expect((await backendModulesTheBrowserLoads()).length).toBeGreaterThan(0)
  })
})

describe('nothing a browser-loaded backend module reaches may touch node', () => {
  test('the transitive closure is browser-safe', async () => {
    const entries = await backendModulesTheBrowserLoads()
    const { offenders, visited } = await reachOf(entries)
    // The walk must have opened MORE than its entry points, or it proves nothing about depth.
    expect(visited.size).toBeGreaterThanOrEqual(entries.length)
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : 'A module the browser loads reaches something it cannot evaluate. Vite externalizes ' +
            '`node:` builtins into stubs that throw on access, and `ui/register.tsx` is eager — so ' +
            'such a throw is a black screen at boot, and no typecheck, `vite build` or `bun test` ' +
            'will tell you. An unresolvable BARE specifier fails the same way, because a barrel you ' +
            'cannot read is exactly what dragged `node:fs` in the first time. Inline what you need, ' +
            'or move the impure part to a backend-only module (see backend/resource-provider-id.ts):\n  ' +
            offenders.join('\n  '),
    ).toEqual([])
  })

  test('the walk really is transitive — it opens what the entries import', async () => {
    // `backend/uri.ts` imports the SDK's pure navigation leaf; the closure must contain that file,
    // otherwise the walk stopped at depth 1 and the depth claim above is theatre.
    const { visited } = await reachOf(await backendModulesTheBrowserLoads())
    const opened = [...visited].map((f) => path.relative(REPO, f))
    expect(opened).toContain('packages/mini-app-sdk/src/navigation.ts')
  })

  test('package resolution prefers the browser build without pulling backend-only code into UI', async () => {
    // jsonpath-plus ships both. Pin the resolver's browser choice, while also pinning the product
    // boundary: JSONPath is useful to the agent tool but no longer creates a second response UI.
    const entry = await packageEntry('jsonpath-plus')
    expect(entry).not.toBeNull()
    expect(path.basename(entry!)).toBe('index-browser-esm.js')

    const { visited } = await reachOf(await backendModulesTheBrowserLoads())
    expect([...visited].some((f) => f.endsWith('index-browser-esm.js'))).toBe(false)
  })

  test('a package that cannot be located at all is an offender, not a skip', async () => {
    expect(await packageEntry('this-package-does-not-exist-anywhere')).toBeNull()
  })

  test('the detector fires on the real shape — a barrel it cannot follow', async () => {
    // The planted bug: the exact import that caused the outage. `@localixai/mini-app-sdk/backend`
    // resolves to source here, so the walk follows it and finds `node:` underneath.
    const { offenders } = await reachOf([
      path.join(REPO, 'packages/mini-app-sdk/src/backend/index.ts'),
    ])
    expect(offenders.some((o) => o.includes('node:'))).toBe(true)
  })

  test('and stays silent on a type-only import, which is erased', async () => {
    const fine = "import type { Pair } from './request-spec'\nexport const X = 1"
    expect(runtimeImports(fine)).toEqual([])
  })
})
