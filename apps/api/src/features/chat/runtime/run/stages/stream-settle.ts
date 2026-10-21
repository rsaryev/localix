import type { AgentEvent } from '@localixai/agent/agents'
import type { AgentRuntimeRun } from '@localixai/agent/runtime'

import type { AgentRunRecord } from '../run-record'
import { requireCompletedRuntime } from '../runtime-result'

/**
 * Drain a run's events into the host, journal how it ended, and leave the row as the run left it.
 *
 * A run that did not complete — stopped, or failed — is finalized from its STORED row, which the
 * stream writes only on a cadence. So what it reached is stored first, above all a tool call that
 * ended after the stop, or finalizing rewinds that call to running and it spins in the
 * transcript. A failed run's events end by throwing, so that store happens on the failure path
 * too. Storing it is best effort: its failure is reported, never put in place of the run's own.
 */
export async function settleRunStream(input: {
  stream: AgentRuntimeRun
  handle: (event: AgentEvent) => Promise<void>
  record: AgentRunRecord
  storeReached: () => Promise<void>
  onStoreFailed: (error: unknown) => void
}): Promise<void> {
  const { stream, record } = input
  let stored = false
  const storeReached = async () => {
    if (stored) return
    stored = true
    try {
      await input.storeReached()
    } catch (error) {
      input.onStoreFailed(error)
    }
  }
  try {
    for await (const event of stream) await input.handle(event)
    const result = await stream.result
    await record.finish(result)
    if (result.terminal !== 'completed') await storeReached()
    requireCompletedRuntime(result)
  } catch (error) {
    await storeReached()
    await record.fail(error)
    throw error
  }
}
