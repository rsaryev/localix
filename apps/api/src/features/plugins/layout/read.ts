import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { MANIFEST_FILE } from '@localixai/claude-plugin'
import type { ManifestFile, ManifestFiles } from './compose'

/** A root `plugin.json`: not Claude Code's manifest, which is `.claude-plugin/plugin.json`. */
export const ROOT_MANIFEST_FILE = 'plugin.json'
/**
 * A mini app's manifest, in its own folder as a plugin's is in `.claude-plugin/`: a folder holding
 * one is a mini app, never a plugin (rule X2). Named here, not imported: neither format's code
 * imports the other's.
 */
export const MINI_APP_FILE = '.localix-mini-app/mini-app.json'

async function readManifest(dir: string, file: string): Promise<ManifestFile | undefined> {
  let text: string
  try {
    text = await fs.readFile(join(dir, file), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    return { file, readError: `Cannot read ${file}: ${(error as Error).message}` }
  }
  try {
    return { file, json: JSON.parse(text) as unknown }
  } catch (error) {
    return { file, readError: `Invalid ${file}: ${(error as Error).message}` }
  }
}

/** Read what a plugin folder holds; a file that is absent is simply not there. */
export async function readManifestFiles(dir: string): Promise<ManifestFiles> {
  const [plugin, root, miniApp] = await Promise.all(
    [MANIFEST_FILE, ROOT_MANIFEST_FILE, MINI_APP_FILE].map((file) => readManifest(dir, file)),
  )
  return {
    ...(plugin ? { plugin } : {}),
    ...(root ? { root } : {}),
    ...(miniApp ? { miniApp: true as const } : {}),
  }
}
