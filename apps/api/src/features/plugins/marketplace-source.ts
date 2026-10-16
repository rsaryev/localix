import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { errorMessage } from '../../lib/errors'
import { isPathWithin } from '../../lib/path-containment'
import { parseNpmEntrySource, type NpmEntrySource } from './marketplace-source-npm'
import type { MarketplaceEntry } from './marketplace'

/**
 * Pure source-parsing + path helpers for the marketplace registry — no I/O, no host
 * deps. Splitting these off keeps the parsing logic trivially unit-testable and isolated
 * from the clone/fs/known.json machinery in `marketplace-registry.ts`.
 */

/** A marketplace source, tagged by kind. */
export type MarketplaceSource =
  | { source: 'github'; repo: string; ref?: string }
  | { source: 'git'; url: string; ref?: string }
  | { source: 'local'; path: string }
  | ({ source: 'npm' } & NpmEntrySource)

/**
 * Recognize an object-shaped marketplace source as npm — the CC
 * `extraKnownMarketplaces` source model, the same shapes npm ENTRY sources accept
 * (`{source:'npm', package, version?, registry?}` plus the legacy `npm:"pkg"`
 * shorthand key). Invalid package names surface the entry path's typed error text.
 */
function parseNpmMarketplaceSource(
  obj: Record<string, unknown>,
): MarketplaceSource | { error: string } {
  try {
    const npm = parseNpmEntrySource('marketplace', obj)
    if (npm) return { source: 'npm', ...npm }
  } catch (err) {
    return { error: errorMessage(err) }
  }
  return {
    error:
      'Unsupported marketplace source object. Expected { "source": "npm", "package": "…", "version"?, "registry"? }.',
  }
}

/**
 * Parse a marketplace input into a tagged source (or an error). Accepts a
 * user-typed string (owner/repo, git/ssh URL, local path, or the `npm:pkg[@range]`
 * shorthand) or a CC-spec source object (npm, per `extraKnownMarketplaces`).
 */
