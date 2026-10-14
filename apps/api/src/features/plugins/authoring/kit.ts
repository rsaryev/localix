import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import {
  PLUGIN_KIT_MANIFEST,
  PLUGIN_KIT_TEMPLATE_DIR,
  isPluginKitManifest,
  type PluginKitManifest,
} from './kit-layout'

/** A loaded plugin kit: where it is, and what it says about itself. */
export interface PluginKit {
  dir: string
  manifest: PluginKitManifest
  templateDir: string
}

/** Thrown when the app carries no usable kit — a broken install, never a user error. */
export class PluginKitUnavailableError extends Error {}

/**
 * Read the kit at `dir`; throws {@link PluginKitUnavailableError}. Staging passes the kit it just
 * wrote; the running app passes `pluginKitDir()` (`kit-root.ts`).
 */
export async function loadPluginKit(dir: string): Promise<PluginKit> {
  let manifest: unknown
  try {
    manifest = JSON.parse(await fs.readFile(join(dir, PLUGIN_KIT_MANIFEST), 'utf8'))
  } catch (error) {
    throw new PluginKitUnavailableError(
      `This Localix build carries no plugin kit at ${dir} (${(error as Error).message}).`,
    )
  }
  if (!isPluginKitManifest(manifest)) {
    throw new PluginKitUnavailableError(`The plugin kit at ${dir} has an unknown layout.`)
  }
  return { dir, manifest, templateDir: join(dir, PLUGIN_KIT_TEMPLATE_DIR) }
}
