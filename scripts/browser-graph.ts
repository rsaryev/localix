import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { runtimeImports } from './runtime-imports'
import { MINI_APPS_DIR } from './lib/bundled-roots.mjs'

export const repoRoot = resolve(import.meta.dir, '..')

/** Workspace packages resolved from source, exactly as their export maps declare. */
const WORKSPACE_PACKAGES: Record<string, string> = {
  '@localixai/api': 'apps/api',
  '@localixai/agent': 'packages/agent',
  '@localixai/plugin-sdk': 'packages/plugin-sdk',
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
  `${MINI_APPS_DIR}/*/ui/register.{ts,tsx}`,
]

export function webEntries(): string[] {
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

export function resolveSpecifier(specifier: string, importer: string): string | null {
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

export interface BuiltinReach {
  builtin: string
  /** Importer first, web entry last. */
  chain: string[]
}

/** Walk each reachable module once, even when several entries share its dependencies. */
export function reachesNodeBuiltins(entry: string | readonly string[]): BuiltinReach[] {
  const starts = new Set(
    (typeof entry === 'string' ? [entry] : entry).map((path) => resolve(repoRoot, path)),
  )
  const parents = new Map<string, string>()
  const seen = new Set<string>()
  const hits: BuiltinReach[] = []
  const queue = [...starts]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    for (const specifier of runtimeImports(readFileSync(file, 'utf8'), file)) {
      if (specifier.startsWith('node:')) {
        const chain = [file]
        for (let at = parents.get(file); at; at = parents.get(at)) chain.push(at)
        hits.push({ builtin: specifier, chain: chain.map((path) => relative(repoRoot, path)) })
        continue
      }
      const target = resolveSpecifier(specifier, file)
      if (!target || seen.has(target)) continue
      if (!starts.has(target) && !parents.has(target)) parents.set(target, file)
      queue.push(target)
    }
  }
  return hits
}
