/**
 * The Claude Code plugin format, and nothing else: what `.claude-plugin/plugin.json` may hold,
 * the rules for names and paths, and where each component lives.
 * A host composes this with its own concepts; nothing here knows of one.
 */
export type { PluginIssue } from './issues'
export {
  parseClaudePluginManifest,
  type ClaudePluginManifest,
  type ParsedClaudePluginManifest,
  type UserConfigOption,
} from './manifest'
export {
  COMPONENT_MARKERS,
  componentSources,
  DEFAULT_LOCATIONS,
  MANIFEST_DIR,
  MANIFEST_FILE,
  MARKETPLACE_FILE,
  type ComponentSources,
  type FolderSource,
  type MergedSource,
} from './layout'
export { DEFAULT_OUTPUT_STYLE, outputStyleOf, type OutputStyle } from './output-style'
export { pluginSettingsOf, type PluginSettings } from './plugin-settings'
export { parseTheme, themeColor, type ClaudeTheme, type ThemeBase } from './theme'
export { parseWorkflowMeta, type WorkflowMeta, type WorkflowMetaResult } from './workflow-meta'
