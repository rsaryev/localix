/**
 * Recent-extraction index — the small memory behind the `localix://resource/doc` resource tree.
 * Every successful extraction appends `{id, source, format, title?, at}` to
 * `<documents dir>/recents.json` (newest first, de-duped by cache id, capped) so
 * the composer's `@`-menu can list "documents the agent/user recently touched"
 * without scanning the content-addressed cache. Tolerant reader: a missing or
 * corrupt index is an empty list, never an error.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteFile } from '@localixai/mini-app-sdk/backend'

export interface RecentDocument {
  /** Extraction-cache id (`<hash>.json`) — the `localix://resource/doc/<id>` tail. */
  id: string
  /** Human source label: the file basename or the media filename. */
  source: string
  format: string
  title?: string
  /** Epoch ms of the (latest) extraction. */
  at: number
}

const CAP = 50

export interface RecentsIndex {
  record(entry: RecentDocument): Promise<void>
  list(): Promise<RecentDocument[]>
}

export function createRecentsIndex(options: { dir: string }): RecentsIndex {
  const file = path.join(options.dir, 'recents.json')

  async function read(): Promise<RecentDocument[]> {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.filter(
        (e): e is RecentDocument =>
          !!e && typeof e === 'object' && typeof (e as RecentDocument).id === 'string',
      )
    } catch {
      return []
    }
  }

  // Serialize writes so two concurrent extractions can't interleave read/write.
  let chain: Promise<void> = Promise.resolve()

  return {
    record(entry) {
      // The tail parked in `chain` must never stay rejected: it used to, so one failed write (a
      // full disk, a transient EACCES) made every later `.then` skip its work, and the index
      // stopped recording for the rest of the process. Each write starts from a settled tail.
      const write = chain.then(async () => {
        const current = await read()
        const next = [entry, ...current.filter((e) => e.id !== entry.id)].slice(0, CAP)
        await atomicWriteFile(file, JSON.stringify(next, null, 2))
      })
      chain = write.catch(() => {})
      // Recording recents is best-effort — an unwritable index must never fail an extract.
      return chain
    },
    list: read,
  }
}
