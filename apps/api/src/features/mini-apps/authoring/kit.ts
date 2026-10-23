import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import {
  MINI_APP_KIT_MANIFEST,
  MINI_APP_KIT_TEMPLATE_DIR,
  isMiniAppKitManifest,
  type MiniAppKitManifest,
} from './kit-layout'

/** A loaded mini app kit: where it is, and what it says about itself. */
export interface MiniAppKit {
  dir: string
  manifest: MiniAppKitManifest
  templateDir: string
}

/** Thrown when the app carries no usable kit — a broken install, never a user error. */
export class MiniAppKitUnavailableError extends Error {}

/**
 * Read the kit at `dir`; throws {@link MiniAppKitUnavailableError}. Staging passes the kit it just
 * wrote; the running app passes `miniAppKitDir()` (`kit-root.ts`).
 */
export async function loadMiniAppKit(dir: string): Promise<MiniAppKit> {
  let manifest: unknown
  try {
    manifest = JSON.parse(await fs.readFile(join(dir, MINI_APP_KIT_MANIFEST), 'utf8'))
  } catch (error) {
    throw new MiniAppKitUnavailableError(
      `This Localix build carries no mini app kit at ${dir} (${(error as Error).message}).`,
    )
  }
  if (!isMiniAppKitManifest(manifest)) {
    throw new MiniAppKitUnavailableError(`The mini app kit at ${dir} has an unknown layout.`)
  }
  return { dir, manifest, templateDir: join(dir, MINI_APP_KIT_TEMPLATE_DIR) }
}
