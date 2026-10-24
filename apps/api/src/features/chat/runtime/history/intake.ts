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
import { runUserMessageHooks } from '../../../mini-apps/hooks'
import type { PersistedMessage } from '../../contracts'
import type { SessionRecord } from '../../repository'
import type { LoadedPlugins } from '../../../plugins/loader'
import type { CcHooksRuntime, CcPromptExpansion } from '../../../cc-hooks'
import type { MessageInvocationBinding } from '../../contracts/message-bindings-input'
import type { ModRunScope } from '../../../mods/run-scope'
import type { RuntimeSection } from '../../../agent-core/prompt/runtime-sections'
import { consoleWarnLogger } from '../plugin-hook-logger'
import { applyHookSessionTitle } from '../hook-session-title'
import { publishMessageSnapshot } from '../message-persistence'
import type { RunnerDeps } from '../agent-runner-types'
import { reminderSections } from '../reminders'
import { wrapSystemReminder } from '../system-reminder'
import type { ChatTurnFrame } from './frame'
import { currentSystemContextBindings } from '../../system-notice-bindings'
import { historyAfterBoundary } from '../model-view/view'
import type { LoadedMiniApps } from '../../../mini-apps/loader-contract'

export interface IntakeArgs {
  deps: RunnerDeps
  userId: string
  session: SessionRecord
  assistantMessageId: string
  /** Raw, persisted history for this run (last entry = the trigger prompt). */
  historyMessages: PersistedMessage[]
  loadedPlugins: LoadedPlugins
  loadedMiniApps: LoadedMiniApps
  ccHooks: CcHooksRuntime
  /** Claude Code mods: `prompt.submit` and `turn.start` for this run's prompt. */
  mods?: ModRunScope
  /** SessionStart CC-hook context to inject once (this session's first run). */
  ccSessionStartContext: string | undefined
  /**
   * A SessionStart hook's `initialUserMessage`, in a run nobody types into: the session's first
   * user message, the run's own prompt following it.
   */
  ccInitialUserMessage?: string
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

/**
 * A blocked prompt never reaches the model, on this turn or a later one (hooks.md: "A blocked
 * prompt never reaches Claude"): its row stays in the transcript for the person, as their message,
 * but is marked `promptBlocked`, which every later intake filters out of the model's history.
 *
 * Not `uiOnly`: that turns the row into a divider and drops it for good, so a Retry of the blocked
 * turn would answer the previous reply. A Retry submits the prompt again ({@link intakeTurn}), and
 * when the hooks now accept it the mark is lifted (`blocked: false`) and the prompt joins history.
 */
export async function markPromptBlocked(
  deps: Pick<RunnerDeps, 'repo' | 'streamRegistry'>,
  userId: string,
  promptMessage: PersistedMessage,
  blocked: boolean,
  updatedAt: string,
): Promise<void> {
  if (Boolean(promptMessage.payload.promptBlocked) === blocked) return
  const { sessionId, id } = promptMessage
  const patch = { promptBlocked: blocked ? (true as const) : undefined }
  const written = await deps.repo.updateMessage(userId, sessionId, id, patch, updatedAt)
  if (!written) return
  publishMessageSnapshot({
    streamRegistry: deps.streamRegistry,
    userId,
    sessionId,
    messageId: id,
    payload: written.payload,
    createdAt: promptMessage.createdAt,
    updatedAt,
  })
}

/** A SessionStart `initialUserMessage` as the user turn before the run's prompt (model-facing). */
function withInitialUserMessage(history: PersistedMessage[], text: string): PersistedMessage[] {
  const prompt = history[history.length - 1]
  if (!prompt) return history
  const first: PersistedMessage = {
    ...prompt,
    id: `${prompt.id}:initial-user-message`,
    payload: {
      ...prompt.payload,
      id: `${prompt.id}:initial-user-message`,
      content: text,
      bindings: [],
    },
  }
  return [...history.slice(0, -1), first, prompt]
}

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

/**
 * The typed command a prompt row carries, as Claude Code's UserPromptExpansion names it: a skill
 * or plugin command the person invoked by `/name args` (its row keeps the line as typed, the
 * expansion rides an invocation binding). System-made invocations are no typed command.
 */
function typedCommandExpansion(message: PersistedMessage): CcPromptExpansion | undefined {
  const binding = message.payload.bindings?.find(
    (b): b is MessageInvocationBinding => b.kind === 'invocation' && b.source !== 'system',
  )
  if (!binding) return undefined
  const { kind, name, arguments: args } = binding.invocation
  return {
    commandName: name,
    commandArgs: args ?? '',
    commandSource: binding.source === 'plugin' || kind === 'plugin-command' ? 'plugin' : kind,
    prompt: typeof message.payload.content === 'string' ? message.payload.content : `/${name}`,
  }
}

export async function intakeTurn(args: IntakeArgs): Promise<IntakeResult> {
  const { userId, session, loadedMiniApps, ccHooks } = args

  // System notices reach the model only through their deduplicated context bindings below.
  // Also exclude legacy model-visible notice rows so upgrading does not duplicate their prose.
  const topicHistory = historyAfterBoundary(args.historyMessages).rows
  const visible = topicHistory.filter((m) => !m.payload.uiOnly && !m.payload.systemNotice)
  // A prompt a hook blocked stays out of the model's history, unless it is this run's trigger: a
  // Retry of the blocked turn submits it again, and the hooks below decide again.
  const trigger = visible[visible.length - 1]
  const modelHistory = visible.filter((m) => !m.payload.promptBlocked || m === trigger)
  const promptMessage = modelHistory[modelHistory.length - 1]
  const isRealUserPrompt =
    promptMessage?.payload.role === 'user' &&
    !promptMessage.payload.isInternal &&
    typeof promptMessage.payload.content === 'string'

  // Mini app onUserMessage hooks rewrite the MODEL-FACING prompt only; the persisted row the
  // user sees is never changed. Real user prompts only — never internal continuations.
  let messages = args.ccInitialUserMessage
    ? withInitialUserMessage(modelHistory, args.ccInitialUserMessage)
    : modelHistory
  if (loadedMiniApps.hooks.length > 0 && isRealUserPrompt && promptMessage) {
    const rewritten = await runUserMessageHooks(
      loadedMiniApps.hooks,
      { messageId: promptMessage.id, text: promptMessage.payload.content as string },
      { sessionId: session.id, logger: consoleWarnLogger },
    )
    if (rewritten !== promptMessage.payload.content) {
      messages = rewriteModelPrompt(modelHistory, promptMessage, rewritten)
    }
  }

  // Claude Code mods: `prompt.submit` may drop the prompt, rewrite what the model reads, or add
  // notes for it; the settings hooks below run beneath it, as in Claude Code.
  let modContext: readonly string[] = []
  if (args.mods?.active && isRealUserPrompt && promptMessage) {
    const current = messages[messages.length - 1]?.payload.content as string
    const submitted = await args.mods.submit(current, promptMessage.id)
    if (submitted.dropped) return { ok: false, blockedReason: submitted.reason, promptMessage }
    if (submitted.text !== current)
      messages = rewriteModelPrompt(modelHistory, promptMessage, submitted.text)
    modContext = submitted.context
    await args.mods.turnStart(submitted.text, promptMessage.id)
  }

  // Claude Code UserPromptSubmit: may block (exit 2 / decision:"block") or add context.
  let ccPromptContext: string | undefined
  if (ccHooks.active && isRealUserPrompt && promptMessage) {
    const result = await ccHooks.runUserPromptSubmit(promptMessage.payload.content as string)
    await applyHookSessionTitle(args.deps, args.userId, args.session.id, result.sessionTitle)
    if (result.blocked) {
      return { ok: false, blockedReason: result.reason ?? 'blocked', promptMessage }
    }
    ccPromptContext = result.additionalContext
    // A typed command expands after the prompt is accepted, as in Claude Code: its hooks may
    // still block the expansion or add context beside it.
    const expansion = typedCommandExpansion(promptMessage)
    if (expansion) {
      const expanded = await ccHooks.runUserPromptExpansion(expansion)
      if (expanded.blocked) {
        return { ok: false, blockedReason: expanded.reason ?? 'blocked', promptMessage }
      }
      ccPromptContext = [ccPromptContext, expanded.additionalContext].filter(Boolean).join('\n\n')
    }
  }

  // SessionStart + UserPromptSubmit context belong to this turn: a system reminder in its context.
  const ccContextBody = [args.ccSessionStartContext, ccPromptContext, ...modContext]
    .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    .join('\n\n')
  const sections: RuntimeSection[] = [
    ...args.runtimeSections,
    ...reminderSections({ maxTurns: args.maxTurns }),
    ...(ccContextBody
      ? [{ key: 'hook-context', scope: 'turn' as const, text: wrapSystemReminder([ccContextBody]) }]
      : []),
  ]
  // Claude Code mods: the standing sections are `prompt.context` blocks, this turn's own are the
  // attachments the engine injects (`prompt.attachment`).
  const runtimeSections = args.mods ? await args.mods.runtimeContext(sections) : sections

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
