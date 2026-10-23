import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { MANIFEST_FILE } from '@localixai/claude-plugin'
import {
  LEGACY_MINI_APP_MANIFEST_FILE,
  MINI_APP_MANIFEST_FILE,
} from '@localixai/mini-app-sdk/app-manifest'
import type { ManifestFile, ManifestFiles } from './compose'

/** The root manifest of an extension written before the plugin and mini-app split. */
export const LEGACY_MANIFEST_FILE = 'plugin.json'

/** Every manifest an extension folder may hold, in the order they are read. */
export const MANIFEST_FILES = [
  MINI_APP_MANIFEST_FILE,
  MANIFEST_FILE,
  LEGACY_MINI_APP_MANIFEST_FILE,
  LEGACY_MANIFEST_FILE,
] as const

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

/** Read the manifests in `dir`; a file that is absent is simply not there. */
export async function readManifestFiles(dir: string): Promise<ManifestFiles> {
  const [miniApp, plugin, app, legacy] = await Promise.all(
    MANIFEST_FILES.map((file) => readManifest(dir, file)),
  )
  return {
    ...(miniApp ? { miniApp } : {}),
    ...(plugin ? { plugin } : {}),
    ...(app ? { app } : {}),
    ...(legacy ? { legacy } : {}),
  }
}
