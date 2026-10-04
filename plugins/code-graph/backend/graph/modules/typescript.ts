import { posix } from 'node:path'
import { isAtOrUnder, isStrictlyUnder } from '@localixai/path-containment/ancestry'
import { normalize, type ProjectConfig, type TsPathConfig, type WorkspacePackage } from './config'
import type { ModuleTarget, ProjectFiles } from './target'

/**
 * TypeScript/JavaScript module resolution, in the order the tools apply it: relative paths, the
 * governing tsconfig's `paths` (and a declared `baseUrl`), workspace packages by name, and only
 * then an external package.
 *
 * Probing follows what bundlers and `moduleResolution: bundler` accept, including the `.js`
 * specifier that names a `.ts` source — ESM TypeScript is written that way and would otherwise
 * resolve to nothing.
 */
const EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']
const SCRIPT_EXTENSION = /\.(?:[cm]?jsx?)$/
const SOURCE_FOR_SCRIPT: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
}

export function createTypeScriptResolver(project: ProjectFiles, config: ProjectConfig) {
  const packages = [...config.packages].sort((a, b) => b.name.length - a.name.length)

  // `project.files` holds only paths inside the project, so a base that escapes it (`../x`) misses
  // every lookup below by construction — no prefix test, which also misread a file named `..x`.
  function probe(base: string): string | null {
    if (project.files.has(base)) return base
    const script = SCRIPT_EXTENSION.exec(base)?.[0]
    if (script) {
      const stem = base.slice(0, -script.length)
      for (const ext of SOURCE_FOR_SCRIPT[script] ?? []) {
        if (project.files.has(stem + ext)) return stem + ext
      }
    }
    for (const ext of EXTENSIONS) if (project.files.has(base + ext)) return base + ext
    const index = base ? `${base}/index` : 'index'
    for (const ext of EXTENSIONS) if (project.files.has(index + ext)) return index + ext
    return null
  }

  function viaPaths(from: string, specifier: string): string | null {
    const governing = config.tsconfigs.find((ts) => ts.dir === '' || isStrictlyUnder(ts.dir, from))
    if (!governing) return null
    const aliased = matchPaths(governing, specifier, probe)
    if (aliased) return aliased
    return governing.baseUrlDeclared
      ? probe(normalize(posix.join(governing.baseUrl, specifier)))
      : null
  }

  function viaPackage(specifier: string): string | null {
    // A specifier names the package or one of its subpaths: ancestry over `/`-separated names.
    const owner = packages.find((pkg) => isAtOrUnder(pkg.name, specifier))
    if (!owner) return null
    const rest = specifier.slice(owner.name.length + 1)
    return packageEntry(owner, rest ? `./${rest}` : '.', rest, probe)
  }

  return function resolve(from: string, specifier: string): ModuleTarget | null {
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      const base = specifier.startsWith('/')
        ? normalize(specifier.slice(1))
        : normalize(posix.join(posix.dirname(from), specifier))
      const path = probe(base)
      return path ? { kind: 'file', path } : null
    }
    const local = viaPaths(from, specifier) ?? viaPackage(specifier)
    if (local) return { kind: 'file', path: local }
    return { kind: 'package', name: externalName(specifier) }
  }
}

function matchPaths(
  ts: TsPathConfig,
  specifier: string,
  probe: (base: string) => string | null,
): string | null {
  for (const { pattern, targets } of ts.paths) {
    const star = pattern.indexOf('*')
    let captured: string | null = null
    if (star < 0) captured = pattern === specifier ? '' : null
    else {
      const prefix = pattern.slice(0, star)
      const suffix = pattern.slice(star + 1)
      if (
        specifier.startsWith(prefix) &&
        specifier.endsWith(suffix) &&
        specifier.length >= prefix.length + suffix.length
      ) {
        captured = specifier.slice(prefix.length, specifier.length - suffix.length)
      }
    }
    if (captured === null) continue
    for (const target of targets) {
      const path = probe(normalize(posix.join(ts.baseUrl, target.replace('*', captured))))
      if (path) return path
    }
  }
  return null
}

/**
 * A workspace package's file for a subpath. The declared entry first; when it names build output
 * the graph does not contain (`dist/index.js`), the source beside it (`src/index.ts`), then the
 * conventional source locations. A package's sources are what the map is about, not its build.
 */
function packageEntry(
  pkg: WorkspacePackage,
  subpath: string,
  rest: string,
  probe: (base: string) => string | null,
): string | null {
  const declared = pkg.entries.get(subpath) ?? wildcardEntry(pkg, subpath)
  if (declared) {
    const found =
      probe(declared) ?? probe(declared.replace(/(^|\/)(dist|build|lib|out)\//, '$1src/'))
    if (found) return found
    const stem = declared.replace(/\.d\.ts$|\.[cm]?[jt]sx?$/, '')
    const fromBuild = probe(stem.replace(/(^|\/)(dist|build|lib|out)\//, '$1src/'))
    if (fromBuild) return fromBuild
  }
  const dir = pkg.dir ? `${pkg.dir}/` : ''
  return rest
    ? (probe(`${dir}src/${rest}`) ?? probe(`${dir}${rest}`))
    : (probe(`${dir}src/index`) ?? probe(`${dir}index`))
}

function wildcardEntry(pkg: WorkspacePackage, subpath: string): string | null {
  for (const [pattern, target] of pkg.entries) {
    const star = pattern.indexOf('*')
    if (star < 0) continue
    const prefix = pattern.slice(0, star)
    const suffix = pattern.slice(star + 1)
    if (subpath.startsWith(prefix) && subpath.endsWith(suffix)) {
      const captured = subpath.slice(prefix.length, subpath.length - suffix.length)
      return target.replace('*', captured)
    }
  }
  return null
}

/** `@scope/name/sub` → `@scope/name`; `lodash/fp` → `lodash`; `node:fs/promises` → `node:fs`. */
export function externalName(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') && parts.length > 1
    ? `${parts[0]}/${parts[1]}`
    : (parts[0] ?? specifier)
}
