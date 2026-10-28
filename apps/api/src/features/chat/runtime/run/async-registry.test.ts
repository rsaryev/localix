import { describe, expect, test } from 'bun:test'

import { createMemoryWorkRepository } from '../../../work/testing/memory-repository'
import { createWorkRegistry } from '../../../work/registry'
import { testWork } from '../../../../testing/work-fixture'
import { createRunAsyncRegistry, describeToolActions } from './async-registry'
import { createRuntimeState, forgetSessionRuntimeState } from '../agent-runner-state'

test('describeToolActions strips callbacks and retains generic action presentation', () => {
  const descriptors = describeToolActions('tc-stream', {
    kill: {
      label: 'Stop stream',
      icon: 'square',
      tone: 'danger',
      execute: () => {},
    },
  })

  expect(descriptors).toEqual([
    {
      toolCallId: 'tc-stream',
      action: 'kill',
      label: 'Stop stream',
      icon: 'square',
      enabled: undefined,
      tone: 'danger',
    },
  ])
  expect(JSON.stringify(descriptors)).not.toContain('execute')
})

/** Let an armed notice resolve and its fire or dismissal run. */
const flushNotices = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** An exit-notice port that records what was armed and how each notice ended. */
function recordingNotices(armable = true) {
  const arms: unknown[] = []
  const fired: string[] = []
  const dismissed: string[] = []
  const port = {
    arm: async (input: unknown) => {
      arms.push(input)
      if (!armable) return null
      return {
        fire: (content: string) => void fired.push(content),
        dismiss: (reason: string) => void dismissed.push(reason),
      }
    },
  }
  return { port, arms, fired, dismissed }
}

