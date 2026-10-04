import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

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

const repoRoot = resolve(import.meta.dir, '..')

/** Workspace packages resolved from source, exactly as their export maps declare. */
const WORKSPACE_PACKAGES: Record<string, string> = {
  '@localixai/api': 'apps/api',
  '@localixai/agent': 'packages/agent',
  '@localixai/plugin-sdk': 'packages/plugin-sdk',
  '@localixai/liveness': 'packages/liveness',
  '@localixai/notifications': 'packages/notifications',
  '@localixai/search': 'packages/search',
  '@localixai/os-open': 'packages/os-open',
  '@localixai/path-containment': 'packages/path-containment',
  '@localixai/dataview': 'packages/dataview',
  // The primitives the host used to reach as `@/shared/ui/…` now come through this package.
  // Unlisted, every such import would read as third-party and the walk would stop at it —
  // dropping the kit, and whatever it imports, out of the graph this guard exists to read.
  '@localixai/kit': 'packages/kit',
}

/**
 * Where a `@localixai/kit/<id>` the package does not export resolves instead: a module the host
 * still lends, exactly as the plugins' `tsconfig` paths fall back to it.
 */
const KIT_LENT_DIR = resolve(repoRoot, 'apps/ui/src/app/kit')

/**
 * Everything the web build pulls in, not just the HTML entry.
 *
 * Vite's `import.meta.glob` calls are entries too — the feature contributions and the UI
 * surface manifest — and a `node:` import behind one of those is in the bundle exactly as
 * much as one behind `main.tsx`. Every bundled plugin's `ui/register` is the entry of its
 * own browser artifact (`apps/api/src/features/plugins/authoring/ui-build.ts`), so it is walked
 * the same way.
 */
const WEB_ENTRY_GLOBS = [
  'apps/ui/src/app/main.tsx',
  'apps/ui/src/features/*/contrib.{ts,tsx}',
  'apps/ui/src/**/*.surface.{ts,tsx}',
  'plugins/*/ui/register.{ts,tsx}',
]

function webEntries(): string[] {
  const found = new Set<string>()
  for (const pattern of WEB_ENTRY_GLOBS) {
    for (const match of new Bun.Glob(pattern).scanSync({ cwd: repoRoot })) found.add(match)
  }
  return [...found].sort()
}

/** `@/…` is `apps/ui/src/…` (vite + tsconfig paths). */
const UI_SRC = resolve(repoRoot, 'apps/ui/src')

