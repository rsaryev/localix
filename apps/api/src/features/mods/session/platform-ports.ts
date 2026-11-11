import { promises as fs } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import type {
  ModEnv as KitModEnv,
  ModFetcher as KitModFetcher,
  ModFs as KitModFs,
  ModSpawner as KitModSpawner,
  ModStore as KitModStore,
} from '@rsaryev/llx-plugin/mods'
import { MOD_LIMITS } from '../../plugins/kit'

/**
 * The machine's side of the kit's mods API, as Localix gives it: files with the user's own
 * permissions, processes, HTTP and each mod's store. The kit's API (`createModsApi`) reads a mod's
 * arguments, resolves its paths against the session's directory, applies the limits and fires each
 * call's event; these ports only do the I/O, with absolute paths.
 */

const quiet = <T>(work: Promise<T>): Promise<T | undefined> => work.catch(() => undefined)

type Kind = 'file' | 'dir' | 'other'
const kindOf = (stat: { isFile(): boolean; isDirectory(): boolean }): Kind =>
  stat.isFile() ? 'file' : stat.isDirectory() ? 'dir' : 'other'

/** The disk, as the user running Localix sees it. */
export const diskModFs: KitModFs = {
  async read(path, _signal, as) {
    const stat = await quiet(fs.stat(path))
    if (!stat?.isFile()) return undefined
    const bytes = await fs.readFile(path)
    return {
      text: bytes.toString('utf8'),
      bytes: bytes.byteLength,
      ...(as === 'bytes' ? { base64: bytes.toString('base64') } : {}),
    }
  },
  async write(path, text) {
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(path, text)
  },
  async list(path) {
    const entries = await quiet(fs.readdir(path, { withFileTypes: true }))
    if (!entries) return undefined
    return Promise.all(
      entries.map(async (entry) => {
        const stat = await quiet(fs.stat(join(path, entry.name)))
        return {
          name: entry.name,
          kind: stat ? kindOf(stat) : 'other',
          size: stat?.size ?? 0,
          isLink: entry.isSymbolicLink(),
          mtimeMs: stat?.isFile() ? stat.mtimeMs : 0,
        }
      }),
    )
  },
  async stat(path, _signal, options) {
    const [stat, link] = await Promise.all([quiet(fs.stat(path)), quiet(fs.lstat(path))])
    if (!stat) return undefined
    const realPath = options?.resolve ? await quiet(fs.realpath(path)) : undefined
    return {
      kind: kindOf(stat),
      size: stat.size,
      isLink: link?.isSymbolicLink() ?? false,
      mtimeMs: stat.isFile() ? stat.mtimeMs : 0,
      ...(realPath === undefined ? {} : { realPath }),
    }
  },
  exists: async (path) => (await quiet(fs.stat(path))) !== undefined,
  async ancestors(path) {
    const dirs: string[] = []
    for (let dir = dirname(path); ; dir = dirname(dir)) {
      dirs.push(dir)
      if (dir === parse(dir).root) return dirs
    }
  },
}

/** `$.process.spawn`: a long-running command, its output as it comes. */
export const bunModSpawner: KitModSpawner = {
  async *spawn(run) {
    const child = Bun.spawn([...run.argv], {
      cwd: run.cwd,
      env: { ...run.env },
      stdin: run.input === undefined ? 'ignore' : new TextEncoder().encode(run.input),
      stdout: 'pipe',
      stderr: 'pipe',
      signal: run.signal,
      windowsHide: true,
    })
    const chunks: Array<{ stream: 'stdout' | 'stderr'; text: string }> = []
    let wake: (() => void) | undefined
    let open = 2
    const pump = async (stream: 'stdout' | 'stderr', body: ReadableStream<Uint8Array>) => {
      const decoder = new TextDecoder()
      for await (const bytes of body) {
        chunks.push({ stream, text: decoder.decode(bytes, { stream: true }) })
        wake?.()
      }
      open -= 1
      wake?.()
    }
    void pump('stdout', child.stdout)
    void pump('stderr', child.stderr)
    while (open > 0 || chunks.length > 0) {
      const chunk = chunks.shift()
      if (chunk) yield chunk
      else await new Promise<void>((resolve) => (wake = resolve))
    }
    const exitCode = await child.exited
    const ended = child.signalCode === null ? null : String(child.signalCode)
    return { exitCode: ended === null ? exitCode : null, signal: ended }
  },
}

/** `$.http.fetch`: one hop, never a redirect followed (the kit judges each), the body cut. */
export function fetchModFetcher(fetchImpl: typeof fetch = fetch): KitModFetcher {
  return {
    async request(request) {
      const timeout = AbortSignal.timeout(request.timeoutMs)
      try {
        const response = await fetchImpl(request.url, {
          method: request.method,
          headers: request.headers,
          ...(request.body === undefined ? {} : { body: request.body }),
          redirect: 'manual',
          signal: AbortSignal.any([request.signal, timeout]),
        })
        const bytes = new Uint8Array(await response.arrayBuffer()).subarray(0, request.maxBytes)
        const headers: Record<string, string> = {}
        response.headers.forEach((value, name) => void (headers[name.toLowerCase()] = value))
        return { status: response.status, headers, text: new TextDecoder().decode(bytes) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (request.signal.aborted) return { failure: 'aborted', message }
        if (timeout.aborted) return { failure: 'timeout', message }
        return { failure: 'connection', message }
      }
    },
  }
}

/** `$.store`: one JSON file per mod in its data folder, as Localix kept it before. */
export function fileModStore(dataDir: (plugin: string) => string): KitModStore {
  const fileOf = (plugin: string) => join(dataDir(plugin), 'mod-store.json')
  return {
    async read(plugin) {
      const text = await quiet(fs.readFile(fileOf(plugin), 'utf8'))
      if (text === undefined) return {}
      const data: unknown = JSON.parse(text)
      return typeof data === 'object' && data !== null && !Array.isArray(data)
        ? (data as Awaited<ReturnType<KitModStore['read']>>)
        : {}
    },
    async write(plugin, data) {
      const text = JSON.stringify(data)
      if (Buffer.byteLength(text) > MOD_LIMITS.fileBytes)
        throw new Error(`$.store: over ${MOD_LIMITS.fileBytes} bytes`)
      await fs.mkdir(dataDir(plugin), { recursive: true })
      await fs.writeFile(fileOf(plugin), text)
    },
  }
}

/** The variables a mod reads and sets: the session's own copy of the environment commands get. */
export function sessionModEnv(initial: Readonly<Record<string, string>>): KitModEnv {
  const vars = new Map(Object.entries(initial))
  return {
    get: (name) => vars.get(name),
    set: (name, value) => void (value === undefined ? vars.delete(name) : vars.set(name, value)),
    snapshot: () => Object.fromEntries(vars),
  }
}
