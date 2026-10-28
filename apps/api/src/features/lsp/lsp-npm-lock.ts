import shipped from './language-server-locks.json'
import type { LspPackage, NpmSource } from './lsp-registry'

/**
 * THE LOCKFILE OF EACH NPM LANGUAGE SERVER. `language-servers.json` pins a server and its
 * `with` packages, but not what they depend on: left alone, `bun install` would pick the newest
 * transitive versions on the day of the install, with nothing but the registry to vouch for them.
 * `bun run --cwd apps/api lsp:update` therefore resolves each server's whole tree once and ships
 * the result into `language-server-locks.json` (id to the text of its `bun.lock`: versions and sha512
 * integrity of every package). It is imported like `language-servers.json`, so the desktop build's
 * single `server.js` carries it; the installer writes it beside the manifest and installs with `--frozen-lockfile`, so
 * the tree is the one that was reviewed or the install fails.
 */

export type NpmPackage = LspPackage & { source: NpmSource }

/** A week: an npm package published since is not installed (a hijacked release is caught first). */
export const MINIMUM_RELEASE_AGE_S = 7 * 24 * 60 * 60

/** The flags that resolving a lockfile and installing from it have in common. */
export const NPM_INSTALL_FLAGS = [
  '--ignore-scripts',
  `--minimum-release-age=${MINIMUM_RELEASE_AGE_S}`,
]

/** The shipped lockfiles: server id to the text of its `bun.lock`. */
export type LockfileMap = Readonly<Record<string, string>>
export const SHIPPED_LOCKS: LockfileMap = shipped

export interface NpmManifest {
  name: string
  private: true
  dependencies: Record<string, string>
}

/** The `package.json` an npm server installs from: exact versions, nothing else. */
export function npmManifest(pkg: NpmPackage): NpmManifest {
  return {
    name: `localix-lsp-${pkg.id}`,
    private: true,
    dependencies: Object.fromEntries(
      [pkg.source, ...pkg.with].map((each) => [each.name, each.version]),
    ),
  }
}

/** Whether a lockfile was resolved from exactly this manifest (a pinned version has not moved). */
export function lockMatches(lock: string, manifest: NpmManifest): boolean {
  try {
    const parsed = Bun.JSONC.parse(lock) as {
      workspaces?: Record<string, { name?: string; dependencies?: Record<string, string> }>
    }
    const root = parsed.workspaces?.['']
    return (
      root?.name === manifest.name &&
      JSON.stringify(sorted(root.dependencies)) === JSON.stringify(sorted(manifest.dependencies))
    )
  } catch {
    return false
  }
}

const sorted = (record: Record<string, string> = {}) =>
  Object.entries(record).sort(([a], [b]) => a.localeCompare(b))
