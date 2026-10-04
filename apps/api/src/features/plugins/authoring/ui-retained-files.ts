import { existsSync, promises as fs } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import { isPathBelow } from '../../../lib/path-containment'

/** Files from this revision only; inherited chunks are deliberately omitted. */
const CURRENT_FILES = '.current-files.json'

export async function listUiArtifactFiles(dir: string, base: string = dir): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name)
      return entry.isDirectory()
        ? listUiArtifactFiles(path, base)
        : [relative(base, path).split('\\').join('/')]
    }),
  )
  return nested.flat()
}

const isHashedFile = (file: string) => file.startsWith('chunks/') || file.startsWith('assets/')

/** Record only files the current build emitted, excluding any chunks retained from its parent. */
export async function recordCurrentHashedFiles(dir: string, files: string[]): Promise<void> {
  await fs.writeFile(join(dir, CURRENT_FILES), `${JSON.stringify(files.filter(isHashedFile))}\n`)
}

/** Keep one previous revision's hashed files for a view that has a pending lazy import. */
export async function retainPreviousHashedFiles(previous: string, staged: string): Promise<void> {
  if (!existsSync(previous)) return
  const realPrevious = await fs.realpath(previous)
  let current: unknown
  try {
    current = JSON.parse(await fs.readFile(join(previous, CURRENT_FILES), 'utf8'))
  } catch {
    // Artifacts built before the marker existed retain all their hashed files once. The next
    // revision carries a marker, so this fallback cannot grow retention without bound.
  }
  const files =
    Array.isArray(current) && current.every((file) => typeof file === 'string')
      ? (current as string[])
      : await listUiArtifactFiles(previous)
  for (const file of files) {
    if (!isHashedFile(file)) continue
    const source = resolve(previous, file)
    const target = resolve(staged, file)
    if (!isPathBelow(previous, source) || !isPathBelow(staged, target)) continue
    const stat = await fs.lstat(source).catch(() => null)
    if (!stat?.isFile() || existsSync(target)) continue
    if (!isPathBelow(realPrevious, await fs.realpath(source))) continue
    await fs.mkdir(dirname(target), { recursive: true })
    await fs.copyFile(source, target)
  }
}
