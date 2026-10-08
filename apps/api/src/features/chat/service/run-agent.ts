import { agentRoute } from '../session-route'
import { randomUUID } from 'node:crypto'
import { ApiError } from '../../../lib/errors'

import { USER_PARTICIPANT, type StoredMessagePayload } from '../../../db'
import { agentParticipant } from '../../../db/participant'
import type { createChatRepository, SessionRecord } from '../repository'
import type { MessageBinding, MessageMutationResponse, PersistedMessage } from '../contracts'
import type { SessionStreamRegistry } from '../runtime/session-stream-registry'
import type { createAgentRunner } from '../runtime/agent-runner'
import type { ToolSurface } from '@localixai/agent/agents'
import type { createTitleGenerator } from './title-generation'
import type { RunProfile } from '../../agent-core/run-shape'
import {
  persistAndPublishMessage,
  emptyAssistantPayload,
  sessionAgent,
  bumpSessionForTurn,
} from './message-builders'
import { logRunStartFailure } from './run-dispatch'
import {
  invocationOrigin,
  rootExecutionContext,
  type RunExecutionContext,
} from '../runtime/execution-context'
import {
  enqueueTurnTickets,
  resolveTurnRecipients,
  supersedeColleagueChains,
} from '../runtime/conversation-dispatch'
import { createRunCompletion } from '../runtime/run-outcome'

export interface RunAgentDeps {
  repo: ReturnType<typeof createChatRepository>
  streamRegistry: SessionStreamRegistry
  runner: ReturnType<typeof createAgentRunner>
  maybeGenerateTitle: ReturnType<typeof createTitleGenerator>
  publishSession: (session: SessionRecord) => void
}

export interface RunAgentOptions {
  wait?: boolean
  extraDisabledTools?: string[]
  /**
   * A profile the caller resolved for this run (the hook verifier, a tools-only forked skill).
   * Native workers leave it out and keep their registry-owned instructions.
   */
  profileOverride?: RunProfile
  /** CC `maxTurns` — per-run cap on the agent's turn count (undefined = host default). */
  maxTurns?: number
  /**
   * Run-scoped CC hooks from a sub-agent's / forked skill's frontmatter `hooks`
   * block (active for this child run only). `asSubagent` converts Stop→SubagentStop.
   */
  ccScopedHooks?: {
    raw: unknown
    source: 'skill' | 'agent'
    asSubagent?: boolean
    agentType?: string
  }[]
  commandOrigin?: { command: string; label: string }
  /**
   * Hide this trigger prompt from the transcript (the UI filters `isInternal`)
   * while still feeding it to the model — for engine/orchestrator-injected
   * dispatch prompts (delegated task run, delegate sub-agent) that are noise
   * in the sub-session view. Mirrors the loop/wake `insertInternalTurn` default.
   */
  isInternal?: boolean
  /** Typed provenance and trusted authority for this run. Defaults to a root chat invocation. */
  executionContext?: RunExecutionContext
  /** Capabilities claimed by the client surface. Protected authority is never read from here. */
  toolSurface?: ToolSurface
  /** Optimistic UI row replaced by this persisted user echo. */
  clientMessageId?: string
}

/**
 * The turn's prior history — either already loaded, or a LOADER the run defers.
 *
 * A loader exists for one reason: latency. Loading the whole transcript ahead of
 * the user row's insert puts a full-table read in front of the `message.created`
 * echo, which is what the composer waits on. Hand a loader instead and the echo
 * goes out first; the read then happens with both new rows already in the tree,
 * so the loader's result is filtered back down to the pre-turn history by id
 * ({@link resolveExistingMessages}).
 */
export type ExistingMessages = PersistedMessage[] | (() => Promise<PersistedMessage[]>)

export type RunAgentFn = (
  userId: string,
  sessionId: string,
  session: SessionRecord,
  existingMessages: ExistingMessages,
  prompt: string,
  timestamp: string,
  bindings?: MessageBinding[],
  opts?: RunAgentOptions,
) => Promise<MessageMutationResponse>

/**
 * Resolve a turn's prior history, excluding the rows this turn just inserted.
 *
 * An already-loaded array passes straight through. Turn writers run a loader AFTER
 * the user and assistant rows are in the tree, so its result carries them at the
 * tail and `excludeIds` drops them. That is exact, not approximate: a linear insert
 * appends at the current leaf and advances it, so the loader's leaf→root path is the
 * pre-turn path plus those rows, in the same order — and since no pre-turn message
 * can be a CHILD of either new row, none of their branch metadata moves either.
 * Callers that only defer a read without inserting anything pass an empty exclusion.
 */
