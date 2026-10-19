/**
 * INTAKE: the one impure step before the history pipeline, producing the turn as a value.
 *
 * Three things here have effects, and they used to sit INSIDE the history build:
 *
 *   - plugin `onUserMessage` hooks rewrite the model-facing prompt;
 *   - Claude Code `UserPromptSubmit` hooks may BLOCK the prompt or add context;
 *   - background jobs and LSP diagnostics are read at this instant.
 *
 * With them inside the build, the build could not be run twice: a retry that rebuilt the
 * history re-fired the hooks. Here they
 * run once and their results are frozen into a `ChatTurnFrame`; every later stage is pure
 * over that frame, and running it again is free.
 *
 * The one operation kept on the FILTERED copy is the prompt rewrite. Rebuilding from the raw
 * persisted history after a rewrite resurrects the `uiOnly` rows the first step removed —
 * rows that would then reach the model.
 */
import { runUserMessageHooks } from '../../../plugins/hooks'
import type { PersistedMessage } from '../../contracts'
import type { SessionRecord } from '../../repository'
import type { LoadedPlugins } from '../../../plugins/loader'
import type { CcHooksRuntime } from '../../../cc-hooks'
import type { RuntimeSection } from '../../../agent-core/prompt/runtime-sections'
import { consoleWarnLogger } from '../plugin-hook-logger'
import type { RunnerDeps } from '../agent-runner-types'
import { reminderSections } from '../reminders'
import { wrapSystemReminder } from '../system-reminder'
import type { ChatTurnFrame } from './frame'
import { currentSystemContextBindings } from '../../system-notice-bindings'
import { historyAfterBoundary } from '../model-view/view'

export interface IntakeArgs {
  deps: RunnerDeps
  userId: string
  session: SessionRecord
  assistantMessageId: string
  /** Raw, persisted history for this run (last entry = the trigger prompt). */
  historyMessages: PersistedMessage[]
  loadedPlugins: LoadedPlugins
  ccHooks: CcHooksRuntime
  /** SessionStart CC-hook context to inject once (this session's first run). */
  ccSessionStartContext: string | undefined
  /** The keyed runtime sections split off the cacheable system prompt. */
  runtimeSections: readonly RuntimeSection[]
  /** The turn cap this run runs under, so the reminder can tell the agent what it may spend. */
  maxTurns?: number
  defaultCwd: string
  /** The run's assistant row and when it was created — the host of this turn's context. */
  assistantCreatedAt: string
  now: () => string
}

export type IntakeResult =
  | { ok: true; frame: ChatTurnFrame }
  /** A UserPromptSubmit hook denied the prompt — the caller fails the run before any model call. */
  | { ok: false; blockedReason: string; promptMessage: PersistedMessage | undefined }

/** Replace the active prompt on the already model-filtered history copy. */
export function rewriteModelPrompt(
  modelHistory: PersistedMessage[],
  promptMessage: PersistedMessage,
  content: string,
): PersistedMessage[] {
  return [
    ...modelHistory.slice(0, -1),
    { ...promptMessage, payload: { ...promptMessage.payload, content } },
  ]
}

export async function intakeTurn(args: IntakeArgs): Promise<IntakeResult> {
  const { userId, session, loadedPlugins, ccHooks } = args

  // System notices reach the model only through their deduplicated context bindings below.
  // Also exclude legacy model-visible notice rows so upgrading does not duplicate their prose.
  const topicHistory = historyAfterBoundary(args.historyMessages).rows
  const modelHistory = topicHistory.filter((m) => !m.payload.uiOnly && !m.payload.systemNotice)
  const promptMessage = modelHistory[modelHistory.length - 1]
  const isRealUserPrompt =
    promptMessage?.payload.role === 'user' &&
    !promptMessage.payload.isInternal &&
    typeof promptMessage.payload.content === 'string'

  // Plugin onUserMessage hooks rewrite the MODEL-FACING prompt only; the persisted row the
  // user sees is never changed. Real user prompts only — never internal continuations.
  let messages = modelHistory
  if (loadedPlugins.hooks.length > 0 && isRealUserPrompt && promptMessage) {
    const rewritten = await runUserMessageHooks(
      loadedPlugins.hooks,
      { messageId: promptMessage.id, text: promptMessage.payload.content as string },
      { sessionId: session.id, logger: consoleWarnLogger },
    )
    if (rewritten !== promptMessage.payload.content) {
      messages = rewriteModelPrompt(modelHistory, promptMessage, rewritten)
    }
  }

  // Claude Code UserPromptSubmit: may block (exit 2 / decision:"block") or add context.
  let ccPromptContext: string | undefined
  if (ccHooks.active && isRealUserPrompt && promptMessage) {
    const result = await ccHooks.runUserPromptSubmit(promptMessage.payload.content as string)
    if (result.blocked) {
      return { ok: false, blockedReason: result.reason ?? 'blocked', promptMessage }
    }
    ccPromptContext = result.additionalContext
  }

  // SessionStart + UserPromptSubmit context belong to this turn: a system reminder in its context.
  const ccContextBody = [args.ccSessionStartContext, ccPromptContext]
    .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    .join('\n\n')
  const runtimeSections: RuntimeSection[] = [
    ...args.runtimeSections,
    ...reminderSections({ maxTurns: args.maxTurns }),
    ...(ccContextBody
      ? [{ key: 'hook-context', scope: 'turn' as const, text: wrapSystemReminder([ccContextBody]) }]
      : []),
  ]

  return {
    ok: true,
    frame: {
      messages,
      runtimeSections,
      systemBindings: currentSystemContextBindings(topicHistory),
      activeInvocationId: promptMessage?.id,
      assistantMessageId: args.assistantMessageId,
      assistantCreatedAt: args.assistantCreatedAt,
      sessionId: session.id,
      userId,
      promptMessage,
      now: args.now,
    },
  }
}
