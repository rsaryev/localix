// ---------------------------------------------------------------------------
// Channels — long-running external conversation bridges.
// ---------------------------------------------------------------------------
//
// Pure type contracts for the channel subsystem. The host runtime that consumes
// them (channel lifecycle, session binding) lives in the host (`apps/api`).

import type { MessageAttachment, ReasoningEffort } from '@localixai/agent'
import type { MiniAppContext } from './context'

/**
 * Live progress for an in-flight inbound turn, delivered to the channel's
 * `onEvent` callback so it can mirror the workspace UI (streaming drafts,
 * "running tool X…" status lines). Mapped host-side from the session's SSE
 * stream — channels never see raw AgentStreamEvents.
 */
export type ChannelRunEvent =
  | {
      type: 'progress'
      /** The assistant's text so far (cumulative snapshot, not a delta). */
      text: string
      /** Human label of the currently running tool, if any (e.g. "bash"). */
      activity?: string
    }
  | { type: 'status'; status: 'running' | 'completed' | 'failed' }
  | {
      /**
       * The agent is waiting on a human: a permission approval (`kind:
       * 'confirm'`), a clarification (`kind: 'ask'`), or a quiz (`kind: 'quiz'`).
       * The run BLOCKS until the channel (or the workspace UI) answers via
       * `workspace.respondHitl` / `dismissHitl` — both surfaces race, first
       * response wins.
       */
      type: 'hitl'
      requestId: string
      kind: string
      title?: string
      toolName: string
      payload: unknown
    }

/** An incoming message a channel hands to the host. */
export interface ChannelInboundMessage {
  /**
   * Stable conversation key within this channel (e.g. a platform chat id). The
   * host maps each (plugin, channel, conversationId) to ONE persistent chat
   * session, so follow-up messages continue the same conversation.
   */
  conversationId: string
  /** The user's message text — becomes the prompt for an agent turn. */
  text: string
  /** Title hint used when the conversation's session is first created. */
  title?: string
  /**
   * Route into THIS chat session instead of the conversation-keyed one — set by
   * channels that let the user switch sessions (the channel owns the
   * conversation→session binding, persisted under `ctx.stateDir`).
   *
   * A named session is binding: when it is deleted, foreign or not a chat, `inbound`
   * REJECTS (`channel_session_not_found` / `channel_session_not_chat`) rather than
   * running the turn somewhere else. Clear the stored binding and tell the user;
   * omit this field to use the conversation-keyed session.
   */
  sessionId?: string
  /** Project for the session when it is first created; omitted lands it in the default one. */
  projectId?: string
  /**
   * Files the user sent alongside the message on the platform (a platform photo
   * caption, a voice note, a PDF, …). The host attaches them to the user message
   * exactly like composer uploads. The channel is responsible for downloading the
   * bytes and classifying the kind — the host stays platform-agnostic. Keep total
   * size modest; large blobs inflate the context.
   */
  bindings?: MessageAttachment[]
  /** Live progress for this turn (throttle on the channel side before re-sending). */
  onEvent?: (event: ChannelRunEvent) => void
}

/** What the host returns for an inbound message: the agent's final reply. */
export interface ChannelInboundResult {
  sessionId: string
  /** Final assistant text for the turn — send this back to the platform. */
  reply: string
  /**
   * Deliverables attached to the final assistant message (e.g. by the
   * an assistant-message hook) — upload these platform-natively: images as photos,
   * audio as voice messages, files as documents.
   */
  bindings?: MessageAttachment[]
  /**
   * This turn's token/cost usage (from the final assistant message). A channel
   * can surface a compact per-message footer. Absent when no usage was recorded.
   */
  usage?: {
    inputTokens?: number
    outputTokens?: number
    cachedInputTokens?: number
    cacheWriteTokens?: number
    totalCost?: number
  }
}

/** Compact session view for channel-side pickers. */
export interface ChannelSessionSummary {
  id: string
  title: string
  /** Never null — every session belongs to a project. */
  projectId: string
  runtimeStatus: 'idle' | 'running' | 'completed' | 'failed' | 'stopped'
  modelId: string
  reasoningEffort: ReasoningEffort
  updatedAt: string
}

/** A model the user can actually run (an enabled provider connection + model id). */
export interface ChannelModelOption {
  connectionId: string
  providerId: string
  modelId: string
}

/**
 * Workspace management surface for channels — the same operations the UI's
 * sidebar offers (list/create/switch/stop sessions, pick projects and models),
 * so a platform bridge can offer near-parity chat management. Implemented by the
 * host over its chat/projects/provider services; sessions are scoped to regular
 * `chat` sessions of the host user.
 */
export interface ChannelWorkspaceApi {
  listProjects(): Promise<Array<{ id: string; name: string }>>
  listSessions(opts?: {
    projectId?: string | null
    limit?: number
  }): Promise<ChannelSessionSummary[]>
  getSession(sessionId: string): Promise<ChannelSessionSummary | null>
  createSession(input: {
    title?: string
    projectId?: string | null
  }): Promise<ChannelSessionSummary>
  /** Stop the session's running agent turn. Resolves false when nothing was running. */
  stopSession(sessionId: string): Promise<boolean>
  /** Models runnable right now, one entry per (connection, model). */
  listModels(): Promise<ChannelModelOption[]>
  /** Switch the session's model (and optionally connection / reasoning effort). */
  setSessionModel(
    sessionId: string,
    input: {
      connectionId?: string
      modelId: string
      reasoningEffort?: ReasoningEffort
    },
  ): Promise<void>
  setSessionReasoning(sessionId: string, effort: ReasoningEffort): Promise<void>
  /** Human-readable per-session usage summary (tokens, cache %, cost), Markdown. */
  getSessionUsage(sessionId: string): Promise<string>
  /**
   * Answer a pending human-in-the-loop request surfaced via the `hitl` run
   * event. `ok: false` means the request is no longer active (answered in the
   * workspace UI, expired, or the run was stopped) — tell the user, don't retry.
   */
  respondHitl(requestId: string, answers: unknown): Promise<{ ok: boolean; error?: string }>
  /** Decline/cancel a pending HITL request (the agent sees a dismissal). */
  dismissHitl(requestId: string): Promise<{ ok: boolean; error?: string }>
}

/** Context handed to a channel's `start()` — the plugin context plus the host bridge. */
export interface ChannelContext extends MiniAppContext {
  /**
   * Deliver an incoming platform message to the agent. Resolves when the agent
   * turn COMPLETES, with the final reply text. Conversations are persistent:
   * the same conversationId always lands in the same session (unless the
   * message pins an explicit `sessionId`).
   */
  inbound: (message: ChannelInboundMessage) => Promise<ChannelInboundResult>
  /** Session/project/model management — see ChannelWorkspaceApi. */
  workspace: ChannelWorkspaceApi
  /** Aborted when the host stops the channel (plugin disabled, config changed, shutdown). */
  signal: AbortSignal
}

/**
 * A long-running inbound/outbound bridge to an external messaging platform,
 * returned from a native module's `register(ctx)` as `channels: [...]`. The host
 * owns the lifecycle: `start(ctx)` is called once when the plugin is enabled at
 * boot (or becomes enabled); it should run its receive loop (e.g. long polling)
 * until `ctx.signal` aborts. `stop()` is optional extra cleanup beyond the
 * signal. Channels are restarted on plugin config changes.
 */
export interface MiniAppChannel {
  /** Channel name, unique within the plugin. */
  name: string
  start: (ctx: ChannelContext) => void | Promise<void>
  stop?: () => void | Promise<void>
}
