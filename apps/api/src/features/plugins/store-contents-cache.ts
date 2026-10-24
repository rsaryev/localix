import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { isRecord } from '../../lib/record'
import type { PluginContents } from './store-contents'

/**
 * WHAT THE PLUGINS IN A MARKETPLACE'S CHECKOUT CONTAIN, kept per checkout revision: scanning a
 * few hundred folders on every Store sync would cost seconds, and the answer only changes when the
 * marketplace is fetched again. One small JSON file per marketplace in the cache folder, so a
 * restart does not scan again either. A file of another revision is ignored and replaced.
 */
export function createContentsCache(dir: string) {
  const held = new Map<string, { revision: string; entries: Record<string, PluginContents> }>()
  const file = (market: string) => join(dir, `${encodeURIComponent(market)}.json`)

  async function load(market: string, revision: string) {
    const kept = held.get(market)
    if (kept?.revision === revision) return kept
    const raw = await fs
      .readFile(file(market), 'utf8')
      .then((text) => JSON.parse(text) as unknown)
      .catch(() => null)
    const fresh =
      isRecord(raw) && raw.revision === revision && isRecord(raw.entries)
        ? { revision, entries: raw.entries as Record<string, PluginContents> }
        : { revision, entries: {} }
    held.set(market, fresh)
    return fresh
  }

  return {
    /** What `entry` of `market` contains at `revision`, scanned only when not known yet. */
    async get(
      market: string,
      revision: string,
      entry: string,
      scan: () => Promise<PluginContents | null>,
    ): Promise<PluginContents | null> {
      const at = await load(market, revision)
      if (at.entries[entry]) return at.entries[entry]
      const found = await scan()
      if (found) at.entries[entry] = found
      return found
    },

    /** Write what was scanned since the last save. */
    async save(market: string): Promise<void> {
      const at = held.get(market)
      if (!at) return
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(file(market), JSON.stringify(at))
    },
  }
}
