/**
 * The plugin kit boundary: the only folder that imports `@rsaryev/llx-plugin` (rule X7,
 * `docs/internals/plugins-and-mini-apps.md`). Everything Localix knows about the Claude Code
 * plugin format and its semantics comes from the kit through this file; the rest of the API calls
 * what it exports, never the kit itself. In-memory ports for other features' tests are in
 * `./testing`.
 */
export {
  createLocalixPluginHost,
  type LoadedKitPlugin,
  type LocalixPluginHost,
  type PluginHostDeps,
} from './host'
export {
  createChatPluginSessions,
  type ChatPluginSessions,
  type ChatSessionFacts,
} from './sessions'
export {
  issueLine,
  readPluginFolder,
  type CatalogPlugin,
  type FolderSource,
} from './catalog/read-folder'
export type { ResolvedEntrypoints } from './catalog/entrypoints'
export { validatePluginFolder } from './catalog/validate'
export { readAgentText, type AgentFileRead } from './catalog/agent-file'
export type { PluginCcComponents, PluginWorkflow } from './catalog/components'
export type { Plugin as KitPlugin } from '@rsaryev/llx-plugin/loading'
export type { PluginIssue } from '@rsaryev/llx-plugin/format'
export { createHostPorts, type HostPortsDeps, type LocalixKitPorts } from './ports/host-ports'
export type { McpCallByName, ModelBackend } from './ports/session-ports'