export function parseMarketplaceInput(
  input: string | Record<string, unknown>,
): MarketplaceSource | { error: string } {
  if (typeof input !== 'string') return parseNpmMarketplaceSource(input)
  const trimmed = input.trim()
  if (!trimmed) return { error: 'Empty marketplace source.' }

  // npm shorthand: `npm:<package>[@<version|range|dist-tag>]` — consistent with how
  // entry sources spell npm packages (scoped names keep their leading `@`).
  if (trimmed.startsWith('npm:')) {
    const spec = trimmed.slice('npm:'.length)
    const at = spec.lastIndexOf('@')
    const pkg = at > 0 ? spec.slice(0, at) : spec
    const version = at > 0 ? spec.slice(at + 1) : undefined
    return parseNpmMarketplaceSource({
      source: 'npm',
      package: pkg,
      ...(version ? { version } : {}),
    })
  }

  // SSH git URL: user@host:path(.git)?(#ref)?
  const ssh = trimmed.match(/^([a-zA-Z0-9._-]+@[^:]+:.+?(?:\.git)?)(?:#(.+))?$/)
  if (ssh)
    return ssh[2] ? { source: 'git', url: ssh[1], ref: ssh[2] } : { source: 'git', url: ssh[1] }

  // HTTP(S) URL.
  if (/^https?:\/\//.test(trimmed)) {
    const [urlPart, ref] = trimmed.split('#', 2)
    return ref ? { source: 'git', url: urlPart, ref } : { source: 'git', url: urlPart }
  }

  // Local path.
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('~')
  ) {
    const path = resolve(trimmed.startsWith('~') ? trimmed.replace(/^~/, homedir()) : trimmed)
    return { source: 'local', path }
  }

  // owner/repo GitHub shorthand (optionally #ref).
  const gh = trimmed.match(/^([\w.-]+\/[\w.-]+)(?:#(.+))?$/)
  if (gh)
    return gh[2] ? { source: 'github', repo: gh[1], ref: gh[2] } : { source: 'github', repo: gh[1] }

  // `plugin@marketplace` typed into `marketplace add` (SSH `git@host:path` matched above).
  if (/^[^@\s/:]+@[^@\s:]+$/.test(trimmed))
    return {
      error: `"${trimmed}" looks like a plugin@marketplace reference; install it with /plugin install ${trimmed}`,
    }

  return {
    error: `Invalid marketplace source "${input}". Use owner/repo, https://…, git@…, npm:package, or an absolute path.`,
  }
}

/**
 * Does a stored source match a user-typed marketplace reference (`owner/repo`, a git URL)?
 * Lets `install name@owner/repo` find a marketplace registered under its catalog name.
 */
export function sourceMatchesRef(src: MarketplaceSource, ref: string): boolean {
  const norm = (v: string) =>
    v
      .trim()
      .replace(/^https?:\/\/github\.com\//, '')
      .replace(/\.git$/, '')
      .replace(/\/$/, '')
      .toLowerCase()
  const want = norm(ref)
  if (src.source === 'github') return norm(src.repo) === want
  if (src.source === 'git') return norm(src.url) === want
  if (src.source === 'npm') return src.package.toLowerCase() === want
  return false
}

/** The git clone URL for a remote source. */
export function sourceCloneUrl(src: MarketplaceSource): string | null {
  if (src.source === 'github') return `https://github.com/${src.repo}.git`
  if (src.source === 'git') return src.url
  return null
}

export function marketplacesRoot(base?: string): string {
  return join(base ?? homedir(), '.localix', 'marketplaces')
}

/** Parse a `plugin@marketplace` reference. Returns null when there's no `@marketplace` part. */
export function parseMarketplaceRef(ref: string): { plugin: string; marketplace: string } | null {
  const m = ref.trim().match(/^([^@\s]+)@([^@\s]+)$/)
  return m ? { plugin: m[1], marketplace: m[2] } : null
}

/**
 * Resolve a marketplace entry's `source` to either a local plugin directory (relative
 * `./path` inside the materialized marketplace, `..`-escapes rejected) or git
 * coordinates the caller clones.
 *
 * A relative string source resolves against `opts.pluginRoot` (the catalog's
 * `metadata.pluginRoot`, e.g. `./plugins`) when given, else the marketplace dir — but
 * always stays confined to the marketplace root. Object git sources honor a `sha` pin
 * (preferred over `ref`). An `npm` source returns registry coordinates the caller
 * downloads via `fetchNpmPlugin` (marketplace-source-npm.ts).
 */
export function resolveEntrySource(
  marketplaceDir: string,
  entry: MarketplaceEntry,
  opts?: { pluginRoot?: string },
):
  | { localPath: string }
  | { git: { url: string; subdir?: string; ref?: string } }
  | { npm: NpmEntrySource } {
  const root = resolve(marketplaceDir)
  // Base dir for relative sources: marketplace root + optional pluginRoot prefix.
  const base = opts?.pluginRoot ? resolve(marketplaceDir, opts.pluginRoot) : root
  const src = entry.source
  if (typeof src === 'string') {
    if (src.includes('..'))
      throw new Error(`Entry "${entry.name}" source "${src}" escapes the marketplace root`)
    const abs = resolve(base, src)
    if (!isPathWithin(root, abs))
      throw new Error(`Entry "${entry.name}" source resolves outside the marketplace`)
    return { localPath: abs }
  }
  const obj = src as Record<string, unknown>
  // npm source → registry coordinates (parse throws per-entry on a bad package name).
  const npm = parseNpmEntrySource(entry.name, obj)
  if (npm) return { npm }
  const url =
    typeof obj.url === 'string'
      ? obj.url
      : typeof obj.repo === 'string'
        ? `https://github.com/${obj.repo}.git`
        : undefined
  if (!url) throw new Error(`Entry "${entry.name}" has an unrecognized source`)
  // Git checkout target, precedence `sha > commit > ref` (spec/marketplaces.md §2):
  // a full `sha` is the effective pin (fetchable even if the ref was deleted upstream);
  // the `github` variant spells its pinned commit `commit`; `ref` is a branch/tag.
  const ref =
    typeof obj.sha === 'string'
      ? obj.sha
      : typeof obj.commit === 'string'
        ? obj.commit
        : typeof obj.ref === 'string'
          ? obj.ref
          : undefined
  return {
    git: {
      url,
      subdir: typeof obj.path === 'string' ? obj.path : undefined,
      ...(ref ? { ref } : {}),
    },
  }
}

/** Tiny stable hash for temp-dir names (avoids Date.now()/Math.random() in resumable paths). */
export function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}
