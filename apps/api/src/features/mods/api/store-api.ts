import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { stringOr } from '../contracts'

/**
 * `$.store`: a mod's key-value store, kept as one JSON file in its data directory and shared by
 * every conversation. Writes are serialized and atomic (a renamed temporary file); the whole store
 * holds at most 4 MiB of JSON, as in Claude Code.
 */
const MAX_STORE_BYTES = 4 * 1024 * 1024

export function createStoreApi(dataDir: string) {
  const file = join(dataDir, 'mod-store.json')
  let data: Record<string, unknown> | null = null
  let queue: Promise<void> = Promise.resolve()
  const load = async (): Promise<Record<string, unknown>> =>
    (data ??= await fs
      .readFile(file, 'utf8')
      .then((text) => JSON.parse(text) as Record<string, unknown>)
      .catch((): Record<string, unknown> => ({})))
  const save = (next: Record<string, unknown>) => {
    const text = JSON.stringify(next)
    if (Buffer.byteLength(text) > MAX_STORE_BYTES)
      throw new Error('the store is over its 4 MiB limit')
    queue = queue.then(async () => {
      await fs.mkdir(dirname(file), { recursive: true })
      const temporary = `${file}.${process.pid}.tmp`
      await fs.writeFile(temporary, text)
      await fs.rename(temporary, file)
    })
    data = next
    return queue
  }
  const keyOf = (input: unknown) =>
    typeof input === 'string' ? input : stringOr((input as { key?: unknown } | null)?.key)
  return {
    async get(key: unknown) {
      return (await load())[keyOf(key)]
    },
    async set(key: unknown, value?: unknown) {
      const call =
        typeof key === 'string' ? { key, value } : (key as { key: string; value: unknown })
      await save({ ...(await load()), [call.key]: call.value })
    },
    async delete(key: unknown) {
      const { [keyOf(key)]: _gone, ...rest } = await load()
      await save(rest)
    },
    async keys() {
      return Object.keys(await load())
    },
  }
}