export async function resolveExistingMessages(
  source: ExistingMessages,
  excludeIds: string[],
): Promise<PersistedMessage[]> {
  if (typeof source !== 'function') return source
  const loaded = await source()
  const exclude = new Set(excludeIds)
  return loaded.filter((m) => !exclude.has(m.id))
}

/**
 * Insert the user message, create an empty assistant slot, fire the runner, and
 * return immediately. Kept as a factory (matching the other service/* ops
 * modules) so it can close over a bounded set of dependencies instead of the
 * full chat-service closure.
 */
export function createRunAgent(deps: RunAgentDeps): RunAgentFn {
  const { repo, streamRegistry, runner, maybeGenerateTitle, publishSession } = deps

  return async (
    userId,
    sessionId,
    session,
    existingMessages,
    prompt,
    timestamp,
    bindings,
    opts,
  ): Promise<MessageMutationResponse> => {
    if (!session.agents.length)
      throw new ApiError(400, 'session_party_empty', 'Choose an agent before sending a message')
    const executionContext = opts?.executionContext ?? rootExecutionContext(opts?.toolSurface)
    const origin = invocationOrigin(executionContext.invocation)
    const userPayload: StoredMessagePayload = {
      id: randomUUID(),
      role: 'user',
      from: USER_PARTICIPANT,
      content: prompt,
      ...(bindings && bindings.length > 0 ? { bindings } : {}),
      ...(opts?.commandOrigin ? { commandOrigin: opts.commandOrigin } : {}),
      ...(opts?.isInternal ? { isInternal: true } : {}),
      ...(origin ? { origin } : {}),
      ...(opts?.clientMessageId ? { clientMessageIds: [opts.clientMessageId] } : {}),
    }
    // The user's echo goes out FIRST — nothing but its own insert sits in front of it, because
    // the row is built entirely from this call's arguments and it is the one thing the composer
    // is waiting to see.
    const userPersisted = await persistAndPublishMessage(
      repo,
      streamRegistry,
      userId,
      sessionId,
      userPayload,
      timestamp,
    )

    // Authorship is fixed at insert and never patched, so resolve the strategy before creating
    // the first assistant placeholder. With no explicit address, the least-recent participant
    // is chosen deterministically from the shared history.
    const existing = await resolveExistingMessages(existingMessages, [userPayload.id])
    const recipients = await resolveTurnRecipients(
      session,
      existing,
      { kind: 'user-message', text: prompt },
      runner.leadership(userId, session.projectId),
    )
    if (!opts?.isInternal)
      await supersedeColleagueChains(runner.cancelAgentTurns, userId, sessionId)
    const firstSlot = recipients[0]?.agentId
    const asstPayload = emptyAssistantPayload(
      randomUUID(),
      firstSlot ? agentParticipant(firstSlot) : sessionAgent(session),
    )
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

    // Each recipient becomes one addressed queue ticket. The session event loop serializes them.
    const completion = opts?.wait ? createRunCompletion() : undefined
    const runPromise = enqueueTurnTickets(runner.enqueueRun, {
      userId,
      session: updatedSession,
      triggerMessageIds: [userPersisted.id],
      firstSlotId: asstPayload.id,
      recipients,
      completion,
      scope: {
        conversationId: userPayload.id,
        executionContext,
        ...(opts?.profileOverride ? { profileOverride: opts.profileOverride } : {}),
        ...(opts?.extraDisabledTools?.length
          ? { extraDisabledTools: opts.extraDisabledTools }
          : {}),
        // CC `maxTurns` — cap the loop's turn count for this run only.
        ...(opts?.maxTurns ? { maxTurns: opts.maxTurns } : {}),
        // CC skill/agent frontmatter hooks — active for this child run only.
        ...(opts?.ccScopedHooks?.length ? { ccScopedHooks: opts.ccScopedHooks } : {}),
      },
    })
      .then(() => completion?.promise)
      .catch(logRunStartFailure('agent', sessionId))
    // Kick off auxiliary LLM titling AFTER the main run is dispatched, so the
    // user's turn wins the provider/key-pool slot during the latency-critical
    // prefill window. Fire-and-forget; job sessions keep their engine titles.
    if (session.sessionKind === 'chat')
      maybeGenerateTitle(
        userId,
        sessionId,
        session.title,
        updatedSession.title,
        prompt,
        bindings?.filter((binding) => binding.kind !== 'context' && binding.kind !== 'invocation'),
        agentRoute(updatedSession, firstSlot!)!.reasoningEffort,
        updatedSession.goal ?? null,
      )
    // Channel turns await the full run (the caller needs the final reply);
    // interactive turns return immediately and stream over SSE.
    if (opts?.wait) await runPromise

    return { sessionId, messageId: asstPayload.id }
  }
}
