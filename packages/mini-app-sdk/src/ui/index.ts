/**
 * Workbench UI contribution surface — the contracts a plugin's `ui/register.tsx`
 * compiles against. The host (`apps/ui`) implements the registries and passes a
 * {@link PluginUiHost} into `registerUi(host)`.
 */
export type {
  MessageBindingTargetKind,
  MessageBindingDraft,
  MessageContextBindingDraft,
  PublishedMessageContext,
  PublishMessageContext,
  IconComponent,
  PluginOwnedContribution,
  RailSectionContribution,
  RailViewletContribution,
  SessionSurfaceContribution,
  SessionSurfaceProps,
  WorkItemKindContribution,
  WorkItemSlotContribution,
  WorkItemAgentContext,
  WorkItemBindingContext,
  WorkItemLike,
} from './contrib'
export {
  LIVE_SNIPPET_CONTENT_MAX,
  PUBLISHED_MESSAGE_CONTEXT_MAX_BINDINGS,
  normalizePublishedMessageContext,
  resourceMessageBindingDraft,
  snippetMessageBindingDraft,
} from './contrib'
export { enqueueMicrotask, type MicrotaskHost } from './microtask'
export type { SearchDomainContribution, SearchDomainScope } from './search'
export type {
  UiAnchorContribution,
  UiAnchorCommand,
  UiAnchorFile,
  UiAnchorInspector,
  UiAnchorModelPicker,
  UiAnchorNode,
  UiAnchorOpenResult,
  UiAnchorOverlay,
  UiAnchorOverlayParam,
  UiAnchorProject,
  UiAnchorMessage,
  UiAnchorRailSection,
  UiAnchorSession,
  UiAnchorSettings,
  UiAnchorWorkItem,
  UiAnchorWorkItemFocus,
  UiNavigationAction,
  UiNavigationOutput,
  UiNavigationSuggestions,
} from './anchors'
export {
  isUiNavigationAction,
  isUiNavigationOutput,
  isUiNavigationSuggestions,
  localixResourceUri,
  localixUiUri,
  localixUri,
  parseLocalixUri,
  settingsEntityAnchor,
  settingsEntityUiUri,
  settingsUiUri,
} from './anchors'
export { localixUriNamespace, parseLocalixResourceUri } from '../resource'
export type { AddressableResource, ParsedLocalixResourceUri } from '../resource'
export type { LocalixUiPrimitive, LocalixUriPrimitive, ParsedLocalixUri } from '../navigation'
export {
  defineContextualUiSurface,
  defineUiLocation,
  defineUiMutation,
  isContextualUiSurface,
} from './locations'
export type {
  ResolvedUiLocation,
  UiContextualExposure,
  UiContextualSurfaceDeclaration,
  UiContextualSurfaceInput,
  UiLocationArgs,
  UiLocationAgentMetadata,
  UiAgentLocationCatalogSnapshot,
  UiAgentLocationDescriptor,
  UiLocationContribution,
  UiLocationDescriptor,
  UiLocationEffect,
  UiLocationExposure,
  UiLocationParamDefinition,
  UiLocationParamSchema,
  UiLocationPresentation,
  UiMutationContribution,
  UiSurfaceCatalogEntry,
  UiSurfaceCatalogSnapshot,
  UiSurfaceKind,
} from './locations'
export {
  UI_AGENT_LOCATION_CATALOG_LIMIT,
  UI_AGENT_LOCATION_CATALOG_VERSION,
  UI_LOCATION_DEFAULT_ARRAY_MAX,
  UI_LOCATION_DEFAULT_STRING_MAX,
  UI_LOCATION_QUERY_ENTRY_LIMIT,
  buildUiLocationUri,
  isValidUiLocationParamSchema,
  isValidUiLocationAgentMetadata,
  isValidUiMutationBaseUri,
  normalizeUiAgentLocationDescriptor,
  normalizeUiAgentLocationCatalogSnapshot,
  normalizeUiLocationBaseUri,
  parseUiLocationArgs,
} from './locations'
export type {
  FileEditorContribution,
  FileEditorEnhancerContribution,
  FileEditorEnhancerProps,
  FileEditorProps,
  FileTreeDecoration,
  FileTreeDecorationContribution,
  FileTreeDecorationIndex,
} from './editors'
export type { DedicatedViewerType, FileViewerKind } from './file-types'
export {
  CSV_CONTENT_TYPE,
  DOCX_CONTENT_TYPE,
  ODT_CONTENT_TYPE,
  PDF_CONTENT_TYPE,
  PPTX_CONTENT_TYPE,
  XLSX_CONTENT_TYPE,
  fileExtension,
} from './file-types'
export type {
  MenuActionEntry,
  MenuEntry,
  MenuHeaderEntry,
  MenuSeparatorEntry,
  MenuSubmenuEntry,
  StatusItemContribution,
  StatusItemState,
  StatusMetric,
  StatusTone,
} from './status-items'
export { STATUS_ITEM_PLACEMENTS } from './status-items'
export { tonedIcon } from './toned-icon'
export type { StatusMenuListOptions } from './status-menu'
export { STATUS_MENU_LIST_LIMIT, statusMenuList } from './status-menu'
export type { FileIconData, PluginUiHost } from './host'
export type { ToolCardContribution, ToolPresentation } from './tool-cards'
export type { CommentActionContribution, CommentBatch } from './comment-actions'
export type { ActionContext, ActionContribution, ActionTarget } from './actions'
export { ActionSurfaceProvider, useActionSurface } from './action-context'
export {
  acknowledgeInline,
  bindPluginUiToast,
  pluginNotificationCallSite,
  runPluginAction,
  toast,
} from './notifications'
export type {
  PluginProblemsOptions,
  PluginToast,
  PluginToastId,
  PluginToastOptions,
} from './notifications'
export { useProblemReport } from './use-problem-report'
// Prerequisite recovery (Install / Start) has its own subpath, `./ui/prerequisite-recovery`, and the
// shape its own, `./prerequisite`: the barrel is past its byte ceiling, and every plugin pays it.
export type { OwnedProblemReport } from './use-problem-report'
export {
  problemConsequenceLabel,
  problemKey,
  problemReportDedupeKey,
  problemReportTitle,
  problemSeverity,
  problemSubjectKey,
  sortProblems,
  worstProblemSeverity,
} from './problems'
export type {
  Problem,
  ProblemConsequence,
  ProblemLocation,
  ProblemRecovery,
  ProblemReport,
  ProblemRequest,
  ProblemSeverity,
  ProblemSubject,
} from './problems'
export { cn, clamp } from './classes'
export { HOST_THEME_VARIABLES, hostThemeVariablesToCss, readHostThemeVariables } from './theme'
export type { HostThemeVariable, HostThemeVariables } from './theme'
export { ResultCountStatus, type ResultCountStatusProps } from './result-count-status'
export { downloadChartPng, downloadChartSvg } from './chart-export'
export { ChartView } from './charts/ChartView'
export {
  bindPluginUiComponents,
  ContextBindingIcon,
  ContextBindingPreview,
  FileTab,
  Input,
  ProblemLine,
  TableGrid,
  Textarea,
} from './components'
export type {
  PluginContextBindingIconProps,
  PluginContextBindingPreviewProps,
  PluginEditorCompletionItem,
  PluginEditorPosition,
  PluginEditorRunContext,
  PluginFileTabProps,
  PluginInputProps,
  PluginNextEditRequest,
  PluginStagedTableChanges,
  PluginTableGridProps,
  PluginTextareaProps,
  PluginUiComponents,
  EditorRunContext,
} from './components'
export {
  contextBindingFilePath,
  contextBindingFileName,
  contextBindingFileType,
  contextBindingMediaId,
  contextBindingImageMimeType,
  contextBindingPreviewKind,
} from './binding-presentation'
export type { ContextBindingPreviewKind } from './binding-presentation'
export {
  Segmented,
  SegmentedControl,
  SegmentedControlItem,
  SegmentedRadioGroup,
} from './segmented-control'
export type {
  SegmentedRadioGroupProps,
  SegmentedRadioOption,
  SegmentedRadioSize,
  SegmentedVariant,
} from './segmented-control'
export { DistributionChart, TrendChart } from './stats-charts'
export type { ChartPoint } from './stats-charts'
export { groupComments, useComments, useScopeComments } from './comments'
export type { Comment, CommentAnchor } from './comments'
export { pluginCommandBus } from './commands'
export type { PluginCommandEvent, PluginCommandFrame, PluginCommandReply } from './commands'
export { pluginResources } from './runtime'
export { copyText, useCopied } from './interactions'
export {
  MESSAGE_BINDING_DRAG_MAX_BYTES,
  MESSAGE_BINDING_DRAG_VERSION,
  MESSAGE_BINDING_KIND_MIME_PREFIX,
  MESSAGE_BINDING_MIME,
  OS_FILES_DRAG_KIND,
  clearMessageBindingDragAvailability,
  composerDropHint,
  createMessageBindingDraft,
  messageBindingDraft,
  messageBindingDragKind,
  messageBindingToken,
  promptHasToken,
  readMessageBindingDrag,
  setMessageBindingDrag,
} from './message-binding-drag'
export type {
  MessageBindingDragKind,
  MessageBindingDragOptions,
  MessageBindingDragPayload,
} from './message-binding-drag'
export { setCompactDragImage } from './drag-image'
export type { StorageReader, StorageWriter } from './storage'
export { loadJSON, loadString, saveJSON, saveString } from './storage'
export type { PathTreeDir, PathTreeItem, PathTreeLeaf, PathTreeNode } from './path-tree'
export { buildPathTree, folderPaths } from './path-tree'
export type { TableCopyColumn } from './table'
export type { PluginUiTransport } from './transport'
export {
  PluginApiError,
  assertPluginResponse,
  bindPluginUiTransport,
  cleanPluginQuery,
  pluginApiFetch,
  pluginErrorDetail,
  pluginApiUrl,
  postPluginJson,
  unwrapPluginResponse,
} from './transport'
// The whole runtime vocabulary, not a hand-maintained list of it. Every added door used to need
// an edit here too, and the list silently fell behind more than once — `PluginOpenFileRequest` was
// declared, exported from `./ui/runtime`, and missing from this barrel.
export type * from './runtime'
export {
  bindPluginUiRuntime,
  pluginClipboard,
  pluginComposer,
  pluginEditor,
  pluginExternal,
  pluginFiles,
  pluginNavigation,
  pluginProjects,
  pluginRealtime,
  pluginSessions,
  pluginSecrets,
  pluginTerminal,
  pluginWorkspace,
} from './runtime'
export {
  usePluginEditPredictionEnabled,
  usePluginSessions,
  usePluginTextInputCompletion,
} from './runtime-hooks'
export {
  allSessionActivityVersion,
  applySessionActivity,
  clearSessionActivity,
  getSessionActivity,
  retainSessionActivity,
  subscribeAllSessionActivity,
  subscribeSessionActivity,
  useSessionActivity,
} from './session-activity'
export type { SessionActivity } from './session-activity'
export { buildSessionChain } from './session-tree'
export type { SessionTreeNode } from './session-tree'
export type { VisiblePollingOptions } from './visibility'
export {
  WorkItemVisibilityProvider,
  useElementVisible,
  useInfiniteScroll,
  useVisiblePolling,
  useWorkItemVisible,
} from './visibility'
// Plugin-UI bridge protocol v1 — the postMessage contract for sandboxed
// (third-party) plugin iframes. Types + framework-free runtime helpers shared
// by the host and plugin sides.
export {
  PLUGIN_UI_BRIDGE_MARKER,
  PLUGIN_UI_BRIDGE_VERSION,
  SESSION_EVENT_NAME,
  createBridgeRequests,
  errorMessage,
  eventMessage,
  forwardableSessionPhase,
  invokeMessage,
  isInvokePayload,
  isMessageFromWindow,
  isPluginBridgeMessage,
  isSessionEventData,
  readyMessage,
  resultMessage,
  sessionEventMessage,
  themeMessage,
} from './bridge'
export type {
  AcquireLocalixApi,
  BridgeRequests,
  PluginBridgeErrorPayload,
  PluginBridgeEventPayload,
  PluginBridgeInvokePayload,
  PluginBridgeMessage,
  PluginBridgeMessageType,
  PluginBridgeSessionEventData,
  PluginBridgeThemePayload,
  PluginSessionPhase,
  PluginUiApi,
  PluginUiInvokeOptions,
} from './bridge'

/**
 * The provider-id vocabulary, re-exported for the UI half.
 *
 * It lives under `backend/` because that is where the owning contract is, but it is PURE DATA with no
 * imports — so a plugin UI that mints resource URIs can derive the id instead of re-spelling it. That
 * matters for exactly one shape today: the UI builds `localix://resource/<provider>/…` and the
 * backend's `providerSegments(PROVIDER, uri)` has to accept it, so a rename that moved one and not
 * the other would fail silently, with URIs that no longer resolve.
 */
