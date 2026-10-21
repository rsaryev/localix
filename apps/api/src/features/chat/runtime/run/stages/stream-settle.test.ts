import { describe, expect, test } from 'bun:test'
import type { AgentEvent } from '@localixai/agent/agents'
import type { AgentRuntimeResult, AgentRuntimeRun } from '@localixai/agent/runtime'

import { settleRunStream } from './stream-settle'

function fakeRun(
  events: AgentEvent[],
  result: AgentRuntimeResult,
  throws?: Error,
): AgentRuntimeRun {
  return {
    result: Promise.resolve(result),
    abort() {},
    async *[Symbol.asyncIterator]() {
      yield* events
      if (throws) throw throws
    },
  }
}

function harness(run: AgentRuntimeRun, storeFails = false) {
  const log: string[] = []
  const settled = settleRunStream({
    stream: run,
    handle: async (event) => void log.push(`event:${event.type}`),
    record: {
      finish: async (result) => void log.push(`finish:${result.terminal}`),
      fail: async (error) => void log.push(`fail:${(error as Error).message}`),
    },
    storeReached: async () => {
      log.push('store')
      if (storeFails) throw new Error('disk full')
    },
    onStoreFailed: (error) => log.push(`store-failed:${(error as Error).message}`),
  })
  return { log, settled }
}

const end: AgentEvent = { type: 'agent_end', timestamp: 0 }

describe('settling a run stream', () => {
  test('a completed run is journaled and its row left to the cadence', async () => {
    const { log, settled } = harness(fakeRun([end], { messages: [], terminal: 'completed' }))
    await settled
    expect(log).toEqual(['event:agent_end', 'finish:completed'])
  })

  test('a stopped run stores what it reached before it is finalized', async () => {
    const { log, settled } = harness(fakeRun([end], { messages: [], terminal: 'aborted' }))
    await expect(settled).rejects.toThrow()
    expect(log.slice(0, 3)).toEqual(['event:agent_end', 'finish:aborted', 'store'])
  })

  test('a failed run, whose events end by throwing, stores what it reached too', async () => {
    const failure = new Error('provider down')
    const run = fakeRun([end], { messages: [], terminal: 'failed', error: failure }, failure)
    const { log, settled } = harness(run)
    await expect(settled).rejects.toThrow('provider down')
    expect(log).toEqual(['event:agent_end', 'store', 'fail:provider down'])
  })

  test("a store that fails is reported, and the run's own error stays the one that counts", async () => {
    const failure = new Error('provider down')
    const run = fakeRun([], { messages: [], terminal: 'failed', error: failure }, failure)
    const { log, settled } = harness(run, true)
    await expect(settled).rejects.toThrow('provider down')
    expect(log).toEqual(['store', 'store-failed:disk full', 'fail:provider down'])

    const stopped = harness(fakeRun([], { messages: [], terminal: 'aborted' }), true)
    await expect(stopped.settled).rejects.toThrow('aborted')
    expect(stopped.log).toEqual([
      'finish:aborted',
      'store',
      'store-failed:disk full',
      expect.stringMatching(/^fail:.*aborted/),
    ])
  })
})
