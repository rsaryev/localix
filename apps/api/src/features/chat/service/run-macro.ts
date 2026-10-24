import type { ReasoningEffort } from '../../../db/types'
import { InvalidRequestError } from '../../../lib/domain-errors'
import { randomUUID } from 'node:crypto'

import { USER_PARTICIPANT, type StoredMessagePayload } from '../../../db'
import type { createChatRepository, SessionRecord } from '../repository'
import type {
  MessageBinding,
  MessageInvocationBinding,
  MessageMutationResponse,
} from '../contracts'
import type { SessionStreamRegistry } from '../runtime/session-stream-registry'
import type { AgentRunner } from '../runtime/agent-runner'
import {
  persistAndPublishMessage,
  emptyAssistantPayload,
  bumpSessionForTurn,
} from './message-builders'
import { logRunStartFailure } from './run-dispatch'
import { rootExecutionContext } from '../runtime/execution-context'
import type { ToolSurface } from '@localixai/agent/agents'
import { resolveExistingMessages, type ExistingMessages } from './run-agent'
import {
  enqueueTurnTickets,
  resolveTurnRecipients,
  supersedeColleagueChains,
} from '../runtime/conversation-dispatch'
import type { QueuedCommand } from '../runtime/wake-queue-contracts'
import type { ToolRequirement } from '../../agent-core/required-tools'
import { agentParticipant } from '../../../db/participant'
import type { ScopedCcHooks } from '../runtime/run-contract'

export interface RunMacroDeps {
  repo: ReturnType<typeof createChatRepository>
  streamRegistry: SessionStreamRegistry
  publishSession: (session: SessionRecord) => void
  runner: AgentRunner
}

export interface RunMacroOptions {
  extraDisabledTools?: string[]
  extraAllowedTools?: string[]
  /** A command may require a tool without granting it or bypassing the user's capability rules. */
  requiredTools?: readonly ToolRequirement[]
  /** Per-run model override (CC command `model:` frontmatter). Applied to the RUN
   *  only — NOT persisted to the session, so the user's model choice is untouched. */
  modelId?: string
  /** Per-run reasoning effort (CC skill `effort:` frontmatter); like `modelId`, never persisted. */
  reasoningEffort?: ReasoningEffort
  /** Provenance badge rendered on the visible user message ("via /loop · every 5m"). */
  commandOrigin?: { command: string; label: string }
  /** Run-scoped CC hooks from a skill's frontmatter `hooks` block (active this run only). */
  ccScopedHooks?: ScopedCcHooks[]
  /** Client surface inherited from the initiating send. */
  toolSurface?: ToolSurface
  /** Additional assets/context linked to the command invocation. */
  bindings?: MessageBinding[]
  invocation?: Omit<MessageInvocationBinding, 'kind' | 'id' | 'instruction'>
}

/**
 * Run the agent from a slash-command macro. The visible command and its resolved
 * invocation are ONE user message: the instruction is carried by an invocation
 * binding and materialized only for this turn. No hidden duplicate user row.
 *
 * A busy session queues the command WHOLE (text, bindings, badge, run identity) instead of
 * writing its user row and slot into the middle of the running turn; the drain then opens it
 * through the same fan-out as any other queued message.
 */