describe('emitBackground — bounded snapshot fan-out', () => {
  const setup = (
    persistResult?: Promise<void>,
    notices?: ReturnType<typeof recordingNotices>,
    input: Record<string, unknown> = { command: 'build' },
  ) => {
    const published: unknown[] = []
    const snapshots: unknown[] = []
    const reminders: unknown[] = []
    const store = createMemoryWorkRepository()
    const runtime = createRuntimeState(createWorkRegistry({ repo: store }))
    const tool = {
      id: 'tc-1',
      toolCallId: 'tc-1',
      type: 'command',
      name: 'Bash',
      status: 'running',
      input: { command: 'build' },
      output: '',
    }
    const registry = createRunAsyncRegistry({
      env: {
        state: runtime,
        deps: {
          streamRegistry: {
            publish: (...args: unknown[]) => published.push(args),
          },
          ...(notices ? { exitNotices: notices.port } : {}),
        },
        persistAndPublish: (...args: unknown[]) => {
          snapshots.push(args)
          return persistResult ?? Promise.resolve()
        },
        queueMidRunReminder: (...args: unknown[]) => reminders.push(args),
      },
      state: {
        pendingTools: new Map([['tc-1', { name: 'Bash', input }]]),
        currentPayload: { role: 'assistant', from: 'agent:owner', items: [tool] },
        assistantCreatedAt: '2026-01-01T00:00:00.000Z',
      },
      abort: new AbortController(),
      userId: 'u1',
      session: { id: 's1' },
      agentId: 'owner',
      assistantMessageId: 'm1',
      childSessions: {},
      backgroundToolNames: new Set<string>(),
    } as never)
    return { registry, published, snapshots, reminders, runtime, store }
  }
  const bashActions = {
    kill: { label: 'Kill', execute: () => {} },
    send_input: { label: 'Send', execute: () => {} },
  }

  test("a finished job ends its work record with the job's own outcome", async () => {
    const h = setup()
    h.registry.registerActions('tc-1', {
      kill: { label: 'Kill', execute: () => {} },
      send_input: { label: 'Send', execute: () => {} },
    })
    expect(h.runtime.work.get('tc-1')).toMatchObject({ displayId: 'bg-1', status: 'running' })
    h.registry.emitBackground('tc-1', 'build ok', { done: true, exitCode: 0 })
    await Promise.resolve()
    expect(h.runtime.work.get('tc-1')).toBeUndefined()
    expect([...h.store.rows.values()]).toMatchObject([{ status: 'succeeded', exitCode: 0 }])
  })

  test('publishes one baseline snapshot, then cumulative growth as a tiny item append', () => {
    const { registry, published, snapshots } = setup()
    registry.emitBackground('tc-1', 'first')
    registry.emitBackground('tc-1', 'first second')

    expect(snapshots).toHaveLength(1)
    expect(published).toEqual([
      [
        'u1',
        's1',
        {
          type: 'message.delta',
          sessionId: 's1',
          messageId: 'm1',
          itemAppends: [{ itemId: 'tc-1', slot: 'output', append: ' second' }],
        },
      ],
    ])
  })

  // `bun` KILLS the process on an unhandled rejection (measured: exit 1) and this app
  // installs no `unhandledRejection` handler. `persistAndPublish` is a DB write that can
  // reject — `createKeyedSerializer` deliberately keeps its CHAIN from being poisoned but
  // still returns the rejecting promise to the caller — so a `void`ed call here means one
  // failed SQLite write during any streaming run takes down the whole API server, and with
  // it every other session in the process. The sibling `wake` call in this same function
  // already attaches a `.catch`.
  test('a killed job with notify wakes nobody — the caller stopped it and knows', async () => {
    const notices = recordingNotices()
    const { registry, reminders } = setup(undefined, notices, { command: 'build', notify: true })
    registry.registerActions('tc-1', bashActions)
    registry.emitBackground('tc-1', 'partial', {
      done: true,
      notify: true,
      jobStatus: 'killed',
      exitCode: 130,
    })
    await flushNotices()
    expect(notices.fired).toEqual([])
    expect(notices.dismissed).toEqual(['killed'])
    // It still leaves the cheap mid-run note, so a later turn can find the output.
    expect(reminders).toHaveLength(1)
  })

  // LOCALIX-388: a server stopped at its timeout showed its starting call as `aborted`, and told
  // the agent the job FAILED (exit 130). The call succeeded; the job was stopped.
  test('a stopped job settles its call as completed and tells the agent why it stopped', () => {
    const { registry, snapshots, reminders } = setup()
    registry.registerActions('tc-1', bashActions)
    registry.emitBackground('tc-1', 'Serving HTTP', {
      done: true,
      jobStatus: 'timeout',
      exitCode: 130,
      stop: { by: 'timeout', timeoutSecs: 60 },
    })
    const payload = (snapshots.at(-1) as unknown[])[3] as { items: { status: string }[] }
    expect(payload.items[0]!.status).toBe('completed')
    expect(String((reminders[0] as unknown[])[1])).toContain('stopped after its 60 s timeout')
  })

  // LOCALIX-379: a background workflow that finished showed its call as failed in the transcript.
  test('a job without an exit code that reports itself completed settles its call as completed', () => {
    const { registry, snapshots } = setup()
    registry.emitBackground('tc-1', 'Workflow audit finished (2 agents).', {
      done: true,
      jobStatus: 'completed',
    })
    const payload = (snapshots.at(-1) as unknown[])[3] as { items: { status: string }[] }
    expect(payload.items[0]!.status).toBe('completed')
  })

  test("the agent's own `TaskStop` does not come back to it as a reminder", () => {
    const { registry, reminders } = setup()
    registry.registerActions('tc-1', bashActions)
    registry.emitBackground('tc-1', 'Serving HTTP', {
      done: true,
      jobStatus: 'killed',
      exitCode: 130,
      stop: { by: 'agent' },
    })
    expect(reminders).toEqual([])
  })

  test('a notify job ARMS its notice as it starts, and its finish is that notice firing', async () => {
    const notices = recordingNotices()
    const { registry, reminders } = setup(undefined, notices, { command: 'build', notify: true })
    registry.registerActions('tc-1', bashActions)
    // Armed as the job starts; a restart that kills the job ends it silently.
    expect(notices.arms).toEqual([{ userId: 'u1', sessionId: 's1', source: 'bg-job' }])
    registry.emitBackground('tc-1', 'done', { done: true, notify: true, exitCode: 0 })
    await flushNotices()
    expect(notices.fired).toHaveLength(1)
    expect(notices.fired[0]).toContain(
      '[Background job ended: build] It finished successfully (exit 0).',
    )
    expect(reminders).toEqual([])
  })

  test('a notify job whose notice could not be armed still learns through the reminder', async () => {
    const notices = recordingNotices(false)
    const { registry, reminders } = setup(undefined, notices, { command: 'build', notify: true })
    registry.registerActions('tc-1', bashActions)
    registry.emitBackground('tc-1', 'done', { done: true, notify: true, exitCode: 0 })
    await flushNotices()
    expect(notices.fired).toEqual([])
    expect(reminders).toHaveLength(1)
  })

  test('a job without notify arms nothing', () => {
    const notices = recordingNotices()
    const { registry } = setup(undefined, notices)
    registry.registerActions('tc-1', bashActions)
    expect(notices.arms).toEqual([])
  })

  test('a registrant that reports in a later turn by design arms its notice itself', async () => {
    // A background workflow run: no `notify` argument, yet its end is the news the agent awaits.
    const notices = recordingNotices()
    const { registry } = setup(undefined, notices, { name: 'acme:audit' })
    registry.registerActions(
      'tc-1',
      { kill: { label: 'Stop', execute: () => {} } },
      { label: 'workflow acme:audit', notify: true },
    )
    expect(notices.arms).toHaveLength(1)
    registry.emitBackground('tc-1', 'Workflow acme:audit finished.', {
      done: true,
      jobStatus: 'completed',
      notify: true,
    })
    await flushNotices()
    expect(notices.fired[0]).toContain('Workflow acme:audit finished.')
  })

  test('a failing snapshot write is reported, not left as an unhandled rejection', async () => {
    const rejection = Promise.reject(new Error('disk full'))
    const { registry, snapshots } = setup(rejection)
    const warnings: unknown[][] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => warnings.push(args)
    try {
      registry.emitBackground('tc-1', 'output')
      expect(snapshots).toHaveLength(1)
      // Let the rejection settle; an unattached handler would surface here.
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      console.warn = originalWarn
    }
    expect(warnings.flat().some((arg) => String(arg).includes('snapshot'))).toBe(true)
  })

  test('forces a full snapshot for a rewrite and terminal state', () => {
    const { registry, published, snapshots } = setup()
    registry.emitBackground('tc-1', 'growing output')
    registry.emitBackground('tc-1', 'rewritten')
    registry.emitBackground('tc-1', 'final', { done: true, exitCode: 0 })

    expect(published).toHaveLength(0)
    expect(snapshots).toHaveLength(3)
  })

  test('session deletion kills a surviving job and suppresses its late final emit', () => {
    const h = setup()
    let kills = 0
    h.registry.registerActions('tc-1', {
      kill: { label: 'Kill', execute: () => void (kills += 1) },
      send_input: { label: 'Send', execute: () => {} },
    })

    const snapshotsBeforeForget = h.snapshots.length
    forgetSessionRuntimeState(h.runtime, 's1')
    h.registry.emitBackground('tc-1', 'late process exit', {
      done: true,
      exitCode: -1,
    })

    expect(kills).toBe(1)
    expect(h.runtime.actionRegistry.has('tc-1')).toBe(false)
    expect(h.runtime.work.get('tc-1')).toBeUndefined()
    expect(h.snapshots).toHaveLength(snapshotsBeforeForget)
    expect(h.published).toEqual([])
    expect(h.reminders).toEqual([])
  })
})

