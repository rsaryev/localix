import { InvalidRequestError } from '../../lib/domain-errors'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { ApiError, errorMessage } from '../../lib/errors'
import { childEnv } from '../../lib/login-shell-env'
import { rmrf } from '../ext/install-tree'
import { fetchChecked, readCapped } from './marketplace-download'
import { assertGunzipWithin } from './marketplace-gzip-limit'
import { npmAuthFor } from './marketplace-npm-auth'
import { downloadNpmTarball } from './marketplace-npm-integrity'
import { DEFAULT_NPM_REGISTRY, npmHop, userNpmRegistryFor } from './marketplace-npm-registry'
import type { NpmFetchPlan } from '@rsaryev/llx-plugin/marketplace'

const execFileAsync = promisify(execFile)

/**
 * Runs the kit's plan for an npm plugin source (`NpmFetchPlan`, from `planPluginFetch`, which
 * read and checked the entry's `package`, `version` and `registry`).
 *
 * Resolution goes straight at the npm registry HTTP API (no npm CLI): GET
 * `<registry>/<package>` for the packument, pick a version (exact → dist-tag → semver
 * range via `Bun.semver`), download `dist.tarball`, verify `dist.integrity`/`shasum`,
 * and extract into the caller's staging dir (npm tarballs are gzipped tars with a
 * single `package/`-style top folder, stripped on extract — same staging conventions
 * as the git path in `marketplace-registry.ts`). Every failure is a per-entry
 * `ApiError`, so one bad npm entry never breaks the rest of the marketplace.
 */

/** Packument ceiling: a plugin's metadata is small; the body comes from a catalog-chosen host. */
export const MAX_NPM_METADATA_BYTES = 64 * 1024 * 1024

/** The package an npm plan names, its version, and the tarball link given as `package`. */
function packageOf(plan: NpmFetchPlan): { package: string; version?: string; tarball?: string } {
  if ('package' in plan.spec) return { package: plan.spec.package, version: plan.spec.version }
  const url = new URL(plan.spec.tarballUrl)
  const name = decodeURIComponent(url.pathname.split('/').at(-1) ?? '').replace(/\.t?gz$/i, '')
  return { package: name || url.href, tarball: url.href }
}

/** Packument URL for a package: scoped names URL-encode the `/` (npm registry API). */
export function npmMetadataUrl(pkg: string, registry?: string): string {
  const base = (registry ?? DEFAULT_NPM_REGISTRY).replace(/\/+$/, '')
  return `${base}/${pkg.replace('/', '%2f')}`
}

interface Packument {
  'dist-tags'?: Record<string, string>
  versions?: Record<string, { dist?: { tarball?: string; integrity?: string; shasum?: string } }>
}

/**
 * Pick the version to install: no spec → `latest` dist-tag; exact published version →
 * itself; a dist-tag name → its target; anything else is a semver range satisfied
 * against the published versions (highest wins, via `Bun.semver`).
 */
export function pickNpmVersion(pkg: string, meta: Packument, spec?: string): string {
  const versions = Object.keys(meta.versions ?? {})
  const tags = meta['dist-tags'] ?? {}
  if (!spec) {
    if (tags.latest && meta.versions?.[tags.latest]) return tags.latest
    throw new InvalidRequestError(
      'plugin_npm_no_version',
      `npm package "${pkg}" has no latest version.`,
    )
  }
  if (meta.versions?.[spec]) return spec
  if (tags[spec] && meta.versions?.[tags[spec]]) return tags[spec]
  const matches = versions.filter((v) => Bun.semver.satisfies(v, spec))
  if (matches.length === 0) {
    throw new InvalidRequestError(
      'plugin_npm_no_version',
      `npm package "${pkg}" has no version satisfying "${spec}" (published: ${versions.slice(-5).join(', ') || 'none'}).`,
    )
  }
  const sorted = matches.sort((a, b) => Bun.semver.order(a, b))
  return sorted[sorted.length - 1] as string
}

const NPM_METADATA_TIMEOUT_MS = 60_000
const NPM_TARBALL_TIMEOUT_MS = 120_000

