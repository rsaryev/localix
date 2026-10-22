import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'

/**
 * `$.fs`: files, relative to the conversation's working directory (`cwd`). A mod acts with the
 * user's own permissions, as in Claude Code; the limits are Claude Code's: 4 MiB a file.
 */
const MAX_FILE_BYTES = 4 * 1024 * 1024

type Kind = 'file' | 'dir' | 'other'
const kindOf = (stat: { isFile(): boolean; isDirectory(): boolean }): Kind =>
  stat.isFile() ? 'file' : stat.isDirectory() ? 'dir' : 'other'

/** A path argument: a string, or Claude Code's `{ path }` call shape. */
const pathOf = (input: unknown): string => {
  const path = typeof input === 'string' ? input : (input as { path?: unknown } | null)?.path
  if (typeof path !== 'string' || !path) throw new Error('a path is required')
  return path
}

export function createFsApi(cwd: () => string) {
  const at = (input: unknown) => {
    const path = pathOf(input)
    return isAbsolute(path) ? path : resolve(cwd(), path)
  }
  const optionsOf = (input: unknown, second: unknown) =>
    (typeof input === 'object' && input !== null ? input : second) as
      | { as?: 'text' | 'bytes'; text?: string; content?: string }
      | undefined
  return {
    async read(input: unknown, second?: unknown) {
      const file = at(input)
      const stat = await fs.stat(file)
      if (stat.size > MAX_FILE_BYTES) throw new Error(`${file} is over the 4 MiB limit`)
      if (optionsOf(input, second)?.as === 'bytes')
        return { bytes: new Uint8Array(await fs.readFile(file)) }
      return fs.readFile(file, 'utf8')
    },
    async write(input: unknown, second?: unknown) {
      const file = at(input)
      const body =
        typeof second === 'string'
          ? second
          : (optionsOf(input, second)?.text ?? optionsOf(input, second)?.content)
      if (typeof body !== 'string') throw new Error('write takes the text to write')
      if (Buffer.byteLength(body) > MAX_FILE_BYTES)
        throw new Error('the text is over the 4 MiB limit')
      await fs.mkdir(dirname(file), { recursive: true })
      await fs.writeFile(file, body)
    },
    async list(input: unknown) {
      const dir = at(input ?? '.')
      const entries = await fs.readdir(dir, { withFileTypes: true })
      return Promise.all(
        entries.map(async (entry) => {
          const stat = await fs.lstat(join(dir, entry.name)).catch(() => null)
          return {
            name: entry.name,
            kind: entry.isSymbolicLink() ? 'other' : kindOf(entry),
            size: stat?.size ?? 0,
            isLink: entry.isSymbolicLink(),
          }
        }),
      )
    },
    async exists(input: unknown) {
      return fs.access(at(input)).then(
        () => true,
        () => false,
      )
    },
    async stat(input: unknown) {
      const file = at(input)
      const link = await fs.lstat(file)
      const target = link.isSymbolicLink() ? await fs.stat(file) : link
      return {
        kind: kindOf(target),
        size: target.size,
        mtimeMs: target.mtimeMs,
        isLink: link.isSymbolicLink(),
        ...(link.isSymbolicLink() ? { realPath: await fs.realpath(file) } : {}),
      }
    },
    /** The directories from the path up to the filesystem root, nearest first. */
    async ancestors(input: unknown) {
      const start = at(input ?? '.')
      const root = parse(start).root
      const out: { path: string }[] = []
      for (let dir = start; ; dir = dirname(dir)) {
        out.push({ path: dir })
        if (dir === root) break
      }
      return out
    },
  }
}
