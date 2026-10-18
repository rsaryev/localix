/**
 * A small versioned JSON file for the catalog's caches: read once, written atomically (a
 * temporary file renamed into place, so a crash mid-write leaves the old copy, never half of
 * one) and coalesced (many changes in a burst are one write). A file of another version, or one
 * that does not parse, reads as empty: a cache is only ever a slower first read away.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const WRITE_DELAY_MS = 500

export function createJsonFile<T>(file: string, version: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: (() => T) | null = null
  let writing: Promise<void> = Promise.resolve()

  async function flush() {
    timer = null
    const snapshot = pending
    pending = null
    if (!snapshot) return
    const body = JSON.stringify({ version, data: snapshot() })
    writing = writing.then(async () => {
      await mkdir(path.dirname(file), { recursive: true })
      const temp = `${file}.${process.pid}.tmp`
      await writeFile(temp, body)
      await rename(temp, file)
    })
    await writing.catch(() => {})
  }

  return {
    async read(): Promise<T | null> {
      const raw = await readFile(file, 'utf8').catch(() => null)
      if (!raw) return null
      try {
        const parsed = JSON.parse(raw) as { version?: number; data?: T }
        return parsed.version === version && parsed.data !== undefined ? parsed.data : null
      } catch {
        return null
      }
    },

    /** Write what `snapshot` returns, soon; later calls in the same burst replace it. */
    save(snapshot: () => T) {
      pending = snapshot
      timer ??= setTimeout(() => void flush(), WRITE_DELAY_MS)
      timer.unref?.()
    },

    /** Write now what is pending (shutdown, tests). */
    flush,
  }
}
