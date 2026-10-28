import { errorMessage } from '../../lib/errors'

/**
 * Row writes the registry does not wait for (`registry.ts`: the live index is authoritative, rows
 * are for the next process). A failed write is logged, never thrown; `flush` still lets a caller
 * that needs the rows — a test reading them back, a shutdown — wait for the ones already started.
 */
export function behindWrites(warn?: (message: string) => void) {
  const writing = new Set<Promise<unknown>>()
  return {
    behind(what: string, write: () => Promise<unknown>): void {
      const done = write()
        .catch((error: unknown) => warn?.(`work record ${what} not stored: ${errorMessage(error)}`))
        .finally(() => writing.delete(done))
      writing.add(done)
    },
    /** Resolves once every write started so far has landed (or been logged as failed). */
    async flush(): Promise<void> {
      while (writing.size > 0) await Promise.all(writing)
    },
  }
}
