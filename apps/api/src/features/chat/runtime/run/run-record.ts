import { randomUUID } from 'node:crypto'

import { classifyAgentError } from '@localixai/agent/agents'
import type { AgentRuntime, AgentRuntimeResult } from '@localixai/agent/runtime'

import type { AgentRunRepository } from '../../../../db/agent-run-repository'
import { LocalContextBudgetExceededError } from '../context-budget'

/**
 * The durable record of ONE adapter run: a row while it is in flight, and its terminal status.
 *
 * This replaces a much larger `runtime-journal.ts`, which also mirrored every semantic agent event
 * into `agent_run_events`, every assistant message into an append-only `agent_session_entries`
 * tree, and every `turn_end` into `agent_run_checkpoints`. Nothing ever read any of it — the read
 * side had no production caller — so those tables were dropped
 * (`migrations/20260731T010000_drop_runtime_journal.ts`) and with them the whole `append` path,
 * including the per-event redaction/degradation machinery that existed only to make those writes
 * safe on the streaming hot path.
 *
 * What remains is the part with a reader: while a row says `running`, a process death is visible to
 * the next boot, which reclassifies it (`reclassifyInterruptedRuns`) and announces a durable
 * "Backend restarted — this reply is incomplete" notice into the transcript. That is the ONLY
 * reason this record is written, and it is why closing the row is treated as more important than
 * anything else in this file.
 */
export interface AgentRunRecord {
  finish(result: AgentRuntimeResult): Promise<void>
  fail(error: unknown): Promise<void>
}

/** The `error_code` persisted for a failed run: a rate-limit/quota cap over the plain kind. */
function classifyFailureCode(error: unknown): string {
  // Record the CAUSE category, not retryability. An active-turn overflow is terminal
  // while old-history overflow may compact and retry, but both are context pressure.
  if (error instanceof LocalContextBudgetExceededError) return 'context_overflow'
  const info = classifyAgentError(error)
  return info.rateLimited ? 'rate_limit' : info.kind
}

function errorPayload(error: unknown): { name: string; message: string } {
  if (error instanceof LocalContextBudgetExceededError) {
    // Keep structured evidence even when recovery succeeds and replaces the live
    // assistant diagnostics. Never require an auditor to parse the error prose.
    const payload = {
      name: error.name,
      message: error.message,
      contextBudget: {
        code: error.code,
        reason: error.reason,
        requiredTokens: error.requiredTokens,
        availableTokens: error.availableTokens,
        estimateSource: error.estimateSource,
        frame: error.frame,
      },
    }
    return payload
  }
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'Error', message: String(error) }
}

export async function startAgentRunRecord(input: {
  repository: AgentRunRepository
  runtime: AgentRuntime
  userId: string
  sessionId: string
  /** The participant whose run this is. */
  agentId: string
  providerId: string
  modelId: string
  credentialId?: string | null
  now: () => string
  /**
   * The Vault exposure shield, bound to this user — the same function the item accumulator is
   * constructed with. A failure persists the provider's own error message, and a provider echoing
   * back the credential it was sent is exactly the surface this shield exists for.
   *
   * Optional because its source is: `RunnerDeps.sanitizeToolInput` is itself optional, so a host
   * assembled without the Vault passes nothing here — and an absent shield must leave the payload
   * untouched rather than empty.
   */
  sanitize?: (value: unknown) => unknown
  /** Where a failed terminal write reports itself. Without one that degradation is silent. */
  logger?: { warn: (message: string, meta?: unknown) => void }
}): Promise<AgentRunRecord> {
  const shield = input.sanitize ?? ((value: unknown) => value)
  const runId = randomUUID()
  await input.repository.startRun(input.userId, {
    id: runId,
    sessionId: input.sessionId,
    agentId: input.agentId,
    providerId: input.providerId,
    modelId: input.modelId,
    credentialId: input.credentialId ?? null,
    adapter: input.runtime.adapter.id,
    adapterVersion: input.runtime.adapter.version,
    startedAt: input.now(),
  })

  let terminal = false

  /**
   * The terminal write must not throw and must not give up easily: while the row still says
   * `running`, `startRun`'s one-active-run guard refuses EVERY later run in this session until the
   * next boot sweep reclassifies it. So it is retried in place, and it still never throws.
   *
   * Retried exactly once. `busy_timeout` is 5000ms, so a genuine SQLITE_BUSY has already waited
   * that long and a second attempt may wait as long again — acceptable only because the alternative
   * is a session wedged for the whole process lifetime, and because every other cause (a revision
   * conflict, a disk error) fails instantly.
   *
   * The retry used to come from PROPAGATING: `finish` threw, the run's catch called `fail()`,
   * and that second attempt closed the row — as `failed`, reporting a COMPLETED run as an error to
   * the user because a bookkeeping write hiccupped.
   */
  const writeTerminal = async (attempt: () => Promise<void>): Promise<boolean> => {
    for (let tries = 0; tries < 2; tries++) {
      try {
        await attempt()
        return true
      } catch (error) {
        if (tries === 0) continue
        input.logger?.warn(
          'run record could not close the run — it stays `running` until the next boot sweep',
          {
            runId,
            sessionId: input.sessionId,
            error: error instanceof Error ? error.message : String(error),
          },
        )
      }
    }
    return false
  }

  const finish = async (
    status: 'completed' | 'aborted' | 'failed',
    error?: unknown,
  ): Promise<void> => {
    if (terminal) return
    const committed = await writeTerminal(async () => {
      await input.repository.finishRun(input.userId, {
        runId,
        sessionId: input.sessionId,
        status,
        finishedAt: input.now(),
        // The classified failure KIND as `error_code`, so context_overflow / timeout / abort /
        // rate_limit are distinguishable in one column instead of by JSON-parsing every error_json.
        // A rate-limit/quota cap gets its own code (kind stays 'fatal').
        ...(error === undefined
          ? {}
          : {
              errorCode: classifyFailureCode(error),
              // Shielded, and the classifier above deliberately reads the ORIGINAL error:
              // redaction must never feed classification.
              error: shield(errorPayload(error)) as { name: string; message: string },
            }),
      })
    })
    // Latch only after persistence succeeds. The caller's catch path invokes fail(); if a
    // completed/aborted write failed transiently, that fallback must still be able to close the
    // durable run instead of leaving it permanently `running`.
    if (committed) terminal = true
  }

  return {
    async finish(result) {
      await finish(result.terminal, result.error)
    },
    async fail(error) {
      await finish('failed', error)
    },
  }
}
