import { join } from 'node:path'

import { pathExists } from '../ext/fs-discovery'
import { DEFAULT_MARKETPLACE_PATH } from './kit'

/** Where Claude Code reads a marketplace's catalog in its folder. */
export const CLAUDE_CODE_MARKETPLACE = DEFAULT_MARKETPLACE_PATH

/**
 * Why a folder cannot be installed as a plugin because it is only a marketplace catalog, or null.
 * Claude Code installs a marketplace's plugins by name, never the marketplace folder itself.
 */
export async function marketplaceOnlyHint(dir: string): Promise<string | null> {
  if (!(await pathExists(join(dir, CLAUDE_CODE_MARKETPLACE)))) return null
  return 'This is a plugin marketplace: add it with /plugin marketplace add <source>, then install its plugins with /plugin install <name>@<marketplace>'
}
