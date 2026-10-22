import { join } from 'node:path'

import { MARKETPLACE_FILE } from '@localixai/claude-plugin'

import { pathExists } from '../ext/fs-discovery'
import { MARKETPLACE_CATALOG_FILE } from './manifest-locate'

/**
 * Claude Code marketplaces (`.claude-plugin/marketplace.json`) are not read yet: a source that is
 * only one is refused with this hint. Claude Code PLUGINS need nothing here — they load in place
 * (`layout/compose.ts`).
 */
export const CLAUDE_CODE_MARKETPLACE = MARKETPLACE_FILE

export const CLAUDE_CODE_MARKETPLACE_HINT =
  'This is a Claude Code marketplace; install its plugins individually with /plugin install <owner/repo or path>'

/** True when `dir` carries only a Claude Code marketplace catalog. */
export async function isClaudeCodeMarketplace(dir: string): Promise<boolean> {
  const [native, foreign] = await Promise.all([
    pathExists(join(dir, MARKETPLACE_CATALOG_FILE)),
    pathExists(join(dir, CLAUDE_CODE_MARKETPLACE)),
  ])
  return foreign && !native
}
