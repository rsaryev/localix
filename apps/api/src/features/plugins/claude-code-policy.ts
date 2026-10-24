import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'

import { isRecord } from '../../lib/record'
import type { MarketplaceSource } from './marketplace-source'

/**
 * Claude Code's managed settings, the organization's plugin policy, read from the system
 * directory (managed-settings.md, "Delivery mechanisms"): `managed-settings.json` first, then every
 * `managed-settings.d/*.json` in alphabetical order, hidden files skipped. A later file's
 * `enabledPlugins` keys and `extraKnownMarketplaces` entries replace earlier ones; the
 * marketplace lists combine.
 *
 * `blockedMarketplaces` refuses a source in any spelling of the same repository, and an entry
 * without `ref` or `path` blocks all of them; `strictKnownMarketplaces`, when set, admits only a
 * source it lists exactly (`ref` and `path` included), a `github` `owner/*` entry, a
 * `hostPattern` (github, git and url hosts) or a `pathPattern` (file and directory paths). An
 * empty list admits nothing. MDM profiles and server-managed settings are not read.
 */

export interface ManagedPolicy {
  enabledPlugins: Record<string, boolean>
  blockedMarketplaces: unknown[]
  /** Absent: no allowlist. */
  strictKnownMarketplaces?: unknown[]
  extraKnownMarketplaces?: Record<string, unknown>
}

/** Where Claude Code reads file-based managed settings on this platform. */
export function managedSettingsDir(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode'
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode'
  return '/etc/claude-code'
}

async function readObject(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as unknown
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export async function readManagedPolicy(dir = managedSettingsDir()): Promise<ManagedPolicy> {
  const dropIns = await fs.readdir(join(dir, 'managed-settings.d')).catch(() => [] as string[])
  const files = [
    join(dir, 'managed-settings.json'),
    ...dropIns
      .filter((name) => name.endsWith('.json') && !name.startsWith('.'))
      .sort()
      .map((name) => join(dir, 'managed-settings.d', name)),
  ]
  const policy: ManagedPolicy = { enabledPlugins: {}, blockedMarketplaces: [] }
  for (const file of files) {
    const settings = await readObject(file)
    if (!settings) continue
    if (isRecord(settings.enabledPlugins))
      for (const [id, on] of Object.entries(settings.enabledPlugins))
        if (typeof on === 'boolean') policy.enabledPlugins[id] = on
    if (Array.isArray(settings.blockedMarketplaces))
      policy.blockedMarketplaces.push(...settings.blockedMarketplaces)
    const strict = settings.strictKnownMarketplaces ?? settings.allowedMarketplaces
    if (Array.isArray(strict))
      policy.strictKnownMarketplaces = [...(policy.strictKnownMarketplaces ?? []), ...strict]
    const extra = settings.extraKnownMarketplaces ?? settings.additionalMarketplaces
    if (isRecord(extra))
      policy.extraKnownMarketplaces = { ...policy.extraKnownMarketplaces, ...extra }
  }
  return policy
}

/** `owner/repo` of a github.com repository a source clones, lowercased, or undefined. */
function githubRepo(source: MarketplaceSource): string | undefined {
  if (source.source === 'github') return source.repo.replace(/\.git$/i, '').toLowerCase()
  if (source.source !== 'git') return undefined
  const match = source.url.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/i)
  return match?.[1]?.toLowerCase()
}

/** The host a source fetches from (`hostPattern`), as git reads its URL. */
function hostOf(source: MarketplaceSource): string | undefined {
  if (source.source === 'github') return 'github.com'
  if (source.source !== 'git' && source.source !== 'url') return undefined
  if (URL.canParse(source.url)) return new URL(source.url).hostname
  return source.source === 'git' ? source.url.match(/^[^@\s]+@([^:]+):/)?.[1] : undefined
}

const pathOf = (source: MarketplaceSource) =>
  source.source === 'local' || source.source === 'file' ? resolve(source.path) : undefined

