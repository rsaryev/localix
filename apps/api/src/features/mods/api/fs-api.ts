import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'
import { isPathBelow } from '../../../lib/path-containment'

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

/** A file's text, or null when it is missing, not a file or over the limit. */
async function readSmall(path: string): Promise<string | null> {
  const stat = await fs.stat(path).catch(() => null)
  if (!stat?.isFile() || stat.size > MAX_FILE_BYTES) return null
  return fs.readFile(path, 'utf8').catch(() => null)
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
        return { base64: (await fs.readFile(file)).toString('base64') }
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
    /**
     * The memory files (`CLAUDE.md`, `AGENTS.md` …) named `names` in each directory from beneath
     * `below` (or the filesystem root) down to the directory of `of` (or the working directory),
     * outermost first, as Claude Code's memory loader reads nested ones.
     */
    async ancestors(request: unknown) {
      const { names, of, below } = (request ?? {}) as {
        names?: unknown
        of?: unknown
        below?: unknown
      }
      if (!Array.isArray(names)) throw new Error('ancestors takes the file names to look for')
      const end = of === undefined ? cwd() : dirname(at(of))
      const top = below === undefined ? undefined : at(below)
      if (top !== undefined && !isPathBelow(top, end)) return []
      const dirs: string[] = []
      for (let dir = end; dir !== top; dir = dirname(dir)) {
        dirs.unshift(dir)
        if (dir === parse(dir).root) break
      }
      const found = []
      for (const dir of dirs)
        for (const name of names.filter((entry): entry is string => typeof entry === 'string')) {
          const path = join(dir, name)
          const content = await readSmall(path)
          if (content !== null) found.push({ dir, name, content, parts: [{ path, content }] })
        }
      return found
    },
  }
}
