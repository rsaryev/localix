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
  type ScopePlugin,
} from './sessions'
export { scopeMcpServers, type McpScope, type ScopeMcpServers } from './mcp-servers'
export { sessionLspServers, type PluginLspServer, type SessionLspServers } from './lsp-servers'
export { monitorsToLaunch, type MonitorLaunch, type MonitorLaunches } from './monitors'
export {
  scopeAgents,
  type AgentReference,
  type AgentsRead,
  type HostAgents,
  type ScopeAgent,
  type ScopeAgents,
  type ScopeAgentSource,
} from './agents'
export type { PluginScope } from './scope-session'
export {
  issueLine,
  readPluginFolder,
  type CatalogPlugin,
  type FolderSource,
} from './catalog/read-folder'
export type { ResolvedEntrypoints } from './catalog/entrypoints'
export { validatePluginFolder } from './catalog/validate'
export {
  agentHooksRun,
  agentMcpSpecs,
  agentMemory,
  askedPermissionMode,
  preloadedSkillNames,
  subagentModelRoute,
  subagentPermissionMode,
  type SubagentModelContext,
  type AgentMcpSpecs,
  type AgentMemory,
  type AgentMemoryContext,
  type AgentMemoryScope,
  type PreloadableSkill,
} from './spawn'
export type { PluginCcComponents, PluginWorkflow } from './catalog/components'
export { readSkillDescriptions } from './catalog/components'
export type { Plugin as KitPlugin } from '@rsaryev/llx-plugin/loading'
export type { PluginIssue } from '@rsaryev/llx-plugin/format'
export { createHostPorts, type HostPortsDeps, type LocalixKitPorts } from './ports/host-ports'
export {
  lateMcpCaller,
  lateModelRunner,
  type CcMcpToolResult,
  type McpCallByName,
  type ModelBackend,
} from './ports/session-ports'
export {
  readClaudeSettings,
  readClaudeSettingsSync,
  mergedSettings,
  type ClaudeSettings,
  type ClaudeSettingsInput,
  type Settings,
  type SettingsFile,
  type SettingsFileScope,
} from './settings/read'
export {
  managedSettingsDir,
  readManagedSettings,
  systemManagedSource,
  type ManagedSettingsSource,
} from './settings/managed'
export { claudeCodeTrusts, trustedFolders } from './settings/trust'
export { claudeCodeSettingsEnv, settingsEnvOf } from './settings/env'
export { mcpSettingsReader } from './settings/mcp'
export { settingsCommandLine, type SettingsCommandLine } from './settings/hooks'
export {
  customizationLocks,
  outputStyleSetting,
  settingsModes,
  skillShellDisabled,
  type SettingsModes,
} from './settings/values'
export {
  describeClaudeCodePermissions,
  type ClaudeCodePermissionsView,
} from './settings/permissions-view'
export {
  settingsDeniesAgent,
  settingsRemovesTool,
  settingsResolvedPaths,
  settingsRules,
  settingsVerdict,
  withRealDirectories,
  withSessionRules,
  type SessionRuleSpec,
  type SettingsRules,
  type SettingsVerdict,
} from './permissions'
export type { PluginSession as KitSession } from '@rsaryev/llx-plugin'
export { openRunHooks } from './hooks/run-hooks'
export type { ScopedHooksBlock } from './hooks/scoped'
export { formatHookEntries } from './hooks/listing'
export {
  settingsAdditionalDirectories,
  settingsRuleEntries,
  type SettingsRuleEntry,
} from './settings/permissions'
export {
  invokeSkill,
  invokeTypedSkills,
  type InvokedSkill,
  type InvokeSkillOptions,
  type SkillInvocation,
  type SkillShellAnswer,
} from './skills'
export {
  findSessionSkill,
  reloadSessionSkills,
  sessionSkills,
  skillListing,
  touchSessionFiles,
  typedSkills,
  type ChatSkill,
  type TypedSkills,
} from './skill-catalog'
export { preloadedSkillTexts, skillTexts, type SkillText } from './skill-texts'
export { scopeSkills, type ScopeSkills } from './scope-skills'
export { skillPromptInput, type SkillOrigin, type SkillPromptInput } from './mods/skill-prompt'
export {
  catalogKnows,
  marketplaceOrigin,
  parseMarketplace,
  readCatalogJson,
  readMarketplace,
  relativeEntryPath,
  resolveEntryName,
  type Marketplace,
  type MarketplaceEntry,
  type PluginSource,
} from './marketplace/catalog'
export { resolveEntrySource, type ResolvedEntrySource } from './marketplace/entry-source'
export { withoutRoutingHeaders } from '@rsaryev/llx-plugin/marketplace'
export {
  clampReason,
  contextUsage,
  MOD_LIMITS,
  modNameProblem,
  promptDroppedText,
  unansweredCommandReply,
  withheldResultText,
  type ToolCallEnd,
} from './mods/values'
