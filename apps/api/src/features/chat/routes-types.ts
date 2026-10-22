import type { z } from 'zod'

import type {
  JoinRoutesView,
  DirListing,
  FileSearchResult,
  FileContentResponse,
  FileWriteResponse,
  MessageMutationResponse,
  MessageBinding,
  MessageToolDetails,
  RollbackResponse,
  SessionDetail,
  SessionSummary,
  SessionBranchTree,
  FileEntryResponse,
  FileDeleteResponse,
  FileUndoResponse,
  FileContentSearchResult,
  AgentStreamEvent,
  QueueClearResult,
  QueuePromoteResult,
  QueueRemovalResult,
} from './contracts'
import type { ToolSurface } from '@localixai/agent/agents'
import type { SubagentRowsView } from './service/subagent-rows'
import type {
  createSessionRequestSchema,
  importSessionRequestSchema,
  updateSessionRequestSchema,
  WakeSource,
} from './contracts'
import type { SkillRecord, SkillInput } from './service'
import type { UsageOverviewOpts, UsageLogsOpts } from './service/usage'
import type { UsageOverview, UsageLogsPage, UsageKeys } from '../usage/repository'
import type { HistorySearchHit } from './repository-types'
import type {
  FindFilesOptions,
  ContentSearchOptions,
  ReplaceContentResult,
} from './service/file-ops'
import type { PreviewResultPayload } from './runtime/preview-command-registry'
import type { PluginCommandResultPayload } from './runtime/plugin-command-registry'

// The service contract the chat HTTP routes depend on. Extracted from routes.ts
// so that file holds the Hono route wiring and this one the (large) interface.