describe('registerActions — every registrant is owner-tagged', () => {
  // THE BUG this locks: the interact gate used to source the owner from
  // `backgroundJobs`, which is a strict SUBSET of `actionRegistry` — only
  // kill+send_input (background bash) and declared background streams land there.
  // A kill-only registrant (foreground bash, a CLI-agent child, a delegate) had no
  // owner record anywhere, and the gate reads "no owner" as ALLOW. So one user
  // could POST /tools/interact with another user's toolCallId and fire its `kill`
  // — which for foreground bash calls abortSession(), aborting the whole run.
  const setup = () => {
    const actionRegistry = new Map<
      string,
      { userId: string; sessionId: string; actions: unknown }
    >()
    const work = testWork()
    const registry = createRunAsyncRegistry({
      env: { state: { actionRegistry, work } },
      state: { pendingTools: new Map([['tc-1', { name: 'Bash', input: { command: 'sleep 9' } }]]) },
      abort: new AbortController(),
      userId: 'u1',
      session: { id: 'sA' },
      assistantMessageId: 'a1',
      childSessions: {},
      backgroundToolNames: new Set<string>(),
    } as never)
    return { registry, actionRegistry, work }
  }

  const kill = { kill: { label: 'Kill', icon: 'square', execute: () => {} } }

  test('a KILL-ONLY registrant is owner-tagged even though it is not a background job', () => {
    const { registry, actionRegistry, work } = setup()
    registry.registerActions('tc-1', kill as never)

    expect(work.get('tc-1')).toBeUndefined() // unchanged: not a manageable job
    // …but the owner is recorded anyway — that is what makes the gate total.
    expect(actionRegistry.get('tc-1')?.userId).toBe('u1')
    expect(actionRegistry.get('tc-1')?.sessionId).toBe('sA')
  })

  test('a background bash registrant is owner-tagged as an action AND as work', () => {
    const { registry, actionRegistry, work } = setup()
    registry.registerActions('tc-1', {
      ...kill,
      send_input: { label: 'Send', execute: () => {} },
    } as never)

    expect(work.get('tc-1')).toMatchObject({ userId: 'u1', sessionId: 'sA', kind: 'job' })
    expect(actionRegistry.get('tc-1')?.userId).toBe('u1')
  })

  test('a monitor KEEPS the id it was minted and published under', () => {
    // A monitor names itself in the WAKE that reaches the agent (`mon-1`) before `jobs` is
    // ever consulted. If the host re-labelled it `bg-1`, the wake would print an id that
    // `TaskStop` cannot resolve. The id comes from the same allocator, so it is free.
    const { registry, work } = setup()
    const minted = work.mint({ userId: 'u1', sessionId: 'sA' }, 'monitor')
    registry.registerActions('tc-1', kill as never, {
      label: `monitor ${minted}: CI 402356`,
      jobId: minted,
      kind: 'monitor',
    })

    expect(work.get('tc-1')).toMatchObject({ displayId: 'mon-1', kind: 'monitor' })
    expect(registry.getBackgroundJobId?.('tc-1')).toBe('mon-1')
  })

  test('an id is never reused after its job ends — "bg-1 finished" keeps meaning one job', () => {
    const { registry, work } = setup()
    const shell = { ...kill, send_input: { label: 'Send', execute: () => {} } } as never
    registry.registerActions('tc-1', shell)()
    registry.registerActions('tc-2', shell)
    expect(work.get('tc-2')?.displayId).toBe('bg-2')
  })

  test('records the exact PTY id before a silent background job emits output', () => {
    const { registry, work } = setup()
    registry.registerActions('tc-1', {
      ...kill,
      send_input: { label: 'Send', execute: () => {} },
    } as never)

    registry.setBackgroundJobTerminalId?.('tc-1', 'pty-1')
    expect(work.get('tc-1')?.terminalId).toBe('pty-1')
  })

  test('the actions survive the tagging — the wrapper must not swallow them', () => {
    const { registry, actionRegistry } = setup()
    registry.registerActions('tc-1', kill as never)

    expect(registry.getActions('tc-1')).toEqual(kill as never) // SDK contract: actions, untagged
    expect(Object.keys((actionRegistry.get('tc-1') as { actions: object }).actions)).toEqual([
      'kill',
    ])
  })

  test('a live item snapshot exposes descriptors and the disposer removes them', () => {
    const snapshots: unknown[][] = []
    const state = {
      pendingTools: new Map([['tc-1', { name: 'stream', input: {} }]]),
      currentPayload: {
        role: 'assistant',
        items: [
          {
            id: 'tc-1',
            toolCallId: 'tc-1',
            type: 'tool_call',
            name: 'stream',
            status: 'running',
            activeVerb: 'Streaming',
          },
        ],
      },
      assistantCreatedAt: '2026-01-01T00:00:00.000Z',
    }
    const registry = createRunAsyncRegistry({
      env: {
        state: { actionRegistry: new Map(), work: testWork() },
        persistAndPublish: (...args: unknown[]) => {
          snapshots.push(args)
          return Promise.resolve()
        },
      },
      state,
      abort: new AbortController(),
      userId: 'u1',
      session: { id: 'sA' },
      assistantMessageId: 'a1',
      childSessions: {},
      backgroundToolNames: new Set<string>(),
    } as never)

    const dispose = registry.registerActions('tc-1', {
      kill: {
        label: 'Stop stream',
        execute: () => {},
      },
    })
    expect(state.currentPayload.items[0]).toMatchObject({
      actions: [
        {
          toolCallId: 'tc-1',
          action: 'kill',
        },
      ],
    })

    dispose()
    expect(state.currentPayload.items[0]).toMatchObject({ actions: undefined })
    expect(snapshots).toHaveLength(2)
  })

  test('the disposer clears the tagged entry', () => {
    const { registry, actionRegistry } = setup()
    const dispose = registry.registerActions('tc-1', kill as never)
    dispose()
    expect(actionRegistry.has('tc-1')).toBe(false)
  })
})

