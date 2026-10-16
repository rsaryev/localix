import { describe, expect, test } from 'bun:test'
import { z } from 'zod'

import { defineAgentTool, type AgentTool, type AgentToolResult } from '@localixai/agent/agents'

import { wrapToolsWithTimeoutPromoter } from './timeout-promoter'

interface Emitted {
  toolCallId: string
  output: string
  done?: boolean
  jobStatus?: string
  /** The wake. Without it the promoted answer sits in a job nobody reads — see the assertions. */
  notify?: boolean
}

function fakeRegistry(runningJobs = 0) {
  const emitted: Emitted[] = []
  const registered: Array<{ toolCallId: string; label?: string; actions: string[] }> = []
  const disposed: string[] = []
  const registry = {
    registerActions: (
      toolCallId: string,
      actions: Record<string, { execute: (payload?: unknown) => void }>,
      options?: { label?: string },
    ) => {
      registered.push({ toolCallId, label: options?.label, actions: Object.keys(actions) })
      return () => disposed.push(toolCallId)
    },
    getActions: () => undefined,
    getBackgroundJobId: () => 'bg-7',
    countBackgroundJobs: () => runningJobs,
    emitBackground: (
      toolCallId: string,
      output: string,
      opts?: { done?: boolean; jobStatus?: string; notify?: boolean },
    ) => {
      emitted.push({ toolCallId, output, ...opts })
    },
  }
  return { registry, emitted, registered, disposed, kill: () => registered }
}

const slowTool = (settle: Promise<AgentToolResult>, promoteAfterMs = 20) =>
  defineAgentTool({
    name: 'research',
    label: 'Research',
    description: 't',
    activeVerb: 'Researching',
    promoteAfterMs,
    inputSchema: z.object({ q: z.string() }),
    execute: () => settle,
  })

// `AgentTool`, not `ReturnType<typeof slowTool>`: the promoter takes and returns the ERASED tool
// type, because it wraps a heterogeneous list. Typing the harness to the narrow input is what
// made every call site here an error while the code under test was fine.
const run = (tool: AgentTool, registry: unknown, signal?: AbortSignal) =>
  tool.execute('tc-1', { q: 'x' }, signal ?? new AbortController().signal, () => {}, {
    asyncRegistry: registry,
  } as never)

describe('a call that outruns its budget', () => {
  test('returns a pointer to a job instead of failing', async () => {
    const { registry, registered } = fakeRegistry()
    let land: (result: AgentToolResult) => void = () => {}
    const settle = new Promise<AgentToolResult>((resolve) => {
      land = resolve
    })
    const [tool] = wrapToolsWithTimeoutPromoter([slowTool(settle)])

    const result = await run(tool!, registry)
    // NOT an error: the work is proceeding, and calling it a failure sends the model down a
    // retry path for something that is still running.
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('bg-7')
    expect(result.content).toContain('still running in the background')
    // The registrant NAMES its job, which is what makes it a job the host can list and stop.
    expect(registered[0]?.label).toContain('Research')
    expect(registered[0]?.actions).toEqual(['kill'])
    land({ content: 'done' })
  })

  test('the body is never abandoned — its result arrives through the job channel', async () => {
    // The whole design. A `Promise.race` over `execute` would report the timeout and throw
    // the result away, because the tool's promise is the only handle on it.
    const { registry, emitted, disposed } = fakeRegistry()
    let land: (result: AgentToolResult) => void = () => {}
    const settle = new Promise<AgentToolResult>((resolve) => {
      land = resolve
    })
    const [tool] = wrapToolsWithTimeoutPromoter([slowTool(settle)])

    await run(tool!, registry)
    land({ content: 'the real answer' })
    await Bun.sleep(5)

    expect(emitted).toEqual([
      {
        toolCallId: 'tc-1',
        output: 'the real answer',
        done: true,
        jobStatus: 'completed',
        // Notified, because the model returned a pointer and is not waiting on this promise:
        // without a wake the answer would sit in a job nobody reads.
        notify: true,
      },
    ])
    // And the lane is released, so the job does not leak the cap forever.
    expect(disposed).toEqual(['tc-1'])
  })

  test('a body that throws is reported as a failed job, not a lost one', async () => {
    const { registry, emitted } = fakeRegistry()
    const [tool] = wrapToolsWithTimeoutPromoter([
      slowTool(
        (async () => {
          await Bun.sleep(40)
          throw new Error('upstream refused')
        })(),
      ),
    ])

    await run(tool!, registry)
    await Bun.sleep(60)

    expect(emitted[0]).toMatchObject({ jobStatus: 'failed', output: 'upstream refused' })
  })

  test('stopping the job aborts the call, so a tool that honours cancellation stops', async () => {
    let observed: AbortSignal | undefined
    const tool = defineAgentTool({
      name: 'research',
      description: 't',
      activeVerb: 'Researching',
      promoteAfterMs: 20,
      inputSchema: z.object({ q: z.string() }),
      execute: (_id, _input, signal) => {
        observed = signal
        return new Promise<AgentToolResult>(() => {})
      },
    })
    const captured: Array<Record<string, { execute: () => void }>> = []
    const registry = {
      registerActions: (_id: string, actions: Record<string, { execute: () => void }>) => {
        captured.push(actions)
        return () => {}
      },
      getBackgroundJobId: () => 'bg-1',
      countBackgroundJobs: () => 0,
      emitBackground: () => {},
    }
    const [wrapped] = wrapToolsWithTimeoutPromoter([tool])

    await run(wrapped!, registry)
    // Not the run's signal: aborting that would cancel everything else too.
    expect(observed?.aborted).toBe(false)
    captured[0]!.kill!.execute()
    expect(observed?.aborted).toBe(true)
  })

  test("the run's own cancellation still reaches the call", async () => {
    let observed: AbortSignal | undefined
    const tool = defineAgentTool({
      name: 'research',
      description: 't',
      activeVerb: 'Researching',
      promoteAfterMs: 10_000,
      inputSchema: z.object({ q: z.string() }),
      execute: async (_id, _input, signal) => {
        observed = signal
        expect(signal?.aborted).toBe(false)
        caller.abort()
        return { content: 'fast' }
      },
    })
    const caller = new AbortController()
    const [wrapped] = wrapToolsWithTimeoutPromoter([tool])

    await run(wrapped!, fakeRegistry().registry, caller.signal)
    expect(observed?.aborted).toBe(true)
  })
})

