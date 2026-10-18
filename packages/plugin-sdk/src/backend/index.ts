/**
 * Backend plugin surface — everything a plugin's `register(ctx)` compiles against:
 * the context, lifecycle hooks, channel bridge contracts, and the agent-tool
 * contracts re-exported from `@localixai/agent/agents`. The host (`apps/api`)
 * implements these interfaces; plugins only consume the types.
 */
export type {
  PluginAgentDirectory,
  PluginAgentSummary,
  PluginConfigValues,
  PluginContext,
  PluginProblem,
  PluginPathWatch,
  PluginScreenSnapshot,
  TerminalRead,
  PluginRuntimeInfo,
  PluginUi,
  PluginUiDestination,
} from './context'
export type {
  PluginHostServices,
  PluginMonitorArmOutcome,
  PluginMonitorArmRequest,
  PluginMonitorsHost,
  PluginWakeOutcome,
  PluginWakeRequest,
  SecretConsumer,
  TerminalReadHost,
  WorkspaceScopeHost,
  WorkspacesHost,
} from './host-services'
export type { PluginHelpers, ReadableResult } from './helpers'
export type {
  AutomaticContextProvider,
  AutomaticContextRequest,
  ContextContribution,
  ContextDestination,
  ContextEstimate,
  ContextProviderContribution,
  ContextReference,
  ContextReferenceAttributes,
  ContextResolver,
  ContextScope,
  ContextSensitivity,
  ResolveContext,
} from './context-fabric'
export { CONTEXT_UNAVAILABLE_KIND } from './context-fabric'
export type {
  ConfirmGrantOption,
  ConfirmToolPayload,
  ConfirmToolRequest,
  ConfirmToolResponse,
  ConfirmToolResponsePayload,
} from './hitl-confirm'
export type {
  ConfigChangePayload,
  ConfigChangeRequest,
  ConfigChangeResponse,
  ConfigChangeResponsePayload,
  ConfigReloadClass,
} from './hitl-config-change'
export {
  createResourceProviderRegistry,
  decodeResourceSegment,
  encodeResourceSegment,
  linkAction,
  noticeNode,
  buildResourceUri,
  parseResourceUri,
  flattenResourceBrowse,
  resourceBrowseFailureNotice,
  resourceDrillPartial,
  resourceNav,
  resourceParentPartial,
  providerSegments,
  truncationNotice,
} from './resource-refs'
export { parseLocalixResourceUri, localixUriNamespace } from '../resource'
export type { AddressableResource, ParsedLocalixResourceUri } from '../resource'
export type {
  ParsedResourceUri,
  ResourceBrowseGroup,
  ResourceBrowseResult,
  ResourceNavTarget,
  ResourceExpansion,
  ResourceNode,
  ResourceNodeAction,
  ResourceProviderRegistry,
  ResourceRefProvider,
  ResourceRefScope,
} from './resource-refs'
export { safeFileKey } from './safe-file-key'
export { defineTypedError } from './typed-error'
export type {
  TypedDomainError,
  TypedDomainErrorClass,
  TypedDomainErrorOptions,
  TypedErrorInfo,
  TypedErrorKit,
} from './typed-error'
export { resolveExecutable, toolEnv, toolPath } from './executables'
export type { ToolPathOptions } from './executables'
export { isMissingExecutable } from '../prerequisite'
export type { Prerequisite, PrerequisiteState } from '../prerequisite'
export {
  bestFieldScore,
  normalizeSearchText,
  rankSearchCandidates,
  scoreSearchFields,
} from './search-match'
export type {
  RankedSearchResult,
  RankSearchOptions,
  SearchCandidate,
  SearchField,
  ScoreSearchOptions,
} from './search-match'
export { fnv1a32, fnv1aHex } from './fnv1a'
export { shellQuote } from '../shell-quote'
export {
  BINARY_SNIFF_LENGTH,
  fileExtension,
  hasBinarySignature,
  mediaTypeForExtension,
  mediaTypeForPath,
  mediaTypesFor,
} from '../media-types'
export { embeddedV4, ipv6ToBytes } from './ip-literal'
export {
  checkUrlSafety,
  isPrivateAddress,
  isPrivateIPv4,
  isPrivateIPv6,
  readBodyCapped,
} from './net-safety'
export { safeFetch, type SafeFetchOptions, type SafeFetchResult } from './safe-fetch'
export { classifyByAction, UNKNOWN_CALL_CLASS, widestCallClass } from './call-class'
export type { HostResolver, HttpFetch } from './net-safety'
export { PRIVATE_NETWORK_HOSTS, PUBLIC_NETWORK_HOSTS } from './net-safety-vectors'
export { DeadlineExceededError, withTimeout } from './timeout'
export { estimateTokens } from './tokens'
export {
  PROVIDER_TIMEOUT_MS,
  createSearchProviderRegistry,
  searchHitsOf,
  selectProviders,
} from './search-provider'
// The semantic index seam: sources, queries and the plugin host capability.
export type * from './semantic'
export { SEMANTIC_GLOBAL_SCOPE } from './semantic'
// The problem shape a backend puts on the wire is the SAME one the UI renders — re-exported
// here so a server file never has to reach into the `ui/` half to name it.
export type { Problem, ProblemSeverity } from '../ui/problems'
export type {
  SearchFanOut,
  SearchHit,
  SearchProvider,
  SearchProviderAnswer,
  SearchProviderRegistry,
  SearchProviderResult,
  SearchQuery,
} from './search-provider'
export { createResourceContextProvider, namespacedResourceKind } from './resource-context-provider'
export { createStaticContextProvider } from './static-context-provider'
export type { StaticContextProviderSpec } from './static-context-provider'
export type {
  ResourceContextExpander,
  ResourceContextKind,
  ResourceContextProviderSpec,
} from './resource-context-provider'
export { ApiError, errorMessage, isApiError } from './errors'
export { defaultErrorHandler, jsonBody, jsonError, summarizeZodIssues } from './http'
export { routeValidator } from './route-validator'
export type {
  RouteValidationTarget,
  RouteValidator,
  RouteValidatorInput,
  RouteValidatorOptions,
} from './route-validator'
export type { BodySchema, ZodIssueBearer, ZodIssueLike, ZodIssueSummary } from './http'
export type {
  HostRouteContext,
  JsonErrorStatus,
  PluginRouteContext,
  PluginRouteScope,
} from './http'
export { hasSecretTokens, resolveSecretTokens } from './secret-interpolate'
export { atomicWriteFile, ensureParentDir, statIfExists } from './file-io'
export { resolveTargetPath } from './target-path'
export { createUserEntityStore } from './user-entity-store'
export type { EntityPatch, UserEntityStore, UserEntityStoreOptions } from './user-entity-store'
export {
  EXIT_DRAIN_MS,
  KILL_ESCALATION_MS,
  awaitBunChildGone,
  awaitChildGone,
  releaseChildPipes,
} from './child-exit'
export type { BunChild, ChildGone } from './child-exit'
export { readProcessOutput, readProcessOutputWithTimeout } from './process-output'
export type { KillablePipedProcess, PipedProcess, ProcessOutput } from './process-output'
export { createWsFrameConnection, createWsFrameRegistry } from './ws-frame-registry'
export type {
  WsFrameConnection,
  WsFrameContribution,
  WsFrameRegistration,
  WsFrameRegistry,
  WsFrameStreamContext,
} from './ws-frame-registry'
export { plural, pluralize } from './plural'
export { MAX_MODEL_CHARS, PREVIEW_ROWS, renderDocumentForModel } from './document-ports'
export type {
  DocExtractMetadata,
  DocExtractParams,
  DocExtractResult,
  DocExtractTable,
  DocExtractWindow,
  DocExtractText,
  DocGenerateFormat,
  DocGenerateParams,
  DocGenerateResult,
  DocumentExtractPort,
  DocumentGeneratePort,
  DocumentTextExtractor,
} from './document-ports'
export type { PluginOAuth, PluginOAuthLogin } from './oauth'
export { CAP_DOCUMENT_EXTRACT } from './capabilities'
export type { Capabilities, CapabilityKey, CapabilityShapes } from './capabilities'
export type {
  PluginTextInputCompletionPayload,
  PluginTextInputCompletionRequest,
  PluginTextInputCompletionSurface,
} from './text-input-completion-port'
export { cleanCompletionSuffix, completionDraftTail } from './completion-text'
export type { BackendSubsystem, PluginUiActionContext, PluginUiActionHandler } from './subsystem'
export type { PluginRegistration } from './registration'
export { createManifestOAuthAdapter } from './oauth-manifest'
export { pollDeviceCode } from './oauth-device-code'
export type { ManifestOAuthSpec } from './oauth-manifest'
export type { OAuthCredential } from './oauth-types'
export {
  ASSISTANT_BINDINGS_MAX,
  ASSISTANT_BINDING_DATA_CAP_BYTES,
  MEMORY_CONTEXT_CAP_CHARS,
  MEMORY_TIMEOUT_MS,
} from './hooks'
export type {
  AssistantMessageEvent,
  AssistantMessageHookResult,
  HitlRequestEvent,
  HitlResolvedEvent,
  HumanAssignedEvent,
  MemoryLoadContextEvent,
  MemoryProvider,
  MemoryRunEndEvent,
  PluginHooks,
  PostToolCallEvent,
  PostToolCallHookResult,
  PreToolCallEvent,
  PreToolCallHookResult,
  SubagentStopEvent,
  UserMessageEvent,
  UserMessageHookResult,
} from './hooks'
export type {
  ChannelContext,
  ChannelInboundMessage,
  ChannelInboundResult,
  ChannelModelOption,
  ChannelRunEvent,
  ChannelSessionSummary,
  ChannelWorkspaceApi,
  PluginChannel,
} from './channels'

// Agent-tool contracts a plugin types its tools against — re-exported so a plugin
// (or an external repo) depends only on the SDK.
export type {
  AgentTool,
  AgentToolExecutionContext,
  AgentToolResult,
  AgentToolSealing,
  CallClass,
  CallEffect,
  HumanInLoopController,
  ToolAvailability,
  ToolSurface,
} from '@localixai/agent/agents'
export type { ToolBackedItem } from '@localixai/agent/agents/items'

export { createStoreChangeFeed, STORE_FEED_WINDOW_MS } from './store-change-feed'
export { createJsonStoreFeed, onStoreWrite, openJsonStore } from './json-store'
export type { JsonStore } from './json-store'
export { askAgentForTurn } from './agent-turn'
export type { Seat, Wake } from './agent-turn'
export { seal } from './sealed'
export type { Sealed, SealedView } from '../sealed'

export { observeMutations } from './observe-mutations'
