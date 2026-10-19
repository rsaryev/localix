/**
 * The chat turn as a VALUE: everything the pure pipeline needs, gathered before it runs.
 *
 * `TurnFrame` in the SDK names the generic shape. This is the chat host's instance of it, with
 * what a chat turn adds: the runtime sections and system bindings its context is composed from,
 * and the trigger message the finalizer inspects afterwards.
 *
 * Nothing here has a side effect left in it. The plugin rewrite, the Claude Code hook that
 * may block the prompt and the job/LSP snapshots all happened in `intake.ts`, which is what
 * lets a retry or a continuation materialize AGAIN from the same frame without re-firing a hook
 * or draining a buffer twice.
 */
import type { TurnFrame } from '@localixai/agent/history'
import type { MessageContextBinding } from '@localixai/agent'

import type { RuntimeSection } from '../../../agent-core/prompt/runtime-sections'
import type { PersistedMessage } from '../../contracts'

export interface ChatTurnFrame extends TurnFrame<PersistedMessage> {
  /** Every runtime section of this turn: environment, reminders, hook context, hints. */
  runtimeSections: RuntimeSection[]
  /** The system-event facts true now; the turn's context carries the ones not yet sent. */
  systemBindings: MessageContextBinding[]
  /** The run's assistant row, which hosts this turn's context and any checkpoint it takes. */
  assistantMessageId: string
  /** When that row was created — the timestamp its context row is shown with, every turn. */
  assistantCreatedAt: string
  sessionId: string
  userId: string
  /** The trigger prompt (last model-facing row), carried out for the finalizer. */
  promptMessage: PersistedMessage | undefined
  now: () => string
}