describe('when promotion is not the right answer', () => {
  test('a call that lands inside its budget is untouched', async () => {
    const { registry, registered, emitted } = fakeRegistry()
    const [tool] = wrapToolsWithTimeoutPromoter([slowTool(Promise.resolve({ content: 'quick' }))])

    expect((await run(tool!, registry)).content).toBe('quick')
    expect(registered).toEqual([])
    expect(emitted).toEqual([])
  })

  test('a tool without a budget is returned by reference', () => {
    const plain = slowTool(Promise.resolve({ content: 'x' }), 0)
    expect(wrapToolsWithTimeoutPromoter([plain])[0]).toBe(plain)
  })

  test('at the job cap it keeps waiting rather than exceeding a limit the host set', async () => {
    // Trading a bounded wait for an unbounded pile of jobs is not an improvement, and
    // silently passing the cap would make the cap a lie.
    const { registry, registered } = fakeRegistry(10)
    const [tool] = wrapToolsWithTimeoutPromoter([
      slowTool(
        (async () => {
          await Bun.sleep(40)
          return { content: 'waited it out' }
        })(),
      ),
    ])

    expect((await run(tool!, registry)).content).toBe('waited it out')
    expect(registered).toEqual([])
  })

  test('with no registry there is nothing to hand the work to, so it waits', async () => {
    const [tool] = wrapToolsWithTimeoutPromoter([
      slowTool(
        (async () => {
          await Bun.sleep(40)
          return { content: 'no host' }
        })(),
      ),
    ])
    expect((await run(tool!, undefined)).content).toBe('no host')
  })
})

describe('the run signal relay', () => {
  test('is detached once the call settles', async () => {
    const { registry } = fakeRegistry()
    const controller = new AbortController()
    const live = new Set<unknown>()
    const signal = controller.signal
    const add = signal.addEventListener.bind(signal)
    const remove = signal.removeEventListener.bind(signal)
    signal.addEventListener = ((type: string, listener: unknown, options?: unknown) => {
      live.add(listener)
      add(type as 'abort', listener as never, options as never)
    }) as typeof signal.addEventListener
    signal.removeEventListener = ((type: string, listener: unknown) => {
      live.delete(listener)
      remove(type as 'abort', listener as never)
    }) as typeof signal.removeEventListener
    const [tool] = wrapToolsWithTimeoutPromoter([slowTool(Promise.resolve({ content: 'ok' }))])

    expect((await run(tool!, registry, signal)).content).toBe('ok')
    expect(live.size).toBe(0)
  })
})
