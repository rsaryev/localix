import { DEFAULT_REASONING_EFFORT, type Usage } from '@localixai/agent'
import type { StoredSystemNotice } from '../../../db'
import { RECAP_MAX_CHARS } from '../../../contracts/session-recap'
import { isModelRoutingTaskEnabled } from '../../../contracts/model-task-catalog'
import { assistantText } from '../../../lib/assistant-text'
import { executeModelTask } from '../../model-task-runtime'
import type { PersistedMessage } from '../contracts'
import type { createChatRepository } from '../repository'
import type { createAuxProviderHelpers } from '../service/aux-provider'
import { recapEligibility, type RecapSkip, type RecapTrigger } from './eligibility'
import { RECAP_SYSTEM_PROMPT, renderRecapTranscript } from './transcript'

type AuxHelpers = ReturnType<typeof createAuxProviderHelpers>
type Repo = ReturnType<typeof createChatRepository>

export { RECAP_MAX_CHARS }
const RECAP_TASK = { id: 'session-recap', version: 1 } as const
const RECAP_DEADLINE_MS = 20_000

export type RecapResult =
  | { status: 'created'; text: string; messageId: string }
  | { status: 'skipped'; reason: RecapSkip | 'busy' | 'stale' }
  /** No model could be reached, or it said nothing usable: the transcript is left as it was. */
  | { status: 'unavailable' }

export interface RecapServiceDeps {
  repo: Pick<Repo, 'getSession' | 'listMessages'>
  readAgentSettings: AuxHelpers['readAgentSettings']
  buildLanguageModel: AuxHelpers['buildLanguageModel']
  /** Writes the recap into the transcript as a record only (no model context). */
  insertNotice: (
    userId: string,
    sessionId: string,
    notice: StoredSystemNotice,
    settleOptimistic: boolean,
  ) => Promise<{ messageId: string }>
  /** The injected clock, in epoch milliseconds. */
  nowMs: () => number
  recordUsage?: (entry: {
    userId: string
    sessionId: string
    modelId: string
    providerConnectionId?: string | null
    providerId?: string | null
    usage?: Usage
  }) => void
}

/** One line, quotes and surrounding blanks gone, cut to the cap with an ellipsis. */
export function cleanRecap(content: unknown): string {
  const line = assistantText(content)
    .replace(/\s+/g, ' ')
    .replace(/^["'«»\s]+|["'«»\s]+$/g, '')
  if (line.length <= RECAP_MAX_CHARS) return line
  return `${line.slice(0, RECAP_MAX_CHARS - 1).trimEnd()}…`
}

const lastId = (rows: readonly PersistedMessage[]): string | undefined => rows.at(-1)?.id

/**
 * The session recap: a one-line "where you left off" written by an auxiliary model into the
 * transcript. Automatic recaps and `/recap` share this one path; the caller decides WHEN (the
 * window's focus and the break are the client's to see), this decides WHETHER from the transcript.
 *
 * It follows the `sessionRecap` model route (own model and effort, the chat's model when none is
 * chosen) and writes a record the model never reads back.
 */
export function createRecapService(deps: RecapServiceDeps) {
  const { repo, readAgentSettings, buildLanguageModel, insertNotice, nowMs, recordUsage } = deps
  const inflight = new Set<string>()

  async function recap(
    userId: string,
    sessionId: string,
    trigger: RecapTrigger,
    options: { settleOptimistic?: boolean } = {},
  ): Promise<RecapResult> {
    const key = `${userId}:${sessionId}`
    // Claimed before the first await: a second window asking now must see this one.
    if (inflight.has(key)) return { status: 'skipped', reason: 'busy' }
    inflight.add(key)
    try {
      const [session, settings, rows] = await Promise.all([
        repo.getSession(userId, sessionId),
        readAgentSettings(userId),
        repo.listMessages(userId, sessionId),
      ])
      if (!session) return { status: 'unavailable' }
      const verdict = recapEligibility({
        trigger,
        enabled: isModelRoutingTaskEnabled(settings, 'sessionRecap'),
        running: session.runtimeStatus === 'running',
        nowMs: nowMs(),
        rows,
      })
      if (!verdict.ok) return { status: 'skipped', reason: verdict.reason }

      const slot = settings?.modelRouting?.sessionRecap
      const route = slot?.modelId ? slot : session.agent
      if (!route?.modelId) return { status: 'unavailable' }
      const built = await buildLanguageModel(userId, route.modelId, route.providerConnectionId)
      if (!built) return { status: 'unavailable' }

      const outcome = await executeModelTask({
        request: {
          task: RECAP_TASK,
          system: RECAP_SYSTEM_PROMPT,
          input: renderRecapTranscript(rows),
          budget: { inputTokens: 4000, outputTokens: 200 },
          capabilities: { streaming: false },
          deadlineAtMs: Date.now() + RECAP_DEADLINE_MS,
        },
        execute: async (request, signal) => {
          const message = await built.model.complete({
            systemPrompt: request.system,
            messages: [{ role: 'user', content: request.input, timestamp: Date.now() }],
            // The workload's own level, never the conversation's.
            reasoningEffort: slot?.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
            signal,
          })
          return { output: message, usage: message.usage }
        },
      }).catch(() => null)
      if (outcome?.status !== 'success') return { status: 'unavailable' }
      recordUsage?.({
        userId,
        sessionId,
        modelId: route.modelId,
        providerConnectionId: built.providerConnectionId,
        providerId: built.providerId,
        usage: outcome.response.output.usage,
      })
      const text = cleanRecap(outcome.response.output.content)
      if (!text) return { status: 'unavailable' }

      // The person moved on while this was written: a recap of the past would land after the
      // present. Dropped, not retried; the next break asks again.
      if (lastId(await repo.listMessages(userId, sessionId)) !== lastId(rows))
        return { status: 'skipped', reason: 'stale' }
      const { messageId } = await insertNotice(
        userId,
        sessionId,
        { kind: 'session_recap', tone: 'neutral', text },
        options.settleOptimistic ?? false,
      )
      return { status: 'created', text, messageId }
    } catch {
      return { status: 'unavailable' }
    } finally {
      inflight.delete(key)
    }
  }

  return { recap }
}

export type RecapService = ReturnType<typeof createRecapService>