export interface ChatRoutesService {
  listSessions(userId: string): Promise<{ sessions: SessionSummary[] }>
  searchHistory(userId: string, query: string, limit?: number): Promise<HistorySearchHit[]>
  getSkill(userId: string, name: string, opts?: { projectId?: string | null }): Promise<SkillRecord>
  listSkills(
    userId: string,
    opts?: { projectId?: string | null },
  ): Promise<{ skills: SkillRecord[] }>
  createSkill(userId: string, input: SkillInput): Promise<SkillRecord>
  deleteSkill(userId: string, id: string, projectId?: string | null): Promise<void>
  setSessionSkills(userId: string, sessionId: string, names: string[]): Promise<SessionDetail>
  createSession(
    userId: string,
    input: z.infer<typeof createSessionRequestSchema>,
  ): Promise<SessionDetail>
  /** Import an outside conversation as a real session; the body is our own message model. */
  importSession(
    userId: string,
    input: z.infer<typeof importSessionRequestSchema>,
  ): Promise<SessionDetail>
  getSession(
    userId: string,
    id: string,
    opts?: { messageLimit?: number; deferToolDetails?: boolean },
  ): Promise<SessionDetail>
  getJoinRoutes(userId: string, id: string): Promise<JoinRoutesView>
  getSubagentRows(userId: string, id: string): Promise<SubagentRowsView>
  getMessageToolDetails(
    userId: string,
    sessionId: string,
    messageId: string,
  ): Promise<MessageToolDetails>
  resolveSessionCwd(userId: string, sessionId: string): Promise<string>
  readFile(
    userId: string,
    sessionId: string,
    path: string,
    opts?: { full?: boolean; knownHash?: string; signal?: AbortSignal },
  ): Promise<FileContentResponse>
  writeFile(
    userId: string,
    sessionId: string,
    path: string,
    content: string,
    baseHash: string,
  ): Promise<FileWriteResponse>
  listDirectory(userId: string, sessionId: string, path?: string): Promise<DirListing>
  createFileEntry(
    userId: string,
    sessionId: string,
    parentPath: string,
    name: string,
    kind: 'file' | 'dir',
  ): Promise<FileEntryResponse>
  renameFileEntry(
    userId: string,
    sessionId: string,
    targetPath: string,
    newName: string,
  ): Promise<FileEntryResponse>
  pasteFileEntry(
    userId: string,
    sessionId: string,
    source: string,
    destDir: string,
    mode: 'move' | 'copy',
  ): Promise<FileEntryResponse>
  deleteFileEntry(
    userId: string,
    sessionId: string,
    targetPath: string,
    opts?: { permanent?: boolean },
  ): Promise<FileDeleteResponse>
  duplicateFileEntry(
    userId: string,
    sessionId: string,
    targetPath: string,
  ): Promise<FileEntryResponse>
  undoFileOp(userId: string, sessionId: string): Promise<FileUndoResponse>
  revealFileEntry(userId: string, sessionId: string, targetPath: string): Promise<{ opened: true }>
  findFiles(
    userId: string,
    sessionId: string,
    query: string,
    opts?: FindFilesOptions,
  ): Promise<FileSearchResult>
  searchContent(
    userId: string,
    sessionId: string,
    query: string,
    opts?: ContentSearchOptions,
  ): Promise<FileContentSearchResult>
  replaceContent(
    userId: string,
    sessionId: string,
    query: string,
    replacement: string,
    opts?: ContentSearchOptions,
  ): Promise<ReplaceContentResult>
  updateSession(
    userId: string,
    id: string,
    input: z.infer<typeof updateSessionRequestSchema>,
  ): Promise<SessionDetail>
  deleteSession(userId: string, id: string): Promise<void>
  sendMessage(
    userId: string,
    id: string,
    prompt: string,
    bindings?: MessageBinding[],
    /** Provenance of a non-frontend send (e.g. an inbound webhook). */
    origin?: WakeSource,
    /** Client-requested transcript hiding — a machine-composed prompt (analysis wizard). */
    isInternal?: boolean,
    /** Runtime/client capabilities used to assemble the available tool surface. */
    toolSurface?: ToolSurface,
    /** Originating optimistic UI row for exact busy-queue reconciliation. */
    clientMessageId?: string,
  ): Promise<MessageMutationResponse>
  regenerate(
    userId: string,
    id: string,
    toolSurface?: ToolSurface,
    /** Refuse (409) unless this is still the latest reply — see `regenerateRequestSchema`. */
    expectedMessageId?: string,
  ): Promise<MessageMutationResponse>
  editMessage(
    userId: string,
    sessionId: string,
    messageId: string,
    content: string,
    toolSurface?: ToolSurface,
  ): Promise<MessageMutationResponse>
  rollback(userId: string, sessionId: string, messageId: string): Promise<RollbackResponse>
  /** Toggle the person's own mark on a message. */
  reactToMessage(
    userId: string,
    sessionId: string,
    messageId: string,
    emoji: string,
  ): Promise<{ ok: true; reacted: boolean }>
  /** Keep a message in the model's view (or stop keeping it). */
  pinMessage(
    userId: string,
    sessionId: string,
    messageId: string,
    pinned: boolean,
  ): Promise<{ ok: true; pinned: boolean }>
  /** Tick or clear one box of a reply's checklist. */
  checkMessageTask(
    userId: string,
    sessionId: string,
    messageId: string,
    key: string,
    checked: boolean,
  ): Promise<{ ok: true; checked: boolean }>
  switchBranch(
    userId: string,
    sessionId: string,
    messageId: string,
    branchIndex: number,
  ): Promise<SessionDetail>
  getBranchTree(userId: string, sessionId: string): Promise<SessionBranchTree>
  checkoutBranch(userId: string, sessionId: string, messageId: string): Promise<SessionDetail>
  forkSession(userId: string, sessionId: string, fromMessageId?: string): Promise<SessionDetail>
  openMessageThread(userId: string, sessionId: string, messageId: string): Promise<SessionDetail>
  stop(sessionId: string, callerUserId?: string): Promise<boolean>
  /** Stop one of the session's monitors. False when it is not the caller's or already ended. */
  stopSessionMonitor(userId: string, sessionId: string, monitorId: string): boolean
  /** Unified tool interaction: kill, hitl respond/dismiss, or any custom action. */
  interact(
    toolCallId: string,
    action: string,
    payload?: unknown,
    callerUserId?: string,
  ): { ok: boolean; error?: string }
  /**
   * The `request_secret` answer leg: vault the typed value, resume the paused tool
   * with only `{ stored }`. Deliberately separate from `interact` so the value
   * never rides the shared respond path.
   */
  submitSecret(
    requestId: string,
    value: string,
    callerUserId?: string,
  ): Promise<{ ok: boolean; error?: string }>
  /** Revoke a session's "Always allow" grant (one tool, or all). Ownership-gated. */
  revokeSessionPermission(
    userId: string,
    sessionId: string,
    toolName?: string,
  ): Promise<string[] | null>
  /** Settle a pending `browser` tool command from the host UI's reply. */
  resolvePreviewCommand(
    commandId: string,
    payload: PreviewResultPayload,
    callerUserId?: string,
  ): { ok: boolean }
  /** Settle a pending awaited plugin command (`emitCommandWithReply`) from the client's reply. */
  resolvePluginCommand(
    commandId: string,
    payload: PluginCommandResultPayload,
    callerUserId?: string,
  ): { ok: boolean }
  usageOverview(userId: string, opts: UsageOverviewOpts): Promise<UsageOverview>
  usageLogs(userId: string, opts: UsageLogsOpts): Promise<UsageLogsPage>
  /** Distinct model/provider/session keys in the ledger, to populate dashboard filters. */
  usageKeys(userId: string): Promise<UsageKeys>
  /** Cancel a session loop by id. Returns true if found and removed. */
  cancelSessionLoop(userId: string, loopId: string): Promise<boolean>
  /** Fire a session loop immediately (extra occurrence). Returns true if it existed and fired. */
  runSessionLoop(userId: string, loopId: string): Promise<boolean>
  /** Remove one queued message, or report that steering already leased it. */
  removeQueuedMessage(
    userId: string,
    sessionId: string,
    itemId: string,
    options?: { wholeBatch?: boolean },
  ): Promise<QueueRemovalResult>
  /** Atomically interrupt the active run and deliver one selected queued item. */
  interruptAndPromoteQueuedMessage(
    userId: string,
    sessionId: string,
    itemId: string,
  ): Promise<QueuePromoteResult>
  clearQueuedMessages(userId: string, sessionId: string): Promise<QueueClearResult>
  /** Whether an agent run is currently in flight for this session. */
  isRunning(sessionId: string): boolean
  // Exposed for the realtime WebSocket (app.ts wires it into /rpc/ws). The
  // per-session `subscribe` and the unscoped `subscribeAll` still exist on the concrete registry
  // (used by tests) but the HTTP surface only needs the SCOPED multiplexed firehose — a browser
  // must never get the unscoped one.
  streamRegistry: {
    subscribeScoped(
      userId: string,
      listener: (payload: {
        id: string
        sessionId: string
        event: AgentStreamEvent
        data: string
      }) => void,
      opts: {
        since?: string | null
        watching: ReadonlySet<string>
        onGap?: (droppedThrough: string) => void
      },
    ): () => void
  }
}
