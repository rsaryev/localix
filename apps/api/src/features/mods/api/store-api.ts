import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { stringOr } from '../contracts'

/**
 * `$.store`: a mod's key-value store, kept as one JSON file in its data directory and shared by
 * every conversation and every project the mod runs in — each instance's `$.store` reads and writes
 * the same copy, so one project's write is the next one's read. Calls are serialized and writes
 * atomic (a renamed temporary file). A value is JSON data, read back as `JSON.parse(JSON.stringify
 * (value))`; a function, a cycle or a store over 4 MiB of JSON is refused, as in Claude Code.
 */
const MAX_STORE_BYTES = 4 * 1024 * 1024

interface SharedStore {
  data: Record<string, unknown> | null
  /** The file's modification the cached `data` was read from or written as. */
  stamp: string
  queue: Promise<unknown>
}

/** One store per file, whichever instance opens it. */
const stores = new Map<string, SharedStore>()

function sharedStore(file: string): SharedStore {
  let store = stores.get(file)
  if (!store) {
    store = { data: null, stamp: '', queue: Promise.resolve() }
    stores.set(file, store)
  }
  return store
}

/** `value` as the JSON text the store keeps, or a throw naming why it is not JSON data. */
function jsonOf(value: unknown): string {
  let text: string | undefined
  try {
    text = JSON.stringify(value, (_key, field: unknown) => {
      if (typeof field === 'function' || typeof field === 'symbol')
        throw new Error(`a ${typeof field} is not JSON data`)
      return field
    })
  } catch (error) {
    throw new Error(`store.set: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (text === undefined) throw new Error('store.set: the value is not JSON data')
  return text
}

export function createStoreApi(dataDir: string) {
  const file = join(resolve(dataDir), 'mod-store.json')
  const shared = sharedStore(file)
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = shared.queue.then(work)
    shared.queue = result.catch(() => undefined)
    return result
  }
  const stampOf = () =>
    fs.stat(file).then(
      (stat) => `${stat.mtimeMs}:${stat.size}`,
      () => '',
    )
  // The cached copy, unless the file changed beneath it (removed, or written by another process).
  const load = async (): Promise<Record<string, unknown>> => {
    const stamp = await stampOf()
    if (shared.data && stamp === shared.stamp) return shared.data
    shared.data = await fs
      .readFile(file, 'utf8')
      .then((text) => JSON.parse(text) as Record<string, unknown>)
      .catch((): Record<string, unknown> => ({}))
    shared.stamp = stamp
    return shared.data
  }
  const save = async (next: Record<string, unknown>) => {
    const text = JSON.stringify(next)
    if (Buffer.byteLength(text) > MAX_STORE_BYTES)
      throw new Error('the store is over its 4 MiB limit')
    await fs.mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    await fs.writeFile(temporary, text)
    await fs.rename(temporary, file)
    shared.data = next
    shared.stamp = await stampOf()
  }
  const keyOf = (input: unknown) =>
    typeof input === 'string' ? input : stringOr((input as { key?: unknown } | null)?.key)
  return {
    get(key: unknown) {
      return serial(async () => {
        const value = (await load())[keyOf(key)]
        return value === undefined ? undefined : structuredClone(value)
      })
    },
    set(key: unknown, value?: unknown) {
      const call =
        typeof key === 'string' ? { key, value } : (key as { key: string; value: unknown })
      const name = keyOf(call)
      if (!name) return Promise.reject(new Error('store.set takes a key'))
      let stored: unknown
      try {
        stored = JSON.parse(jsonOf(call.value))
      } catch (error) {
        return Promise.reject(error)
      }
      return serial(async () => {
        await save({ ...(await load()), [name]: stored })
      })
    },
    delete(key: unknown) {
      return serial(async () => {
        const { [keyOf(key)]: _gone, ...rest } = await load()
        await save(rest)
      })
    },
    keys() {
      return serial(async () => Object.keys(await load()))
    },
  }
}