/** GET an npm URL, every redirect hop https (or http on the user's own default registry). */
async function fetchNpm(
  url: string,
  what: string,
  defaultRegistry: string,
  timeoutMs: number,
  headers?: (url: URL) => Record<string, string> | undefined,
): Promise<Response> {
  const download = { what, timeoutMs, checkHop: npmHop(defaultRegistry), headers }
  return (await fetchChecked(url, { ...download, code: 'plugin_npm_fetch_failed' })).response
}

/** The package's packument, its body capped and every failure a per-entry `ApiError`. */
async function fetchPackument(
  src: { package: string },
  defaultRegistry: string,
  registry: string,
  headers: (url: URL) => Record<string, string> | undefined,
): Promise<Packument> {
  const what = `npm metadata for "${src.package}"`
  const response = await fetchNpm(
    npmMetadataUrl(src.package, registry),
    what,
    defaultRegistry,
    NPM_METADATA_TIMEOUT_MS,
    headers,
  )
  const body = await readCapped(response, MAX_NPM_METADATA_BYTES, {
    what,
    timeoutMs: NPM_METADATA_TIMEOUT_MS,
    code: 'plugin_npm_fetch_failed',
    tooLargeCode: 'plugin_npm_metadata_too_large',
  })
  try {
    return JSON.parse(body.toString('utf8')) as Packument
  } catch (err) {
    throw new InvalidRequestError(
      'plugin_npm_fetch_failed',
      `${what} is not JSON: ${errorMessage(err)}`,
    )
  }
}

/**
 * Resolve + download + verify + extract an npm plugin source into `dest` (created,
 * previous content replaced). The tarball's single top-level folder (`package/` for
 * npm-published tarballs) is stripped so `dest` IS the plugin dir — the same shape the
 * git clone path stages, ready for `installFromLocal`.
 */
export async function fetchNpmPlugin(
  plan: NpmFetchPlan,
  dest: string,
  opts: { defaultRegistry?: string; env?: NodeJS.ProcessEnv; home?: string } = {},
): Promise<void> {
  // The registry npm would use for this package (its scope's line, else the default). A catalog's
  // own `registry` still wins for the lookup, but plain http stays allowed only on the user's own
  // registry, checked before anything is contacted.
  const src = packageOf(plan)
  const defaultRegistry =
    opts.defaultRegistry ?? (await userNpmRegistryFor(src.package, opts.env, opts.home))
  const auth = await npmAuthFor(opts.env, opts.home)
  const meta = src.tarball
    ? null
    : await fetchPackument(src, defaultRegistry, plan.registry ?? defaultRegistry, auth)
  const version = meta ? pickNpmVersion(src.package, meta, src.version) : 'tarball'
  const dist = meta ? meta.versions?.[version]?.dist : { tarball: src.tarball }
  if (!dist?.tarball) {
    throw new InvalidRequestError(
      'plugin_npm_fetch_failed',
      `npm package "${src.package}@${version}" has no dist.tarball.`,
    )
  }
  const tarRes = await fetchNpm(
    dist.tarball,
    `npm tarball for "${src.package}@${version}"`,
    defaultRegistry,
    NPM_TARBALL_TIMEOUT_MS,
    auth,
  )
  const packageVersion = `${src.package}@${version}`
  const tmpFile = join(tmpdir(), `localix-npm-${randomUUID()}.tgz`)
  try {
    await downloadNpmTarball(packageVersion, tarRes, tmpFile, dist)
    await assertGunzipWithin(tmpFile, `npm tarball for "${packageVersion}"`)
    await rmrf(dest)
    await fs.mkdir(dest, { recursive: true })
    // npm tarballs wrap everything in one `package/` folder — strip it on extract.
    await execFileAsync('tar', ['-xzf', tmpFile, '-C', dest, '--strip-components=1'], {
      timeout: 60_000,
      env: childEnv(),
      windowsHide: true,
    })
  } catch (err) {
    await rmrf(dest)
    if (err instanceof ApiError) throw err
    throw new InvalidRequestError(
      'plugin_npm_extract_failed',
      `Extracting npm tarball for "${src.package}@${version}" failed: ${errorMessage(err)}`,
    )
  } finally {
    await rmrf(tmpFile)
  }
}
