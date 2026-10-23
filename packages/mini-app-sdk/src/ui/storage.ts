/** Minimal read contract, allowing plugins and tests to supply an isolated store. */
export interface StorageReader {
  getItem(key: string): string | null
}

/** Minimal write contract paired with {@link StorageReader}. */
export interface StorageWriter {
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function defaultStorage(): Storage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage
}

const reportedWriteFailures = new Set<string>()

/**
 * A failed write stays non-fatal, but no longer silent. Swallowed entirely, a FULL store looked
 * exactly like a working one: every later layout, draft and setting simply never persisted, and
 * the only symptom was a relaunch that restored less than it should. Reported once per key, so
 * a store that stays full cannot flood the console from a debounced writer.
 */
function reportWriteFailure(key: string, error: unknown): void {
  if (reportedWriteFailures.has(key)) return
  reportedWriteFailures.add(key)
  console.warn(`[storage] could not write "${key}"; it will not survive a reload`, error)
}

/** Read a raw string; null when absent or unavailable. */
export function loadString(key: string, storage?: StorageReader): string | null {
  try {
    return (storage ?? defaultStorage())?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** Write a raw string (`null` removes it); unavailable stores are a no-op. */
export function saveString(key: string, value: string | null, storage?: StorageWriter): void {
  try {
    const target = storage ?? defaultStorage()
    if (!target) return
    if (value === null) target.removeItem(key)
    else target.setItem(key, value)
  } catch (error) {
    // Private mode, quota failures and disabled storage are non-fatal.
    reportWriteFailure(key, error)
  }
}

/** Parse a JSON value; null when absent, malformed, or unavailable. */
export function loadJSON<T>(key: string, storage?: StorageReader): T | null {
  try {
    const raw = (storage ?? defaultStorage())?.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

/** Serialize a value (`null`/`undefined` removes it); failures are non-fatal. */
export function saveJSON(key: string, value: unknown, storage?: StorageWriter): void {
  try {
    const target = storage ?? defaultStorage()
    if (!target) return
    if (value === null || value === undefined) target.removeItem(key)
    else target.setItem(key, JSON.stringify(value))
  } catch (error) {
    // Private mode, quota failures and disabled storage are non-fatal.
    reportWriteFailure(key, error)
  }
}
