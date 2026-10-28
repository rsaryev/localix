import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'

/**
 * Write a file the toolchain GENERATES inside a mini app (its `tsconfig.json`, its `KIT.md`): only
 * when the content changed, atomically, and never through a link.
 *
 * Unchanged content is left untouched because the editor's language server watches these files — a
 * rewrite with the same bytes reloaded the project on every build. The write goes through a
 * temporary file and a rename, so a reader never sees half a file. A symlink or a directory at the
 * path is refused: the mini app folder is the person's, and following a link would write outside it.
 */
export async function writeGeneratedFile(
  path: string,
  content: string,
  label: string,
): Promise<void> {
  const existing = await fs.lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) {
    throw new Error(`Mini app ${label} must be a regular file, not a symlink or directory`)
  }
  if ((await fs.readFile(path, 'utf8').catch(() => null)) === content) return
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, content)
    await fs.rename(temporary, path)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {})
  }
}
