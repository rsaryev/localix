import type { ChatUsagePayload } from '@localixai/agent'
import type { AgentItemAppend } from '@localixai/agent/agents'
import type { WorkspaceStreamEvent } from './stream-workspace'
import type {
  PendingHitlInteraction,
  PersistedMessage,
  SessionModelView,
  SessionSummary,
  SessionTiming,
} from './read-model'
import type { SessionLoopSummary, SessionQueueItem, SessionQuestion, SessionWork } from './queue'
import type { SessionPlan } from '../../plans/contracts'
import type { ResumePoint } from '../../resume/contracts'
import type { AttentionItem } from '../../attention/contracts'

export type AgentStreamEvent =
  | { type: 'message.created'; sessionId: string; message: PersistedMessage }
  | { type: 'message.updated'; sessionId: string; message: PersistedMessage }
  // Incremental, LIVE-ONLY append to a streaming assistant message between full
  // `message.updated` snapshots: carries only the suffix appended to the current
  // turn's text and/or reasoning item (located by stable id `text-<turn>` /
  // `reasoning-<turn>`), plus per-item string-suffix growth (`itemAppends`: a
  // command's streamed output, tool args being typed — see
  // @localixai/agent/agents item-appends). Sent only when EVERY change since the
  // last publish is provable suffix growth; anything structural (item added,
  // status moved, same-turn check failed) ships a full snapshot instead. The
  // periodic full snapshot (see event-handlers-flush) resyncs any drift.
  // NON-REPLAYABLE — a late subscriber rebuilds from the DB.
  | {
      type: 'message.delta'
      sessionId: string
      messageId: string
      textItemId?: string
      textAppend?: string
      reasoningItemId?: string
      reasoningAppend?: string
      itemAppends?: AgentItemAppend[]
      /**
       * Suffix appended to the message's plain `content` — used by external-child
       * streams (CLI adapters) whose messages carry cumulative content and often
       * no items at all; the item-targeted fields above can't reach them.
       */
      contentAppend?: string
    }
  | { type: 'message.removed'; sessionId: string; messageId: string }
  | { type: 'session.updated'; session: SessionSummary }
  | {
      type: 'child_session.updated'
      parentSessionId: string
      session: SessionSummary
    }
  | {
      type: 'child_session.activity'
      parentSessionId: string
      sessionId: string
      activity: string
      turnCount?: number
      toolCount?: number
    }
  | { type: 'run.started'; sessionId: string; messageId: string; agentId?: string }
  /**
   * `finishedAt` — when the run actually ended (epoch ms), set by the producer.
   *
   * Both frames are replayable, so a client that was away receives them on reconnect. Without the
   * run's own time the notification layer stamps `Date.now()` (`agentNotificationEnvelope`'s
   * default), the TTL in the notifications policy sees a brand-new envelope, and a run that finished
   * hours ago raises a native banner and a bell as if it had just completed. The client's
   * `session.updatedAt` is NOT a substitute: it dates the SESSION, so a run finishing one second
   * after a reconnect would be judged by a minutes-old value and its real notification suppressed.
   * Optional so an older producer or an already-buffered frame still parses.
   */
  | {
      type: 'run.completed'
      sessionId: string
      messageId: string
      finishedAt?: number
      /**
       * The envelope around a slash-command reply or a settings notice, with no agent run inside
       * it (`service/synthetic-messages.ts`). The frame still settles the optimistic rows; a
       * client must not report it as "Agent run finished", or every `/usage` adds a row.
       */
      synthetic?: true
    }
  | {
      type: 'run.failed'
      sessionId: string
      messageId: string
      error: string
      finishedAt?: number
    }
  // Tool activity is carried inside the assistant message's `items[]` and rides
  // the `message.updated` snapshot — there are no separate tool.* events.
  | {
      type: 'hitl.requested'
      sessionId: string
      messageId: string
      request: PendingHitlInteraction
      toolCallId: string
      toolName: string
      /**
       * When the agent asked (epoch ms), set by the producer — same reason as
       * `terminal.finished.finishedAt`.
       *
       * This frame is replayable, so a client that was away receives it on reconnect. Without the
       * fact's own time the notification layer stamps `Date.now()`, the TTL in the notifications
       * policy sees a brand-new envelope, and a question asked hours ago (possibly already answered)
       * raises a native banner as if it had just been asked. Optional so an older producer or an
       * already-buffered frame still parses.
       */
      requestedAt?: number
    }
  // A pending ask/quiz/confirm was answered or dismissed — clears the session's
  // pendingInteraction so clients drop the overlay immediately (not only on
  // run.completed). `requestId` lets a client ignore a stale clear for a newer prompt.
  // `reason` says how it ended: answered/dismissed by a person, or expired/cancelled when it
  // timed out or its run ended without an answer (`hitl-registry.ts` `onClearedUnanswered`).
  | {
      type: 'hitl.resolved'
      sessionId: string
      requestId: string
      reason?: 'answered' | 'dismissed' | 'deferred' | 'expired' | 'cancelled'
    }
  | {
      /**
       * A MEMBER OF A ROOM ADDRESSED THE PERSON, and the round ended there.
       *
       * Its own frame rather than a fact the client digs out of `message.updated`: an assistant
       * row is patched many times while it streams, so a client deriving this would have to
       * debounce a field that is only final at the end — and the one thing that must not happen
       * is the person being told twice, or not at all. The producer knows exactly when it is
       * true (once, at finalize), so it says so once.
       *
       * Replayable, and for the same reason `hitl.requested` is: the whole point is a person who
       * was not looking. `mentionedAt` is the fact's own time so a replay on reconnect is judged
       * by when the question was asked, not by when the socket came back.
       */
      type: 'user.mentioned'
      sessionId: string
      messageId: string
      /** Who asked, in the spelling frozen on the row — never re-resolved. */
      from: string
      /** The reply's own words, trimmed to a notification's worth. */
      text: string
      mentionedAt: number
    }
  | {
      // Agnostic activity-phase signal for things NOT visible in the assistant
      // message items (background/meta work like titling or a terminal wait).
      // `phase` is a free-form id; `active` toggles enter/leave. Add a new phase by just
      // emitting a new id — no enum to extend. Ephemeral: never persisted, store-only.
      type: 'agent.phase'
      sessionId: string
      phase: string
      /**
       * Copy for the phase, ONLY when the text is data the client cannot derive — a
       * terminal wait naming the command. The run-lifecycle phases (connecting,
       * preparing-context, thinking, generating-title) carry no label:
       * their copy is the client's, keyed by `phase`, so the host emits a code and not a
       * sentence in one language. A client that does not know a code shows the code.
       */
      label?: string
      active: boolean
    }
  | { type: 'session_timing.updated'; sessionId: string; timing: SessionTiming }
  | {
      /** A context checkpoint moved where the model's working view begins (last-wins). */
      type: 'session_model_view.updated'
      sessionId: string
      modelView: SessionModelView | null
    }
  | {
      /** Backend-authoritative all-history usage after auxiliary billing settles. */
      type: 'session_usage.updated'
      sessionId: string
      usage: ChatUsagePayload | null
    }
  | {
      /**
       * The session's user-facing triggers changed — a loop was created, cancelled, or its
       * nextRunAt advanced after a fire. Named after the trigger engine that publishes it, not
       * one action on top of it; the payload carries the loop summaries the composer renders.
       */
      type: 'session_triggers.updated'
      sessionId: string
      loops: SessionLoopSummary[]
    }
  | {
      /**
       * The session's running background work changed — a job, stream, promoted call or
       * monitor started, ended, or (a monitor) saw something. The FULL list, last-wins, like the other panel snapshots.
       * It replaces a composer strip that polled the terminal list every few seconds to find
       * out the same thing, and saw only the work that happened to run in a PTY.
       */
      type: 'session_work.updated'
      sessionId: string
      work: SessionWork[]
    }
  | {
      /**
       * The session's open queued questions changed — the agent asked one (`ask` with
       * `wait: false`), or one was answered, skipped or replaced. The FULL list, last-wins, like
       * the work snapshot beside it.
       */
      type: 'session_questions.updated'
      sessionId: string
      questions: SessionQuestion[]
    }
  | {
      /**
       * The conversation's plan changed — the agent presented a version, or the person approved,
       * reviewed or dismissed one (`features/plans`). EVERY version, newest first, last-wins: the
       * versions view compares them, so a frame with only the changed one could not be rendered.
       * Published on the ROOT session the plans belong to.
       */
      type: 'plan.updated'
      sessionId: string
      plans: SessionPlan[]
    }
  | {
      /** The ROOT's unfinished work changed (`features/resume`): EVERY point, last-wins. */
      type: 'session_resume.updated'
      sessionId: string
      points: ResumePoint[]
    }
  | {
      /**
       * A version was presented or brought back to review JUST NOW — the cue a client opens the
       * plan tab on. An event, not state: the versions are `plan.updated` and the session
       * detail; this says only that the moment happened, so it is live-only and a reload or a
       * reconnect never re-opens a tab the person closed. Published on the ROOT session.
       */
      type: 'plan.presented'
      sessionId: string
      planId: string
      version: number
    }
  | {
      /**
       * Everything waiting on the person, across ALL their sessions (`features/attention`): the
       * user's whole open set, last-wins, so a client that missed one frame is corrected by the
       * next. User-wide — published with an empty `sessionId`, like `resources.changed`.
       */
      type: 'attention.updated'
      sessionId: string
      items: AttentionItem[]
    }
  | {
      /**
       * A hook returned a non-blocking, user-facing warning (never sent to the model).
       * Surfaced as an inline system notice in the transcript. Ephemeral (live-only):
       * not persisted, not replayed on reload.
       *
       * Two producers: a Claude Code hook's `systemMessage`, and a native plugin hook
       * calling `ctx.reportProblem` — the plugin channel reuses this frame rather than
       * inventing a second one, because "a hook wants to tell the person something" is
       * one fact with one rendering.
       */
      type: 'hook.notice'
      sessionId: string
      /** The warning text to show the user — ONE sentence, never raw engine output. */
      message: string
      /** What produced it: a hook event (`PreToolUse`), or `<plugin> · <where>`. */
      hookEvent: string
      /**
       * The raw text behind {@link message}, when the producer had one. Kept off the
       * line itself and shown only where there is room for it.
       */
      detail?: string
      /**
       * Set only by the plugin producer: WHICH plugin, and which part of it. A Claude Code
       * hook's notice is a remark about one turn; a plugin's problem is a standing condition a
       * person has to fix (a mistyped webhook URL rejects every delivery), so the client also
       * records it in the Event Center under the plugin's name. `hookEvent` is display text
       * and cannot be parsed back into this, which is why it is a field of its own.
       */
      plugin?: { name: string; source?: string }
    }
  | {
      /** Queued-message list changed (enqueued behind a run, removed, or drained). */
      type: 'session_queue.updated'
      sessionId: string
      queue: SessionQueueItem[]
    }
  | {
      /**
       * The session's "Always allow" set changed — a tool was auto-approved for the
       * whole session (granted on a permission confirm) or a grant was revoked. Keyed
       * on the session the confirm surfaced on (the parent, for sub-agent requests).
       * In-memory + session-scoped (see RuntimeState.sessionAutoApprovedTools); the
       * detail load re-hydrates the current set so the composer chip survives a reload.
       */
      type: 'session_permissions.updated'
      sessionId: string
      autoApprovedTools: string[]
    }
  // Everything about the MACHINE rather than the conversation — language servers, the preview,
  // the terminals, the files on disk, the installed capabilities. Same socket, same opcode set,
  // its own file because it is a separate question (`stream-workspace.ts`).
  | WorkspaceStreamEvent
