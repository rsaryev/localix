import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import {
  alreadyAddedFromDifferentSource,
  describeSource,
  parseMarketplaceSource,
  planMarketplaceFetch,
  sameMarketplaceSource,
  type MarketplaceFetchPlan,
  type MarketplaceSource,
} from '@rsaryev/llx-plugin/marketplace'
import {
  concludeMarketplaceAdd,
  startMarketplaceAdd,
  type CommandOutput,
} from '@rsaryev/llx-plugin/cli'
import { issueLine } from '../catalog/read-folder'

/**
 * Where a marketplace comes from, as the kit reads and judges it: what is typed after
 * `/plugin marketplace add` (`startMarketplaceAdd`), a source object of `extraKnownMarketplaces`
 * (`parseMarketplaceSource`), the name a fetched catalog may register under
 * (`concludeMarketplaceAdd`, `alreadyAddedFromDifferentSource`), and how the source is fetched
 * (`planMarketplaceFetch`). Localix places a local path and runs the plan.
 */

export type { MarketplaceFetchPlan, MarketplaceSource } from '@rsaryev/llx-plugin/marketplace'
export { describeSource, sameMarketplaceSource }

export type Parsed = MarketplaceSource | { error: string }

const platform = (): 'posix' | 'windows' => (process.platform === 'win32' ? 'windows' : 'posix')

const lineOf = (output: CommandOutput): string =>
  output.kind === 'result' ? output.result.message : output.reason

/** A local path the person typed, placed: `~` in the home folder, a relative one in `cwd`. */
function placed(path: string, where: { cwd: string; home: string }): string {
  if (path === '~' || path.startsWith('~/') || path.startsWith('~\\'))
    return join(where.home, path.slice(1))
  return isAbsolute(path) ? path : resolve(where.cwd, path)
}

/** The source the typed text stands for, or Claude Code's refusal of it. */
export function parseMarketplaceAdd(
  text: string,
  where: { cwd?: string; home?: string } = {},
): Parsed {
  const start = startMarketplaceAdd({ source: text, platform: platform() })
  if (start.kind === 'done') return { error: lineOf(start.output) }
  if (start.kind !== 'fetch') return { error: 'Marketplaces hosted on claude.ai are not supported' }
  const { source } = start
  if (source.kind !== 'file' && source.kind !== 'directory') return source
  const at = { cwd: where.cwd ?? process.cwd(), home: where.home ?? homedir() }
  return { ...source, path: placed(source.path, at) }
}

/** A source object written under `extraKnownMarketplaces.<key>`, or why it does not load. */
export function parseDeclaredSource(raw: unknown, key?: string): Parsed {
  const read = parseMarketplaceSource(raw, { policy: false, ...(key === undefined ? {} : { key }) })
  const refused = read.issues.find((issue) => issue.severity === 'error')
  if (refused) return { error: issueLine(refused) }
  if (read.loadStatus !== 'loads') return { error: read.loadStatus.replace(/^fails: /, '') }
  return read.source ?? { error: 'Unsupported marketplace source type' }
}

/**
 * Why a catalog named `name`, fetched from `source`, may not be registered, or undefined: the
 * reserved names and their spellings, another GitHub marketplace's download folder, and a name
 * already registered from a different source.
 */
export function marketplaceAddRefusal(
  name: string,
  source: MarketplaceSource,
  registered: Readonly<Record<string, { source: MarketplaceSource }>>,
): string | undefined {
  const others = Object.entries(registered).map(([one, record]) => ({
    name: one,
    source: record.source,
  }))
  const { output } = concludeMarketplaceAdd(
    { kind: 'fetch', source, scope: 'user', json: false },
    { name, alreadyOnDisk: false, registered: others },
  )
  if (output.kind !== 'result' || output.result.outcome === 'failed') return lineOf(output)
  const existing = Object.hasOwn(registered, name) ? registered[name] : undefined
  if (existing && !sameMarketplaceSource(existing.source, source))
    return alreadyAddedFromDifferentSource(name, existing.source)
  return undefined
}

/** How the source is fetched, or throw what refuses it. */
export function marketplaceFetchPlan(source: MarketplaceSource): MarketplaceFetchPlan {
  const planned = planMarketplaceFetch(source)
  if ('kind' in planned) return planned
  throw new Error(issueLine(planned))
}

/** A marketplace added from a local file or folder: read where it is, never copied. */
export const isLocalSource = (
  source: MarketplaceSource,
): source is Extract<MarketplaceSource, { kind: 'file' | 'directory' }> =>
  source.kind === 'file' || source.kind === 'directory'

/** The URL a git plan clones: an `owner/repo` shorthand over HTTPS from github.com. */
export const cloneUrl = (repo: Extract<MarketplaceFetchPlan, { kind: 'git' }>['repo']): string =>
  'shorthand' in repo ? `https://github.com/${repo.shorthand}.git` : repo.url
