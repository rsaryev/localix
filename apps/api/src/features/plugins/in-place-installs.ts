import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { ConflictError } from '../../lib/domain-errors'
import { createKeyedSerializer } from '../../lib/keyed-serializer'
import { isRecord } from '../../lib/record'
import { pathExists } from '../ext/fs-discovery'
import { entrySource } from './claude-code-installs'
import type { DiscoveredPlugin } from './discovery-types'
import { loadManifest } from './manifest-load'
import { readKnownMarketplaces, readMarketplace } from './kit'
import type { MarketplaceEntry } from '@rsaryev/llx-plugin/marketplace'
import { marketplacesRoot } from './marketplace-source'
import { withWorkflowCommands } from './workflow-commands'

/**
 * THE PLUGINS THAT LOAD IN PLACE from a marketplace added from a local folder.
 *
 * Claude Code loads a relative-path plugin of such a marketplace "in place from its path inside
 * the marketplace folder. Your edits to the source directory take effect at the next session start
 * or `/reload-plugins`, and you don't need to increase the version" (loading.md). Localix keeps
 * one record per installed plugin in `<global plugins root>/.in-place.json`, `{ <name>: { id, dir }
 * }` (`id` is `<plugin>@<marketplace>`), and discovery reads each folder where it is, uncached,
 * after the home copies and before Claude Code's installs.
 *
 * The folder is the person's. Nothing here writes into it, and nothing that removes a plugin or a
 * marketplace may delete it: the record is what an uninstall drops.
 */
export interface InPlaceRecord {
  /** `<plugin>@<marketplace>`, the entry the plugin was installed from. */
  id: string
  /** The plugin's folder inside the marketplace folder, absolute. */
  dir: string
}

const RECORDS_FILE = '.in-place.json'
const serialize = createKeyedSerializer()

/** The records file of a global plugins root (`~/.localix/plugins`). */
export const inPlaceRecordsFile = (installRoot: string): string => join(installRoot, RECORDS_FILE)

export async function readInPlaceRecords(
  installRoot: string,
): Promise<Record<string, InPlaceRecord>> {
  let raw: unknown
  try {
    raw = JSON.parse(await fs.readFile(inPlaceRecordsFile(installRoot), 'utf8'))
  } catch {
    return {}
  }
  const out: Record<string, InPlaceRecord> = {}
  if (!isRecord(raw)) return out
  for (const [name, value] of Object.entries(raw))
    if (isRecord(value) && typeof value.id === 'string' && typeof value.dir === 'string')
      out[name] = { id: value.id, dir: value.dir }
  return out
}

/**
 * Set (or with `null`, drop) the record of `name`, serialized per records file and written
 * atomically. Returns the record it replaced. With `replace: false` an existing record is refused
 * as `extension_exists`, the code an install already answers "already installed" for; a copy
 * installed over the same name is refused the same way.
 */
export function setInPlaceRecord(
  installRoot: string,
  name: string,
  record: InPlaceRecord | null,
  opts: { replace: boolean } = { replace: true },
): Promise<InPlaceRecord | null> {
  const file = inPlaceRecordsFile(installRoot)
  return serialize(file, async () => {
    const records = await readInPlaceRecords(installRoot)
    const previous = records[name] ?? null
    if (previous && !opts.replace)
      throw new ConflictError('extension_exists', 'An extension already exists at this destination')
    if (!previous && !record) return null
    if (record) records[name] = record
    else delete records[name]
    await fs.mkdir(installRoot, { recursive: true })
    const staged = `${file}.${randomUUID()}.tmp`
    await fs.writeFile(staged, JSON.stringify(records, null, 2) + '\n')
    await fs.rename(staged, file)
    return previous
  })
}

/** The entry `id` names in the catalog of a registered marketplace, when it is still listed. */
async function listedEntry(homeDir: string, id: string): Promise<MarketplaceEntry | undefined> {
  const at = id.lastIndexOf('@')
  if (at <= 0) return undefined
  try {
    const record = (await readKnownMarketplaces(marketplacesRoot(homeDir)))[id.slice(at + 1)]
    if (!record) return undefined
    const market = await readMarketplace(record)
    return market.plugins.find((one) => one.name === id.slice(0, at))
  } catch {
    return undefined
  }
}

/** Read one in-place plugin as Claude Code does: its folder, combined with its entry. */
export async function loadInPlacePlugin(
  record: InPlaceRecord,
  entry: MarketplaceEntry | undefined,
  projectId: string,
): Promise<DiscoveredPlugin> {
  const plugin = await loadManifest(record.dir, 'global', projectId, entrySource(record.id, entry))
  return { ...plugin, inPlaceInstall: record.id }
}

/**
 * The in-place plugins as discovered user-scope plugins, read fresh on every call so an edit in
 * the folder loads at the next `/plugin reload`. A record whose folder is gone shows nothing.
 */
export async function discoverInPlacePlugins(opts: {
  homeDir: string
  projectId: string
}): Promise<DiscoveredPlugin[]> {
  const records = await readInPlaceRecords(join(opts.homeDir, '.localix', 'plugins'))
  const plugins = await Promise.all(
    Object.values(records).map(async (record): Promise<DiscoveredPlugin | null> => {
      if (!(await pathExists(record.dir))) return null
      const entry = await listedEntry(opts.homeDir, record.id)
      return withWorkflowCommands(await loadInPlacePlugin(record, entry, opts.projectId))
    }),
  )
  return plugins.filter((plugin): plugin is DiscoveredPlugin => plugin !== null)
}
