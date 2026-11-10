/** Where the manifest lives, relative to the plugin root. Nothing else loads from this folder. */
export const MANIFEST_DIR = '.claude-plugin'
export const MANIFEST_FILE = `${MANIFEST_DIR}/plugin.json`
export const MARKETPLACE_FILE = `${MANIFEST_DIR}/marketplace.json`

/**
 * A folder is a plugin without a manifest when one of these is present: the plugin is then named
 * after the folder.
 */
export const COMPONENT_MARKERS: readonly string[] = [
  MANIFEST_FILE,
  'skills',
  'SKILL.md',
  'commands',
  'agents',
  'hooks/hooks.json',
  '.mcp.json',
  '.lsp.json',
  'monitors/monitors.json',
]
