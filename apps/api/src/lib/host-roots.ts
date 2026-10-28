import { realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { localixHome } from './env'
import { isPathWithin } from './path-containment'

/**
 * THE HOST'S OWN ROOTS — the directories that belong to the running Localix application.
 *
 * The defect this stops: an agent was able to read and edit the application that runs it.
 * Its tools resolved paths against the API's launch directory, which is the monorepo checkout
 * in development and the install directory in a packaged build, so a relative `read` or a
 * `cd ..` landed in the host's own source or resources. An agent knows `~/.localix` and the
 * project the user opened; the application is neither.
 *
 * So one question is answered here, once, from the running module's OWN location (the same
 * self-location rule as `bundled-root.ts`, because the bundler rewrites `import.meta.url` to the
 * output file): which directories are the application?
 *
 *   - SOURCE layout (development): this file sits at `apps/api/src/lib/`, so the checkout root
 *     is four levels up. That covers the dev mini app staging under `<repo>/.turbo` as well.
 *   - BUNDLED layout (packaged): the server bundle's directory, plus its staging container when
 *     that is one of the known shapes (`resources/` in the desktop app, `server/` in the CLI
 *     package), plus the enclosing `*.app` bundle on macOS.
 *
 * Then every candidate is FILTERED so a host root can never swallow the agent's own world: a
 * root that is the filesystem root, the home directory or an ancestor of it, or that contains or
 * sits inside `~/.localix`, is dropped. A Linux install under a home directory therefore protects
 * its own directory and nothing above it.
 */

export interface HostRootInputs {
  /** Absolute path of the module computing the roots, as the runtime sees it. */
  moduleFile: string
  home: string
  localixHome: string
  /** Canonicalizer; tests inject identity. Failures fall back to the lexical path. */
  realpath?: (p: string) => string
}

const SOURCE_LAYOUT = ['apps', 'api', 'src', 'lib']
const STAGING_CONTAINERS = new Set(['resources', 'server'])

function canonicalOr(realpath: (p: string) => string, value: string): string {
  try {
    return realpath(value)
  } catch {
    return value
  }
}

function layoutCandidates(moduleDir: string): string[] {
  const segments = moduleDir.split(path.sep)
  const tail = segments.slice(-SOURCE_LAYOUT.length)
  if (tail.join('/') === SOURCE_LAYOUT.join('/')) {
    return [path.resolve(moduleDir, ...SOURCE_LAYOUT.map(() => '..'))]
  }
  const found = [moduleDir]
  if (STAGING_CONTAINERS.has(path.basename(moduleDir))) found.push(path.dirname(moduleDir))
  const appIndex = segments.findIndex((s) => s.endsWith('.app'))
  if (appIndex > 0) found.push(segments.slice(0, appIndex + 1).join(path.sep))
  return found
}

/** Pure: the host roots for injected inputs. Both lexical and canonical spellings are kept. */
export function computeHostRoots(inputs: HostRootInputs): string[] {
  const realpath = inputs.realpath ?? ((p: string) => realpathSync.native(p))
  const guardedHome = [inputs.home, canonicalOr(realpath, inputs.home)]
  const guardedState = [inputs.localixHome, canonicalOr(realpath, inputs.localixHome)]
  const roots = new Set<string>()
  for (const candidate of layoutCandidates(path.dirname(inputs.moduleFile))) {
    for (const spelling of [candidate, canonicalOr(realpath, candidate)]) {
      if (path.parse(spelling).root === spelling) continue
      if (guardedHome.some((h) => isPathWithin(spelling, h))) continue
      if (guardedState.some((s) => isPathWithin(spelling, s) || isPathWithin(s, spelling))) continue
      roots.add(spelling)
    }
  }
  return [...roots]
}

let memo: string[] | undefined

/** The running application's roots, computed once per process. */
export function hostRoots(): readonly string[] {
  memo ??= computeHostRoots({
    moduleFile: fileURLToPath(import.meta.url),
    home: os.homedir(),
    localixHome: localixHome(),
  })
  return memo
}

/**
 * Canonical form of a path that may not exist yet: the nearest existing ancestor is resolved
 * and the missing tail re-attached, so a symlink pointing INTO a host root is judged by its
 * target, and a file about to be created is judged by the directory it lands in.
 */
export function canonicalCandidate(candidate: string): string {
  let head = path.resolve(candidate)
  const tail: string[] = []
  for (;;) {
    try {
      return path.join(realpathSync.native(head), ...tail.reverse())
    } catch {
      const parent = path.dirname(head)
      if (parent === head) return path.resolve(candidate)
      tail.push(path.basename(head))
      head = parent
    }
  }
}

/** The host root containing `candidate` (lexically or canonically), if any. */
export function hostRootContaining(
  candidate: string,
  roots: readonly string[] = hostRoots(),
): string | undefined {
  const spellings = [path.resolve(candidate), canonicalCandidate(candidate)]
  return roots.find((root) => spellings.some((s) => isPathWithin(root, s)))
}

let readableProvider: () => readonly string[] = () => []

/**
 * Directories inside a host root that agents may READ (never write): the mini app kit, whose SDK
 * declarations are the contract a mini app is written against. The mini apps feature owns where
 * it is; bootstrap registers it here, so this lib names no feature.
 */
export function setReadableHostRoots(provider: () => readonly string[]): void {
  readableProvider = provider
}

/** The registered read-only exemptions, in lexical and canonical spelling. */
export function readableHostRoots(): string[] {
  return readableProvider().flatMap((dir) => [dir, canonicalCandidate(dir)])
}
