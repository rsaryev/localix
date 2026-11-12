/**
 * The plugin kit boundary: the only folder that imports a value of `@rsaryev/llx-plugin` (rule X7,
 * `docs/internals/plugins-and-mini-apps.md`). Everything Localix does with the Claude Code plugin
 * format and its semantics runs through this file; the rest of the API calls what it exports, and
 * names the kit's types with `import type` straight from the kit (this file re-exports none of
 * them). In-memory ports for other features' tests are in `./testing`.
 */
export { createLocalixPluginHost, type LocalixPluginHost } from './host'
export {
  createChatPluginSessions,
  pluginErrors,
  runningPlugins,
  type ChatPluginSessions,
  type ScopePlugin,
} from './sessions'
export { sessionLspServers, type PluginLspServer } from './lsp-servers'
export { monitorsToLaunch, type MonitorLaunch } from './monitors'
export { scopeAgents, type HostAgents, type ScopeAgent, type ScopeAgents } from './agents'
export { catalogTier } from '@rsaryev/llx-plugin/agents'
export { scopeRun, type ScopeRun } from './scope-session'
export { chosenSubagentStatusLine, type ChosenSubagentStatusLine } from './subagent-status-line'
export { readPluginFolder, type FolderSource } from './catalog/read-folder'
export { issueLine } from './catalog/issue-line'
export { isPluginFolder, PLUGIN_MANIFEST } from './catalog/plugin-folder'
export { dropSynthesizedManifest } from './catalog/synthesized-manifest'
export { pluginNameRefusal } from './catalog/manifest'
export type { ResolvedEntrypoints } from './catalog/entrypoints'
export { mcpShellFieldRefusals, validatePluginFolder } from './catalog/validate'
export {
  agentHooksRun,
  agentMcpSpecs,
  agentMemory,
  askedPermissionMode,
  subagentModelRoute,
  subagentPermissionMode,
  type SubagentModelContext,
  type AgentMemoryContext,
} from './spawn'
export { resolveModelAlias } from './model-alias'
export type { HexTheme, PluginWorkflow } from './catalog/components'
export { readSkillDescriptions } from './catalog/components'
export { workflowScript, type WorkflowScript } from './catalog/workflow-script'
export { savedWorkflows } from './catalog/saved-workflows'
export { frontmatterFileText } from './catalog/frontmatter-edit'
export {
  activeStyleId,
  builtinStyleDescription,
  commandStyleId,
  DEFAULT_OUTPUT_STYLE_ID,
  offeredStyleIndexes,
  outputStyleFile,
  type StyleBody,
} from './catalog/output-style'
export { outputStyleFolders } from './catalog/output-style-folders'
export { lateModelRunner, type CcMcpToolResult, type ModelBackend } from './ports/session-ports'
export {
  readClaudeSettings,
  readClaudeSettingsSync,
  mergedSettings,
  type ClaudeSettings,
  type ClaudeSettingsInput,
  type Settings,
} from './settings/read'
export { isFileScope } from '@rsaryev/llx-plugin/settings'
export { managedSettingsDir, type ManagedSettingsSource } from './settings/managed'
export { claudeCodeTrust, claudeCodeTrusts } from './settings/trust'
export { claudeCodeSettingsEnv, settingsEnvOf } from './settings/env'
export { installKitPorts } from './install-ports'
export { mcpServerShape } from './settings/mcp-record'
export { settingsCommandLine } from './settings/hooks'
export { outputStyleSetting, settingsModes } from './settings/values'
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
  type SettingsRules,
} from './permissions'
export { openRunHooks } from './hooks/run-hooks'
export type { ScopedHooksBlock } from './hooks/scoped'
export { formatHookEntries } from './hooks/listing'
export { settingsAdditionalDirectories, settingsRuleEntries } from './settings/permissions'
export { invokeSkill, invokeTypedSkills, type SkillShellAnswer } from './skills'
export {
  findSessionSkill,
  isPluginCommand,
  projectOrGlobal,
  sessionSkills,
  skillListing,
  touchSessionFiles,
  typedSkills,
} from './skill-catalog'
export { skillKeywords, skillPlugin } from '@rsaryev/llx-plugin'
export { preloadedSkillTexts, skillTexts, type SkillText } from './skill-texts'
export { scopeSkills, type ScopeSkills } from './scope-skills'
export {
  readSkillFolder,
  skillFilePath,
  skillNameRefusal,
  type FolderSkill,
  type SkillFolder,
} from './skill-files'
export { skillPromptInput, type SkillOrigin, type SkillPromptInput } from './mods/skill-prompt'
export {
  catalogKnows,
  parseMarketplace,
  readCatalogJson,
  readMarketplace,
  resolveEntryName,
} from './marketplace/catalog'
export {
  asRecorded,
  catalogAt,
  readKnownMarketplaces,
  writeKnownMarketplaces,
  type KnownMarketplace,
  type KnownMarketplaces,
} from './marketplace/records'
export {
  clearOrphaned,
  markOrphaned,
  orphansToSweep,
  pluginStore,
  readInstalled,
  versionsToOrphan,
  writeInstalled,
} from './marketplace/installs'
export {
  declaredDependencies,
  disableRefusal,
  enableCascade,
  uninstallRequiredBy,
} from './marketplace/dependency-graph'
export {
  installedRecord,
  planInstallClosure,
  readFetchedManifest,
  type ClosureMarketplace,
  type FetchedCopy,
} from './marketplace/install-closure'
export {
  autoUpdatePassAllowed,
  autoUpdateToggleRefusal,
  leftByMarketplaceUpdate,
  updateSkipOf,
} from './marketplace/updates'
export { pluginVersion, precheckUpdate, UNKNOWN_VERSION, updateCheck } from './marketplace/versions'
export {
  cloneUrl,
  describeSource,
  isLocalSource,
  marketplaceAddRefusal,
  marketplaceFetchPlan,
  parseMarketplaceAdd,
  sameMarketplaceSource,
} from './marketplace/sources'
export {
  assertMarketplaceAllowed,
  assertPluginAllowed,
  managedDeclarations,
} from './marketplace/policy'
export {
  entryFetchPlan,
  entryFolder,
  localEntryDir,
  type EntryFetchPlan,
} from './marketplace/entry-source'
export {
  archiveHeaders,
  catalogHeaders,
  helperAcceptance,
  type UrlSourceHeaders,
} from './marketplace/headers'
export { assertSafeZip, judgedArchive, type JudgedArchive } from './marketplace/archive'
export {
  claudeCodePluginSettings,
  claudeCodePluginStore,
  winningInstall,
} from './marketplace/claude-code'
export { declaredMarketplaces, type DeclaredMarketplace } from './marketplace/declared'
export {
  ARCHIVE_LIMITS,
  DEFAULT_MARKETPLACE_PATH,
  installsAt,
  marketplaceAutoUpdate,
  parseInstalledPlugins,
} from '@rsaryev/llx-plugin/marketplace'
export { hostPlatform } from './ports/host-io'
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
export { claudeCodeToolName, localToolName, type NamedTool } from './tool-names'
export { claudeCodeHookCall, localInputFromHook, toolCallEvent, toolInputOf } from './tool-calls'
export {
  agentSpawnRefusal,
  agentToolCandidates,
  agentToolsRefusal,
  namesBuiltinTool,
  narrowAgentTools,
  type AgentToolRun,
} from './subagent-tools'
export {
  createStateStore,
  deepFreeze,
  STATE_LIBRARY_SOURCE,
  type StateRef,
  type StateStore,
} from './mods/state'
export { splitDenyList } from './deny-list'
export {
  hooksTightenOnlyIn,
  mergeToolCheck,
  type ToolCheckContext,
  type ToolDecision,
} from './mods/tool-check'
export { createEndpoint, type Endpoint, type Handler } from './mods/guest/endpoint'
export type { ApiShape, CallMeta, CallReply } from './mods/guest/call-protocol'
export { loadModRuntime } from './mods/guest/runtime-file'
export { defaultElementTable, describeApi, isHookBody } from '@rsaryev/llx-plugin/mods'
export { diskFiles, type DiskFiles } from './ports/files'
export { createModsHost } from '@rsaryev/llx-plugin/mods'
export { hostCommandRunner } from './ports/command-runner'
export { sessionEnvScripts } from './ports/session-files'
export { hostLocations, systemClock } from './ports/host-io'
export { claudeCodeToolResponse, singleCalls } from './tools/cc-tool-shapes'
