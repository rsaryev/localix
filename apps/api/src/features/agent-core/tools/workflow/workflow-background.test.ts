import { describe, expect, test } from 'bun:test'
import type { AsyncToolRegistry, ToolAction } from '@localixai/agent/agents'
import { createScriptSandbox } from '@localixai/engine-scripts'
import { tempDirPerTest } from '@localixai/testing'

import { createWorkflowRunStore } from './journal'
import { createWorkflowTool, type WorkflowToolPort } from './workflow'

/**
 * A workflow run as Claude Code runs one: in the background, reporting when it ends, under an id
 * a stopped run is resumed by — its completed agents then return their saved results.
 */
const scripts = createScriptSandbox()
const dir = tempDirPerTest('workflow-runs-')

const AUDIT = `export const meta = { name: 'audit', description: 'Audit files' }
phase('Audit')
return parallel(args.files.map((file) => () => agent('audit ' + file, { label: file })))`

function port(answer: (prompt: string) => Promise<string | null> | string | null) {
  const ran: string[] = []
  const fake: WorkflowToolPort = {
    scripts,
    list: async () => [{ fullName: 'acme:audit', description: 'Audit', file: '/p/audit.js' }],
    read: async () => AUDIT,
    runAgent: async (_call, _workflow, request) => {
      ran.push(request.prompt)
      const text = await answer(request.prompt)
      return text === null ? null : { text, tokens: 10 }
    },
    runs: createWorkflowRunStore(dir()),
  }
  return { fake, ran }
}

function registry() {
  const emitted: Array<{ output: string; opts?: Record<string, unknown> }> = []
  const registered: Array<{ actions: Record<string, ToolAction>; options?: unknown }> = []
  let finished = () => {}
  const done = new Promise<void>((resolve) => (finished = resolve))
  const fake: AsyncToolRegistry = {
    registerActions: (_id, actions, options) => {
      registered.push({ actions, options })
      return () => {}
    },
    getActions: () => undefined,
    getBackgroundJobId: () => 'bg-1',
    countBackgroundJobs: () => 0,
    emitBackground: (_id, output, opts) => {
      emitted.push({ output, ...(opts ? { opts } : {}) })
      if (opts?.done) finished()
    },
  }
  return { fake, emitted, registered, done }
}

const signal = new AbortController().signal
const input = { name: 'acme:audit', args: { files: ['a.ts', 'b.ts'] } }

describe('a workflow in the background', () => {
  test('the call returns at once; the end is emitted with notify, the result in it', async () => {
    const { fake } = port((prompt) => `ok ${prompt}`)
    const jobs = registry()
    const result = await createWorkflowTool(fake).execute('call-1', input, signal, undefined, {
      asyncRegistry: jobs.fake,
    })
    expect(result.content).toContain('is running in the background')
    expect(result.content).toContain('job_id: bg-1')
    expect(result.details).toMatchObject({ background: true, runId: expect.stringMatching(/^wf-/) })
    expect(jobs.registered[0]?.options).toMatchObject({ notify: true })
    await jobs.done
    const end = jobs.emitted.at(-1)!
    expect(end.opts).toMatchObject({ done: true, jobStatus: 'completed', notify: true })
    expect(end.output).toContain('Workflow acme:audit finished (2 agents, 20 output tokens)')
    expect(end.output).toContain('"ok audit a.ts"')
    // Progress lines reached the card while it ran.
    expect(jobs.emitted.some((emit) => emit.output.includes('## Audit'))).toBe(true)
  })

  test('Stop ends the run as killed; a resume then replays what completed', async () => {
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    const first = port(async (prompt) =>
      prompt.endsWith('b.ts') ? (await held, null) : `ok ${prompt}`,
    )
    // The person stops the run once a.ts is journaled, while b.ts still works.
    const store = first.fake.runs!
    let aJournaled = () => {}
    const aDone = new Promise<void>((resolve) => (aJournaled = resolve))
    first.fake.runs = {
      ...store,
      record: (id, entry) => {
        store.record(id, entry)
        if (entry.value === 'ok audit a.ts') aJournaled()
      },
    }
    const jobs = registry()
    const started = await createWorkflowTool(first.fake).execute('c1', input, signal, undefined, {
      asyncRegistry: jobs.fake,
    })
    const runId = (started.details as { runId: string }).runId
    // While it runs, it cannot be resumed.
    const busy = await createWorkflowTool(first.fake).execute(
      'c2',
      {
        ...input,
        resumeFromRunId: runId,
      },
      signal,
    )
    expect(busy.content).toContain('is still running')
    await aDone
    jobs.registered[0]!.actions.kill!.execute()
    release()
    await jobs.done
    expect(jobs.emitted.at(-1)?.opts).toMatchObject({ jobStatus: 'killed' })

    const second = port((prompt) => `new ${prompt}`)
    second.fake.runs = store
    const resumed = await createWorkflowTool(second.fake).execute(
      'c3',
      { name: 'acme:audit', resumeFromRunId: runId },
      signal,
    )
    // args come from the stopped run; a.ts is replayed, b.ts (stopped mid-run) runs again.
    expect(second.ran).toEqual(['audit b.ts'])
    expect(resumed.content).toContain('1 replayed from the resumed run')
    expect(resumed.content).toContain('"ok audit a.ts"')
    expect(resumed.content).toContain('"new audit b.ts"')
  })

  test('nothing to resume: an unknown run id is refused', async () => {
    const { fake, ran } = port(() => 'x')
    const result = await createWorkflowTool(fake).execute(
      'c',
      { ...input, resumeFromRunId: 'wf-000000000000' },
      signal,
    )
    expect(result).toMatchObject({ isError: true })
    expect(result.content).toContain('Nothing to resume')
    expect(ran).toEqual([])
  })

  test('budget becomes the script’s budget.total', async () => {
    const { fake } = port(() => 'x')
    fake.read = async () =>
      `export const meta = { name: 'audit', description: 'd' }\nreturn budget.total`
    const result = await createWorkflowTool(fake).execute(
      'c',
      { name: 'acme:audit', budget: 500_000 },
      signal,
    )
    expect(result.content).toContain('Result:\n500000')
  })
})
