import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { extractFile } from '../extract'
import type { CachedFile } from './cache'
import type { DiscoveredFile } from './discover'

/**
 * Bring the cached extractions in line with the files on disk, re-parsing only what changed.
 *
 * A file whose size and mtime match its row is taken as unchanged without being read. That shortcut
 * is only sound for a file last written BEFORE the moment it was read: a write in the same clock
 * tick as the read leaves the stat identical and the content new. So a file modified within the
 * last couple of seconds is stored with no mtime, and the next check hashes it — git applies the
 * same rule to its index ("racily clean" entries).
 *
 * Parsing runs in the API process, so it yields to the event loop every few milliseconds: indexing
 * a large project must not stall the chat that shares the process.
 */
export interface RefreshResult {
  files: Map<string, CachedFile>
  changed: CachedFile[]
  removed: string[]
  /** Files whose content changed and were parsed again (a subset of `changed`). */
  parsed: number
}

const RACY_WINDOW_MS = 2000
const SLICE_MS = 12

export const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

export async function refreshExtractions(input: {
  root: string
  discovered: DiscoveredFile[]
  cached: ReadonlyMap<string, CachedFile>
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
  now?: () => number
}): Promise<RefreshResult> {
  const now = input.now ?? Date.now
  const files = new Map<string, CachedFile>()
  const changed: CachedFile[] = []
  let parsed = 0
  let slice = performance.now()

  for (const [index, entry] of input.discovered.entries()) {
    if (input.signal?.aborted) throw new Error('Indexing was cancelled.')
    const known = input.cached.get(entry.path)
    if (known && known.size === entry.size && known.mtimeMs === entry.mtimeMs) {
      files.set(entry.path, known)
      continue
    }
    const bytes = await readFile(join(input.root, entry.path)).catch(() => null)
    if (!bytes) continue
    const hash = createHash('sha256').update(bytes).digest('hex')
    const mtimeMs = now() - entry.mtimeMs < RACY_WINDOW_MS ? -1 : entry.mtimeMs
    let extraction = known?.hash === hash ? known.extraction : undefined
    if (extraction === undefined) {
      extraction = await extractFile(entry.path, bytes.toString('utf8')).catch(() => null)
      parsed += 1
    }
    const next: CachedFile = { path: entry.path, size: entry.size, mtimeMs, hash, extraction }
    files.set(entry.path, next)
    changed.push(next)
    if (performance.now() - slice > SLICE_MS) {
      input.onProgress?.(index + 1, input.discovered.length)
      await yieldToLoop()
      slice = performance.now()
    }
  }
  input.onProgress?.(input.discovered.length, input.discovered.length)
  const removed = [...input.cached.keys()].filter((path) => !files.has(path))
  return { files, changed, removed, parsed }
}
