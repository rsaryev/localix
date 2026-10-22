/**
 * The Claude Code plugin format, and nothing else: what `.claude-plugin/plugin.json` and
 * `hooks/hooks.json` may hold, the rules for names and paths, and where each component lives.
 * A host composes this with its own concepts; nothing here knows of one.
 */
export { hasErrors, type PluginIssue } from './issues'
export { checkPluginName } from './names'
export { checkComponentPath, isRemoteBundle } from './paths'
export {
  commandEntrySchema,
  dependencySchema,
  parseClaudePluginManifest,
  userConfigOptionSchema,
  type ClaudePluginManifest,
  type CommandEntry,
  type ParsedClaudePluginManifest,
  type PluginDependency,
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
export { HOOKS_MODULE_EXTENSIONS, parseHooksFile, type HooksFile } from './hooks'