export function createRunMacroCommand(deps: RunMacroDeps) {
  const { repo, streamRegistry, publishSession, runner } = deps

  return async function runMacroCommand(
    userId: string,
    sessionId: string,
    session: SessionRecord,
    existingMessages: ExistingMessages,
    visiblePrompt: string,
    instruction: string,
    timestamp: string,
    opts?: RunMacroOptions,
  ): Promise<MessageMutationResponse> {
    const bindings = [
      invocationBinding(visiblePrompt, instruction, opts),
      ...(opts?.bindings ?? []),
    ]
    const identity = commandIdentity(opts)

    if (runner.isBusy(sessionId)) {
      const command: QueuedCommand = {
        ...(opts?.commandOrigin ? { origin: opts.commandOrigin } : {}),
        ...(identity ? { identity } : {}),
      }
      await runner.wake({
        userId,
        session,
        content: visiblePrompt,
        internal: false,
        source: 'user-busy',
        bindings,
        command,
        ...(opts?.toolSurface ? { toolSurface: opts.toolSurface } : {}),
        ...(opts?.extraDisabledTools?.length
          ? { extraDisabledTools: opts.extraDisabledTools }
          : {}),
      })
      return { sessionId, messageId: '', queued: true }
    }

    // A user message always has a recipient when the conversation has a participant, so this is
    // the whole "nobody can answer" check — and it runs before anything is written, so a command
    // nobody can answer never leaves a user row behind.
    if (!session.agents.length)
      throw new InvalidRequestError(
        'session_party_empty',
        'Choose an agent before running a command',
      )

    const userPayload: StoredMessagePayload = {
      id: randomUUID(),
      role: 'user',
      from: USER_PARTICIPANT,
      content: visiblePrompt,
      bindings,
      ...(opts?.commandOrigin ? { commandOrigin: opts.commandOrigin } : {}),
    }
    const userPersisted = await persistAndPublishMessage(
      repo,
      streamRegistry,
      userId,
      sessionId,
      userPayload,
      timestamp,
    )
    // The echo goes out first; the history is read behind it, WITHOUT the command's own row —
    // the strategy reads the last row as "who answered the user last".
    const existing = await resolveExistingMessages(existingMessages, [userPayload.id])
    const recipients = await resolveTurnRecipients(
      session,
      existing,
      { kind: 'user-message', text: visiblePrompt },
      runner.leadership(userId, session.projectId),
      runner.floorAdvisor({ userId, sessionId, projectId: session.projectId }),
    )
    const first = recipients[0]!
    await supersedeColleagueChains(runner.cancelAgentTurns, userId, sessionId)
    const asstPayload = emptyAssistantPayload(randomUUID(), agentParticipant(first.agentId))
    await persistAndPublishMessage(repo, streamRegistry, userId, sessionId, asstPayload, timestamp)
    const updatedSession = await bumpSessionForTurn(
      repo,
      publishSession,
      userId,
      sessionId,
      session,
      [...existing, userPersisted],
      timestamp,
    )

    // A per-run model override travels in the scope: the dispatcher re-reads the session when
    // the ticket runs, so it is applied there to the run's copy and never persisted.
    void enqueueTurnTickets(runner.enqueueRun, {
      userId,
      session: updatedSession,
      triggerMessageIds: [userPersisted.id],
      firstSlotId: asstPayload.id,
      recipients,
      scope: {
        conversationId: userPayload.id,
        executionContext: rootExecutionContext(opts?.toolSurface),
        ...(opts?.extraDisabledTools?.length
          ? { extraDisabledTools: opts.extraDisabledTools }
          : {}),
        ...identity,
      },
    }).catch(logRunStartFailure('macro', sessionId))
    return { sessionId, messageId: asstPayload.id }
  }
}

function invocationBinding(
  visiblePrompt: string,
  instruction: string,
  opts: RunMacroOptions | undefined,
): MessageInvocationBinding {
  const commandToken = visiblePrompt.trim().split(/\s+/)[0] || '/command'
  return {
    kind: 'invocation',
    id: randomUUID(),
    source: opts?.invocation?.source ?? 'slash',
    invocation: opts?.invocation?.invocation ?? {
      kind: 'workflow',
      name: commandToken.replace(/^\//, ''),
      arguments: visiblePrompt.trim().slice(commandToken.length).trim() || undefined,
      lifetime: 'turn',
    },
    presentation: opts?.invocation?.presentation ?? {
      label: commandToken,
      token: commandToken,
    },
    instruction,
  }
}

/** What the command asks of its run beyond the text; absent when it asks nothing. */
function commandIdentity(opts: RunMacroOptions | undefined): QueuedCommand['identity'] {
  const identity = {
    ...(opts?.extraAllowedTools?.length ? { extraAllowedTools: opts.extraAllowedTools } : {}),
    ...(opts?.requiredTools?.length ? { requiredTools: opts.requiredTools } : {}),
    ...(opts?.ccScopedHooks?.length ? { ccScopedHooks: opts.ccScopedHooks } : {}),
    ...(opts?.modelId ? { modelOverride: opts.modelId } : {}),
    ...(opts?.reasoningEffort ? { effortOverride: opts.reasoningEffort } : {}),
  }
  return Object.keys(identity).length > 0 ? identity : undefined
}