const field = (entry: Record<string, unknown>, key: string) =>
  typeof entry[key] === 'string' ? (entry[key] as string) : undefined

function regexMatches(pattern: string | undefined, value: string | undefined): boolean {
  if (!pattern || value === undefined) return false
  try {
    return new RegExp(pattern).test(value)
  } catch {
    return false
  }
}

function blocks(entry: Record<string, unknown>, source: MarketplaceSource): boolean {
  const ref = 'ref' in source ? source.ref : undefined
  const path =
    'path' in source && source.source !== 'local' && source.source !== 'file'
      ? source.path
      : undefined
  switch (entry.source) {
    case 'github': {
      const want = field(entry, 'repo')?.toLowerCase()
      const repo = githubRepo(source)
      if (!want || !repo) return false
      const sameRepo = want.endsWith('/*') ? repo.startsWith(want.slice(0, -1)) : repo === want
      return (
        sameRepo &&
        (!field(entry, 'ref') || field(entry, 'ref') === ref) &&
        (!field(entry, 'path') || field(entry, 'path') === path)
      )
    }
    case 'git':
      return source.source === 'git' && field(entry, 'url') === source.url
    case 'url':
      return source.source === 'url' && field(entry, 'url') === source.url
    case 'file':
    case 'directory':
      return (
        pathOf(source) !== undefined && resolve(field(entry, 'path') ?? '\0') === pathOf(source)
      )
    case 'settings':
      return source.source === 'settings' && field(entry, 'name') === source.name
    case 'hostPattern':
      return regexMatches(field(entry, 'hostPattern'), hostOf(source))
    case 'pathPattern':
      return regexMatches(field(entry, 'pathPattern'), pathOf(source))
    default:
      return false
  }
}

function allows(entry: Record<string, unknown>, source: MarketplaceSource): boolean {
  const ref = 'ref' in source ? source.ref : undefined
  switch (entry.source) {
    case 'github': {
      const want = field(entry, 'repo')
      if (source.source !== 'github' || !want) return false
      if (want.endsWith('/*') && want.indexOf('/') === want.length - 2)
        return (
          source.repo.startsWith(want.slice(0, -1)) &&
          !source.repo.slice(want.length - 1).includes('/')
        )
      return (
        want === source.repo &&
        field(entry, 'ref') === ref &&
        (!field(entry, 'path') || field(entry, 'path') === source.path)
      )
    }
    case 'git':
      return (
        source.source === 'git' &&
        field(entry, 'url') === source.url &&
        field(entry, 'ref') === ref &&
        (!field(entry, 'path') || field(entry, 'path') === source.path)
      )
    case 'settings':
      return (
        source.source === 'settings' &&
        field(entry, 'name') === source.name &&
        JSON.stringify(entry.plugins) === JSON.stringify(source.plugins)
      )
    default:
      return blocks(entry, source)
  }
}

/** Why managed settings refuse `source`, or undefined when they allow it. */
export function marketplacePolicyProblem(
  source: MarketplaceSource,
  policy: ManagedPolicy,
): string | undefined {
  const records = (list: unknown[]) => list.filter(isRecord)
  if (records(policy.blockedMarketplaces).some((entry) => blocks(entry, source)))
    return 'managed settings block this marketplace source (blockedMarketplaces)'
  const strict = policy.strictKnownMarketplaces
  if (strict && !records(strict).some((entry) => allows(entry, source)))
    return 'managed settings allow only the marketplace sources strictKnownMarketplaces lists'
  return undefined
}

/** Throw when managed settings in `dir` refuse `source`. */
export async function assertMarketplaceAllowed(
  source: MarketplaceSource,
  dir?: string,
): Promise<void> {
  const problem = marketplacePolicyProblem(source, await readManagedPolicy(dir))
  if (problem) throw new Error(`Marketplace source refused: ${problem}.`)
}
