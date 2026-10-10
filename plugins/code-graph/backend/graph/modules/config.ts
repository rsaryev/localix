import { readFile } from 'node:fs/promises'
import { join, posix } from 'node:path'

/**
 * How the project spells its own modules, read from the files that declare it.
 *
 * Without this every aliased or workspace import (`@/lib/x`, `@acme/core/sub`) looks external: in a
 * monorepo that is most of the imports, and the map would show packages talking to nothing. Only
 * the declarations are read — path aliases, workspace package names and entry points, Go module
 * paths — never the tools' full resolution algorithms.
 */
export interface TsPathConfig {
  /** Directory of the tsconfig/jsconfig that declared the aliases, project-relative. */
  dir: string
  /** Project-relative directory `paths` targets resolve from. */
  baseUrl: string
  /** A declared `baseUrl` also makes bare specifiers (`components/x`) resolve from it. */
  baseUrlDeclared: boolean
  paths: Array<{ pattern: string; targets: string[] }>
}

export interface WorkspacePackage {
  name: string
  dir: string
  /** Subpath (`.`, `./backend`) → the file it points to, project-relative, as declared. */
  entries: Map<string, string>
}

export interface GoModule {
  module: string
  dir: string
}

export interface ProjectConfig {
  tsconfigs: TsPathConfig[]
  packages: WorkspacePackage[]
  goModules: GoModule[]
}

export async function readProjectConfig(root: string, paths: string[]): Promise<ProjectConfig> {
  const config: ProjectConfig = { tsconfigs: [], packages: [], goModules: [] }
  for (const path of paths) {
    const dir = posix.dirname(path) === '.' ? '' : posix.dirname(path)
    const name = posix.basename(path)
    if (name === 'go.mod') {
      const text = await readFile(join(root, path), 'utf8').catch(() => '')
      const module = /^module\s+(\S+)/m.exec(text)?.[1]
      if (module) config.goModules.push({ module, dir })
    } else if (name === 'package.json') {
      const manifest = parseJsonc(await readFile(join(root, path), 'utf8').catch(() => ''))
      const packageName = typeof manifest?.name === 'string' ? manifest.name : null
      if (manifest && packageName) {
        config.packages.push({ name: packageName, dir, entries: entries(manifest, dir) })
      }
    } else {
      const ts = await readTsPaths(root, path, 0)
      if (ts && (ts.paths.length > 0 || ts.baseUrlDeclared)) config.tsconfigs.push({ ...ts, dir })
    }
  }
  // Deepest first: the nearest tsconfig to a file is the one that governs it.
  config.tsconfigs.sort((a, b) => b.dir.length - a.dir.length)
  return config
}

/** `paths` and `baseUrl`, following relative `extends` the way tsc merges them. */
async function readTsPaths(
  root: string,
  path: string,
  depth: number,
): Promise<Omit<TsPathConfig, 'dir'> | null> {
  if (depth > 5) return null
  const json = parseJsonc(await readFile(join(root, path), 'utf8').catch(() => ''))
  if (!json) return null
  const dir = posix.dirname(path) === '.' ? '' : posix.dirname(path)
  const extendsPath = typeof json.extends === 'string' ? json.extends : null
  const inherited =
    extendsPath?.startsWith('.') === true
      ? await readTsPaths(root, normalize(posix.join(dir, withJson(extendsPath))), depth + 1)
      : null
  const options = (json.compilerOptions ?? {}) as Record<string, unknown>
  const baseUrl =
    typeof options.baseUrl === 'string' ? normalize(posix.join(dir, options.baseUrl)) : null
  const declared = options.paths && typeof options.paths === 'object' ? options.paths : null
  const paths = declared
    ? Object.entries(declared as Record<string, unknown>).map(([pattern, targets]) => ({
        pattern,
        targets: Array.isArray(targets) ? targets.filter((t) => typeof t === 'string') : [],
      }))
    : null
  // Since TypeScript 4.1 `paths` resolve against the declaring file's directory when there is
  // no `baseUrl`.
  return {
    baseUrl: baseUrl ?? (paths ? dir : (inherited?.baseUrl ?? dir)),
    baseUrlDeclared: baseUrl !== null || (!paths && inherited?.baseUrlDeclared === true),
    paths: paths ?? inherited?.paths ?? [],
  }
}

const withJson = (path: string) => (path.endsWith('.json') ? path : `${path}.json`)

/** A project-relative path without `./` segments; '' for the root. Escapes stay as `..`. */
export function normalize(path: string): string {
  const normal = posix.normalize(path)
  return normal === '.' ? '' : normal.replace(/^\.\//, '').replace(/\/$/, '')
}

function entries(manifest: Record<string, unknown>, dir: string): Map<string, string> {
  const map = new Map<string, string>()
  const add = (subpath: string, target: unknown) => {
    const file = pickTarget(target)
    if (file) map.set(subpath, normalize(posix.join(dir, file)))
  }
  const declared = manifest.exports
  if (typeof declared === 'string') add('.', declared)
  else if (declared && typeof declared === 'object') {
    const keys = Object.keys(declared)
    if (keys.every((key) => key.startsWith('.'))) {
      for (const [key, target] of Object.entries(declared)) add(key, target)
    } else add('.', declared)
  }
  if (!map.has('.')) add('.', manifest.source ?? manifest.module ?? manifest.main)
  return map
}

/** The source-most condition of an exports target: sources beat builds when both are listed. */
function pickTarget(target: unknown): string | null {
  if (typeof target === 'string') return target
  if (!target || typeof target !== 'object') return null
  const conditions = target as Record<string, unknown>
  for (const key of ['source', 'bun', 'development', 'import', 'module', 'default', 'require']) {
    const picked = pickTarget(conditions[key])
    if (picked) return picked
  }
  return pickTarget(conditions.types)
}

/**
 * JSON with comments and trailing commas, as tsconfig and some package.json files are written.
 * Strings are copied verbatim, so a `//` inside a path is never mistaken for a comment.
 */
export function parseJsonc(text: string): Record<string, unknown> | null {
  let out = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      const start = index
      for (index += 1; index < text.length && text[index] !== '"'; index += 1) {
        if (text[index] === '\\') index += 1
      }
      out += text.slice(start, index + 1)
    } else if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index += 1
    } else if (char === '/' && text[index + 1] === '*') {
      index = text.indexOf('*/', index + 2)
      if (index < 0) break
      index += 1
    } else out += char
  }
  try {
    const value: unknown = JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
