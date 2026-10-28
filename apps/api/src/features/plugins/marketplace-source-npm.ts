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

const execFileAsync = promisify(execFile)

/**
 * npm plugin sources for marketplaces — the CC-spec shape
 * `{ "source": "npm", "package": "@org/plugin", "version"?: "^2.0.0", "registry"?: "…" }`.
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

/** An npm plugin source (CC marketplace spec). */
export interface NpmEntrySource {
  package: string
  /** An `https` link to the package's tarball, given as `package`: fetched as it is. */
  tarball?: string
  version?: string
  registry?: string
}

/** npm package name: optional @scope/, lowercase URL-safe chars (blocks URL injection). */
const NPM_NAME_RE = /^(@[a-z0-9~][\w.~-]*\/)?[a-z0-9~][\w.~-]*$/

/**
 * Recognize an entry-source object as an npm source. Returns null for non-npm objects;
 * throws when it IS npm-shaped but unusable (no/invalid package name). Accepts the
 * spec form `source:"npm"` + `package`, as Claude Code's marketplace schema writes it.
 */
export function parseNpmEntrySource(
  entryName: string,
  obj: Record<string, unknown>,
): NpmEntrySource | null {
  const isNpm = obj.source === 'npm'
  if (!isNpm) return null
  const raw = typeof obj.package === 'string' ? obj.package : undefined
  if (raw && /^https?:\/\//i.test(raw)) return tarballSource(entryName, raw)
  // `@org/formatter@2.0.0`: a version appended to the name (the scope's `@` is not one).
  const at = raw ? raw.lastIndexOf('@') : -1
  const appended = raw && at > 0 ? raw.slice(at + 1) : undefined
  const pkg = appended ? raw!.slice(0, at) : raw
  if (!pkg || !NPM_NAME_RE.test(pkg)) {
    throw new InvalidRequestError(
      'plugin_npm_bad_source',
      `Entry "${entryName}" npm source needs a valid "package" name (got ${JSON.stringify(pkg ?? null)}).`,
    )
  }
  const version = appended ?? (typeof obj.version === 'string' ? obj.version : undefined)
  return {
    package: pkg,
    ...(version ? { version } : {}),
    ...(typeof obj.registry === 'string' ? { registry: obj.registry } : {}),
  }
}

/** Git hosts whose download links are not npm tarballs (GitLab's npm registry API aside). */
const GIT_HOSTS = new Set([
  'github.com',
  'gist.github.com',
  'gitlab.com',
  'bitbucket.org',
  'git.sr.ht',
])

/** A tarball link given as `package`; whether plain http may reach it is checked on fetch. */
function tarballSource(entryName: string, link: string): NpmEntrySource {
  const url = URL.canParse(link) ? new URL(link) : null
  const host = url?.hostname.toLowerCase().replace(/^www\./, '')
  const gitlabRegistry = host === 'gitlab.com' && url!.pathname.startsWith('/api/v4/')
  if (!url || (host && GIT_HOSTS.has(host) && !gitlabRegistry))
    throw new InvalidRequestError(
      'plugin_npm_bad_source',
      `Entry "${entryName}" npm source "${link}" is refused: a tarball link on a git host is not an npm package; use a github, url or git-subdir source.`,
    )
  const name = decodeURIComponent(url.pathname.split('/').at(-1) ?? '').replace(
    /\.t?gz$|\.tar\.gz$/i,
    '',
  )
  return { package: name || link, tarball: url.href }
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
  src: NpmEntrySource,
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
  src: NpmEntrySource,
  dest: string,
  opts: { defaultRegistry?: string; env?: NodeJS.ProcessEnv; home?: string } = {},
): Promise<void> {
  // The registry npm would use for this package (its scope's line, else the default). A catalog's
  // own `registry` still wins for the lookup, but plain http stays allowed only on the user's own
  // registry, checked before anything is contacted.
  const defaultRegistry =
    opts.defaultRegistry ?? (await userNpmRegistryFor(src.package, opts.env, opts.home))
  const auth = await npmAuthFor(opts.env, opts.home)
  const meta = src.tarball
    ? null
    : await fetchPackument(src, defaultRegistry, src.registry ?? defaultRegistry, auth)
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