/**
 * A background job is the one tool shape whose output never crosses a result boundary — `bash` returns
 * a job id immediately and every later flush arrives at `emitBackground` — and that writer rebuilds
 * the item with `buildToolItem` instead of going through the accumulator's `setTool`, so BOTH shields
 * missed it. `bash-background.ts` passes `details.command` as the EXECUTED command, which
 * `buildToolItem` prefers over the (already shielded) item input.
 */
describe('a background job is shielded on every sink it writes to', () => {
  const SECRET = 'sk-live-abcdef123456'
  const shield = (_userId: string, value: unknown) =>
    JSON.parse(JSON.stringify(value).split(SECRET).join('[vault-secret]'))

  const setup = (opts: { shielded?: boolean } = {}) => {
    const published: unknown[] = []
    const snapshots: unknown[] = []
    const tool = {
      id: 'tc-1',
      toolCallId: 'tc-1',
      type: 'command',
      name: 'Bash',
      status: 'running',
      input: { command: 'build' },
      output: '',
    }
    const registry = createRunAsyncRegistry({
      env: {
        state: { actionRegistry: new Map(), work: testWork() },
        deps: {
          streamRegistry: { publish: (...args: unknown[]) => published.push(args) },
          ...(opts.shielded ? { sanitizeToolInput: shield } : {}),
        },
        persistAndPublish: (...args: unknown[]) => {
          snapshots.push(args)
          return Promise.resolve()
        },
        queueMidRunReminder: () => {},
      },
      state: {
        pendingTools: new Map([['tc-1', { name: 'Bash', input: { command: 'build' } }]]),
        currentPayload: { role: 'assistant', items: [tool] },
        assistantCreatedAt: '2026-01-01T00:00:00.000Z',
      },
      abort: new AbortController(),
      userId: 'u1',
      session: { id: 's1' },
      assistantMessageId: 'm1',
      childSessions: {},
      backgroundToolNames: new Set<string>(),
    } as never)
    return { registry, published, snapshots }
  }

  test('the persisted snapshot carries neither the command nor the output verbatim', () => {
    const h = setup({ shielded: true })
    h.registry.emitBackground('tc-1', `connected with ${SECRET}\nlistening`, {
      done: true,
      exitCode: 0,
      details: { command: `PGPASSWORD=${SECRET} psql -h db`, terminalId: 'pty-1' },
    })
    const all = JSON.stringify(h.snapshots)
    expect(all).not.toContain(SECRET)
    // Redaction, not deletion — the diagnosable text survives on both fields.
    expect(all).toContain('psql -h db')
    expect(all).toContain('listening')
  })

  test('the streamed append is shielded too, and a split secret degrades to a snapshot', () => {
    const h = setup({ shielded: true })
    // The first flush ends mid-secret; the second completes it. Because the bookkeeping runs on the
    // REDACTED text, the growth is not a clean suffix, so the code falls back to a full snapshot
    // instead of publishing the tail of a secret as an append.
    h.registry.emitBackground('tc-1', 'token=sk-live-abc')
    h.registry.emitBackground('tc-1', `token=${SECRET} ok`)
    expect(JSON.stringify([h.published, h.snapshots])).not.toContain(SECRET)
    expect(JSON.stringify(h.published)).not.toContain('def123456')
  })

  test('without the dep the same job is raw — the defect, pinned', () => {
    const h = setup()
    h.registry.emitBackground('tc-1', `connected with ${SECRET}`, {
      done: true,
      exitCode: 0,
      details: { command: `PGPASSWORD=${SECRET} psql` },
    })
    expect(JSON.stringify(h.snapshots)).toContain(SECRET)
  })
})
