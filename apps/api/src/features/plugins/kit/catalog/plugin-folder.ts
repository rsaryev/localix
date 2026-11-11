import { classifyPluginFolder } from '@rsaryev/llx-plugin'
import { STANDARD_LAYOUT } from '@rsaryev/llx-plugin/layout'
import { diskFiles } from '../ports/files'

/** A plugin's manifest, relative to its root: `.claude-plugin/plugin.json`. */
export const PLUGIN_MANIFEST = STANDARD_LAYOUT.manifest.location

/**
 * Whether the folder `dir` is one plugin, as the kit classifies a folder: a `.claude-plugin/`
 * folder (unless it holds only a `marketplace.json`), a non-empty `.mcp.json` or a component at
 * its top level. A folder that is none of these is skipped by a scan.
 */
export async function isPluginFolder(dir: string): Promise<boolean> {
  return (await classifyPluginFolder({ files: diskFiles(dir) })) === 'plugin'
}
