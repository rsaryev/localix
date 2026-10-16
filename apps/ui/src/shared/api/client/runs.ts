import type { QueueClearResult, QueuePromoteResult, QueueRemovalResult } from '../contracts'
import { client, unwrap } from '../internal'
import { agentRunPreflight } from '../agentRunPreflight'

/** Run control: stop, monitors, loops and the server-side message queue. */
export const runsApi = {
  async stop(sessionId: string): Promise<boolean> {
    const json = await unwrap(
      await client.rpc.sessions[':id'].stop.$post({
        param: { id: sessionId },
      }),
    )
    return json.stopped
  },

  /** Stop one of a session's monitors. False when it is already ended or not the user's. */
  async stopSessionMonitor(sessionId: string, monitorId: string): Promise<boolean> {
    const json = await unwrap(
      await client.rpc.sessions[':id'].monitors.stop.$post({
        param: { id: sessionId },
        json: { monitorId },
      }),
    )
    return json.stopped
  },

  /** Cancel a session loop by id. Returns true if the loop existed and was removed. */
  async cancelSessionLoop(loopId: string): Promise<boolean> {
    const json = await unwrap(await client.rpc.loops.cancel.$post({ json: { id: loopId } }))
    return json.removed
  },

  /** Fire a session loop now (extra occurrence). Returns true if it existed and fired. */
  async runSessionLoop(loopId: string): Promise<boolean> {
    const policy = agentRunPreflight(undefined)
    if (policy) await policy
    const json = await unwrap(await client.rpc.loops.run.$post({ json: { id: loopId } }))
    return json.fired
  },

  /** Atomically cancel one queued message; content is returned only when cancellation wins. */
  async removeQueuedMessage(sessionId: string, itemId: string): Promise<QueueRemovalResult> {
    return unwrap(
      await client.rpc.sessions[':id'].queue.remove.$post({
        param: { id: sessionId },
        json: { itemId },
      }),
    )
  },

  /** Atomically stop the active run and deliver one selected backend queue row. */
  async interruptAndPromoteQueuedMessage(
    sessionId: string,
    itemId: string,
  ): Promise<QueuePromoteResult> {
    return unwrap(
      await client.rpc.sessions[':id'].queue['send-now'].$post({
        param: { id: sessionId },
        json: { itemId },
      }),
    )
  },

  /** Clear every cancellable queue entry and report rows already leased for delivery. */
  async clearQueuedMessages(sessionId: string): Promise<QueueClearResult> {
    return unwrap(await client.rpc.sessions[':id'].queue.clear.$post({ param: { id: sessionId } }))
  },
}
