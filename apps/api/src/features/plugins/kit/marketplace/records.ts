import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_MARKETPLACE_PATH,
  STORE_NAMES,
  parseKnownMarketplaces,
  serializeKnownMarketplaces,
  type KnownMarketplace as Recorded,
  type MarketplaceSource,
} from '@rsaryev/llx-plugin/marketplace'
import { isRecord } from '../../../../lib/record'
import { marketplaceFetchPlan } from './sources'

/**
 * The added marketplaces, kept as Claude Code keeps them: `known_marketplaces.json`, written and
 * read by the kit (`serializeKnownMarketplaces`, `parseKnownMarketplaces`). The commit a git
 * listing was fetched at, which that file does not hold, is kept beside it in `commits.json`. A
 * registry an earlier Localix wrote to `known.json` is read once more and goes on the next write.
 */

export interface KnownMarketplace extends Recorded {
  /** The commit the listing was fetched at, for a git source. */
  readonly gitCommitSha?: string
}

export type KnownMarketplaces = Record<string, KnownMarketplace>

const registryFile = (root: string) => join(root, STORE_NAMES.knownMarketplaces)
const commitsFile = (root: string) => join(root, 'commits.json')
const legacyFile = (root: string) => join(root, 'known.json')

const readText = (file: string): Promise<string | undefined> =>
  fs.readFile(file, 'utf8').catch(() => undefined)

const readCommits = async (root: string): Promise<Record<string, unknown>> => {
  try {
    const parsed: unknown = JSON.parse((await readText(commitsFile(root))) ?? '{}')
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

const withCommit = (record: Recorded, sha: unknown): KnownMarketplace =>
  typeof sha === 'string' ? { ...record, gitCommitSha: sha } : record

/**
 * `known.json` as an earlier Localix wrote it: Claude Code's shape, a folder named `local`, the
 * fetch time optional and the commit inline. An entry the kit cannot read is left behind.
 */
async function readLegacy(root: string): Promise<KnownMarketplaces> {
  const text = await readText(legacyFile(root))
  if (text === undefined) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {}
  }
  if (!isRecord(parsed)) return {}
  const written = (await fs.stat(legacyFile(root))).mtime.toISOString()
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([name, raw]) => {
      if (!isRecord(raw) || !isRecord(raw.source)) return []
      const source =
        raw.source.source === 'local' ? { ...raw.source, source: 'directory' } : raw.source
      const entry = { lastUpdated: written, ...raw, source }
      const read = parseKnownMarketplaces(JSON.stringify({ [name]: entry })).marketplaces[name]
      return read ? [[name, withCommit(read, raw.gitCommitSha)]] : []
    }),
  )
}

export async function readKnownMarketplaces(root: string): Promise<KnownMarketplaces> {
  const text = await readText(registryFile(root))
  if (text === undefined) return readLegacy(root)
  const commits = await readCommits(root)
  return Object.fromEntries(
    Object.entries(parseKnownMarketplaces(text).marketplaces).map(([name, record]) => [
      name,
      withCommit(record, commits[name]),
    ]),
  )
}

/** Written aside and renamed in: a reader sees the old file or the new one, never half of one. */
async function writeAtomically(file: string, text: string): Promise<void> {
  const aside = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  await fs.writeFile(aside, text)
  await fs.rename(aside, file)
}

export async function writeKnownMarketplaces(
  root: string,
  known: KnownMarketplaces,
): Promise<void> {
  await fs.mkdir(root, { recursive: true })
  const records: Record<string, Recorded> = {}
  const commits: Record<string, string> = {}
  for (const [name, { gitCommitSha, ...record }] of Object.entries(known)) {
    records[name] = record
    if (gitCommitSha) commits[name] = gitCommitSha
  }
  await writeAtomically(commitsFile(root), `${JSON.stringify(commits, null, 2)}\n`)
  await writeAtomically(registryFile(root), serializeKnownMarketplaces(records))
  await fs.rm(legacyFile(root), { force: true })
}

/**
 * The source as the registry file gives it back once written. The kit writes an inline (`settings`)
 * catalog's parsed entries and reads them back as no entries, so a source is compared with its
 * record, and recorded, in this form.
 */
export function asRecorded(source: MarketplaceSource): MarketplaceSource {
  const text = serializeKnownMarketplaces({ one: { source, installLocation: '', lastUpdated: '' } })
  return parseKnownMarketplaces(text).marketplaces.one?.source ?? source
}

/**
 * Where a registered marketplace's catalog is, and the folder its relative plugins resolve in: a
 * catalog file added where it is, its marketplace two folders up (the kit's `read-file` plan);
 * every other one at `.claude-plugin/marketplace.json` of its folder.
 */
export function catalogAt(record: { source: MarketplaceSource; installLocation: string }): {
  file: string
  root: string
} {
  if (record.source.kind === 'file') {
    const plan = marketplaceFetchPlan(record.source)
    if (plan.kind === 'read-file') return { file: plan.path, root: plan.root }
  }
  return {
    file: join(record.installLocation, DEFAULT_MARKETPLACE_PATH),
    root: record.installLocation,
  }
}