function firstFile(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js']

function resolvePackage(pkgDir: string, subpath: string): string | null {
  const manifestPath = resolve(pkgDir, 'package.json')
  if (!existsSync(manifestPath)) return null
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const key = subpath ? `./${subpath}` : '.'
  const exports: Record<string, unknown> = manifest.exports ?? {}
  const pick = (entry: unknown): string | undefined => {
    if (typeof entry === 'string') return entry
    const conditions = entry as { import?: string; default?: string; types?: string } | undefined
    return conditions?.import ?? conditions?.default ?? conditions?.types
  }
  const exact = pick(exports[key])
  if (exact) return firstFile([resolve(pkgDir, exact)])
  // A subpath pattern (`"./*": "./src/entries/*.ts"`), longest prefix first, as Node matches it.
  const patterns = Object.keys(exports)
    .filter((pattern) => pattern.endsWith('/*') && key.startsWith(pattern.slice(0, -1)))
    .sort((a, b) => b.length - a.length)
  for (const pattern of patterns) {
    const target = pick(exports[pattern])
    if (!target) continue
    const resolved = firstFile([
      resolve(pkgDir, target.replace('*', key.slice(pattern.length - 1))),
    ])
    if (resolved) return resolved
  }
  return null
}

function resolveSpecifier(specifier: string, importer: string): string | null {
  // Vite query suffixes (?worker, ?inline, ?url, ?raw) and assets are not modules we walk.
  if (/[?#]/.test(specifier) || /\.(css|svg|png|jpe?g|woff2?|json)$/.test(specifier)) return null
  if (specifier.startsWith('@/')) {
    return firstFile(EXTENSIONS.map((ext) => resolve(UI_SRC, specifier.slice(2)) + ext))
  }
  if (specifier.startsWith('.')) {
    return firstFile(EXTENSIONS.map((ext) => resolve(dirname(importer), specifier) + ext))
  }
  for (const [name, dir] of Object.entries(WORKSPACE_PACKAGES)) {
    if (specifier === name) return resolvePackage(resolve(repoRoot, dir), '')
    if (specifier.startsWith(`${name}/`)) {
      const subpath = specifier.slice(name.length + 1)
      const resolved = resolvePackage(resolve(repoRoot, dir), subpath)
      if (resolved || name !== '@localixai/kit') return resolved
      return firstFile(EXTENSIONS.map((ext) => resolve(KIT_LENT_DIR, subpath) + ext))
    }
  }
  // Third-party packages are out of scope: this guard is about first-party edges.
  return null
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * A statement is TYPE-ONLY when every specifier it names is a type — those erase, so
 * the module is never loaded. `import { type A, B }` keeps B, and therefore the edge.
 */
function isTypeOnly(clause: string): boolean {
  const trimmed = clause.trim()
  if (trimmed.startsWith('type ') || trimmed.startsWith('type{')) return true
  const named = trimmed.match(/^\{([\s\S]*)\}$/)
  if (!named) return false
  const specifiers = named[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  return specifiers.length > 0 && specifiers.every((part) => part.startsWith('type '))
}

/** Every module specifier this file loads at runtime, type-only edges excluded. */
export function runtimeImports(source: string): string[] {
  const code = stripComments(source)
  const found = new Set<string>()
  for (const match of code.matchAll(
    /(?:^|[;}\n])\s*(?:import|export)\s+([\s\S]*?)\sfrom\s*['"]([^'"]+)['"]/g,
  )) {
    if (!isTypeOnly(match[1])) found.add(match[2])
  }
  for (const match of code.matchAll(/(?:^|[;}\n])\s*import\s*['"]([^'"]+)['"]/g)) {
    found.add(match[1])
  }
  for (const match of code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    found.add(match[1])
  }
  return [...found]
}

export interface BuiltinReach {
  builtin: string
  /** Importer first, web entry last. */
  chain: string[]
}

/** Walk the runtime module graph from one entry and report every `node:` import in it. */
export function reachesNodeBuiltins(entry: string): BuiltinReach[] {
  const start = resolve(repoRoot, entry)
  const parents = new Map<string, string>()
  const seen = new Set<string>()
  const hits: BuiltinReach[] = []
  const queue = [start]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    for (const specifier of runtimeImports(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('node:')) {
        const chain = [file]
        for (let at = parents.get(file); at; at = parents.get(at)) chain.push(at)
        hits.push({ builtin: specifier, chain: chain.map((path) => relative(repoRoot, path)) })
        continue
      }
      const target = resolveSpecifier(specifier, file)
      if (!target || seen.has(target)) continue
      if (!parents.has(target)) parents.set(target, file)
      queue.push(target)
    }
  }
  return hits
}

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
    expect(entries.some((entry) => entry.startsWith('plugins/'))).toBe(true)
    expect(entries.some((entry) => entry.includes('/contrib.'))).toBe(true)
    expect(report(entries.flatMap((entry) => reachesNodeBuiltins(entry)))).toEqual([])
  })

  // Positive control: the walker only earns the test above if it would fire. The api's
  // chat contracts legitimately use `node:path` — server code, never the browser's.
  test('the walker finds a builtin that IS reachable', () => {
    const hits = reachesNodeBuiltins('apps/api/src/features/chat/contracts.ts')
    expect(hits.map((hit) => hit.builtin)).toContain('node:path')
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

describe('the api client barrel stays type-only', () => {
  // The barrel is the single easiest way to reintroduce the whole failure: it re-exports
  // from the server's own contracts, so ONE value export there is a bundle away from
  // `node:dns`. Values shared with the browser get their own subpath in the export map.
  test('client.ts re-exports no value', () => {
    const source = readFileSync(resolve(repoRoot, 'apps/api/src/client.ts'), 'utf8')
    const valueEdges = runtimeImports(source).filter((specifier) => specifier.startsWith('.'))
    const offenders = valueEdges.filter((specifier) => {
      const target = resolveSpecifier(specifier, resolve(repoRoot, 'apps/api/src/client.ts'))
      return target !== null && reachesNodeBuiltins(relative(repoRoot, target)).length > 0
    })
    expect(offenders).toEqual([])
  })
})
