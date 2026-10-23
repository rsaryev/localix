import { existsSync, promises as fs } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import { MINI_APP_UI_ARTIFACT_MANIFEST } from '@localixai/mini-app-sdk/ui-artifact'

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

async function readRevision(dir: string): Promise<string | null> {
  try {
    const manifest: unknown = JSON.parse(
      await fs.readFile(join(dir, MINI_APP_UI_ARTIFACT_MANIFEST), 'utf8'),
    )
    if (!manifest || typeof manifest !== 'object' || !('revision' in manifest)) return null
    return typeof manifest.revision === 'string' && manifest.revision ? manifest.revision : null
  } catch {
    return null
  }
}

/** Keep the previous distinct revision for a view that has a pending lazy import. */
export async function retainPreviousHashedFiles(previous: string, staged: string): Promise<void> {
  if (!existsSync(previous)) return
  const realPrevious = await fs.realpath(previous)
  const [previousRevision, stagedRevision] = await Promise.all([
    readRevision(previous),
    readRevision(staged),
  ])
  // Backend/docs-only restaging doesn't advance the UI revision. Preserve its inherited files
  // too, or a second identical build removes the chunks an open older tab still imports.
  const unchanged = previousRevision !== null && previousRevision === stagedRevision
  let current: unknown
  try {
    current = JSON.parse(await fs.readFile(join(previous, CURRENT_FILES), 'utf8'))
  } catch {
    // Artifacts built before the marker existed retain all their hashed files once. The next
    // revision carries a marker, so this fallback cannot grow retention without bound.
  }
  const files =
    !unchanged && Array.isArray(current) && current.every((file) => typeof file === 'string')
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
