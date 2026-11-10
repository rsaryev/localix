import type { HookOutcome } from '@rsaryev/llx-plugin'
import type { CcHooksRuntime, StopResult } from '../../../cc-hooks/runtime-contracts'
import { createLifecycleEvents } from './lifecycle-events'
import { joinContext } from '../../../cc-hooks/runtime-results'
import { claudeText, type EventDeps, type HookEvent } from './runtime'

type SessionEvents = Pick<
  CcHooksRuntime,
  | 'runSessionStart'
  | 'runUserPromptSubmit'
  | 'runUserPromptExpansion'
  | 'runStop'
  | 'runSubagentStop'
  | 'runSessionEnd'
  | 'runNotification'
  | 'runSubagentStart'
  | 'runPreCompact'
>

/** A block, else what a hook tells Claude, keeps the turn going (Stop and SubagentStop). */
function stopVerdict(outcome: HookOutcome<'Stop' | 'SubagentStop'> | undefined): StopResult {
  if (!outcome) return { blocked: false }
  if (outcome.block) return { blocked: true, reason: outcome.block.reason }
  const context = joinContext(outcome.additionalContext)
  return context ? { blocked: true, reason: context, feedback: true } : { blocked: false }
}

/** A refused prompt or command: the reason, and whether the prompt itself is kept. */
function refusal(outcome: HookOutcome<HookEvent>, fallback: string) {
  return {
    blocked: true as const,
    reason: outcome.block?.reason || outcome.stopReason?.trim() || fallback,
    ...(outcome.effects.suppressOriginalPrompt ? { suppressOriginalPrompt: true as const } : {}),
  }
}

/** The session and prompt events, and the stop events that may keep a turn going. */
export function createSessionEvents(
  deps: EventDeps,
): SessionEvents & ReturnType<typeof createLifecycleEvents> {
  const { fire, options } = deps
  const work = () => options.backgroundWork?.() ?? { background_tasks: [], session_crons: [] }
  return {
    ...createLifecycleEvents(deps),

    async runSessionStart(source = 'startup') {
      const outcome = await fire('SessionStart', {
        source: source as never,
        ...(options.model ? { model: options.model } : {}),
      })
      if (!outcome) return {}
      const { effects } = outcome
      const additionalContext = joinContext(outcome.additionalContext)
      // A session cleared or compacted keeps its name.
      const titled = source !== 'clear' && source !== 'compact' && effects.sessionTitle
      return {
        ...(additionalContext ? { additionalContext } : {}),
        ...(effects.watchPaths ? { watchPaths: [...effects.watchPaths] } : {}),
        ...(titled ? { sessionTitle: titled } : {}),
        ...(effects.initialUserMessage ? { initialUserMessage: effects.initialUserMessage } : {}),
        ...(effects.reloadSkills ? { reloadSkills: true } : {}),
      }
    },

    async runUserPromptSubmit(prompt) {
      const outcome = await fire('UserPromptSubmit', { prompt })
      if (!outcome) return { blocked: false }
      const sessionTitle = outcome.effects.sessionTitle
      const titled = sessionTitle ? { sessionTitle } : {}
      if (!outcome.proceed || !outcome.continue)
        return { ...refusal(outcome, 'Prompt blocked by hook'), ...titled }
      const additionalContext = joinContext(outcome.additionalContext)
      return { blocked: false, ...(additionalContext ? { additionalContext } : {}), ...titled }
    },

    async runUserPromptExpansion(expansion) {
      const outcome = await fire('UserPromptExpansion', {
        expansion_type: 'slash_command',
        command_name: expansion.commandName,
        command_args: expansion.commandArgs,
        command_source: expansion.commandSource,
        prompt: expansion.prompt,
      } as never)
      if (!outcome) return { blocked: false }
      if (!outcome.proceed || !outcome.continue) return refusal(outcome, 'Command blocked by hook')
      const additionalContext = claudeText(outcome)
      return { blocked: false, ...(additionalContext ? { additionalContext } : {}) }
    },

    async runStop(given = {}) {
      return stopVerdict(
        await fire('Stop', {
          stop_hook_active: given.stopHookActive ?? false,
          ...(given.lastAssistantMessage
            ? { last_assistant_message: given.lastAssistantMessage }
            : {}),
          ...work(),
        } as never),
      )
    },

    async runSubagentStop(agentType, agentId, lastMessage, more = {}) {
      return stopVerdict(
        await fire(
          'SubagentStop',
          {
            stop_hook_active: more.stopHookActive ?? false,
            agent_id: agentId,
            agent_type: agentType,
            agent_transcript_path: options.transcript?.agentPath(agentId) ?? '',
            ...(lastMessage ? { last_assistant_message: lastMessage } : {}),
            ...work(),
          } as never,
          { agentId, ...(more.sourcesOnly ? { sourcesOnly: more.sourcesOnly } : {}) },
        ),
      )
    },

    async runSessionEnd(reason) {
      await fire('SessionEnd', { reason: reason as never })
    },

    async runNotification(notification) {
      await fire('Notification', {
        message: notification.message,
        notification_type: notification.notificationType ?? '',
        ...(notification.title ? { title: notification.title } : {}),
      })
    },

    async runSubagentStart(agentType, agentId) {
      const additionalContext = claudeText(
        await fire('SubagentStart', { agent_id: agentId, agent_type: agentType }),
      )
      return additionalContext ? { additionalContext } : {}
    },

    async runPreCompact(trigger, customInstructions) {
      const outcome = await fire('PreCompact', {
        trigger,
        custom_instructions: customInstructions ?? null,
      } as never)
      if (!outcome || (outcome.proceed && outcome.continue)) return { blocked: false }
      return { blocked: true, reason: outcome.block?.reason || outcome.stopReason?.trim() }
    },
  }
}
