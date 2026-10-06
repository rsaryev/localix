/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'
import { createJobsTool, type JobsToolDeps, type RunningJob } from './jobs'

function makeDeps(jobs: RunningJob[], runOk = true) {
  const actions: Array<{ id: string; action: string; payload?: unknown }> = []
  const deps: JobsToolDeps = {
    listJobs: () => jobs,
    runAction: (toolCallId, action, payload) => {
      actions.push({ id: toolCallId, action, payload })
      return runOk
    },
    now: () => 10_000,
  }
  return { deps, actions }
}

const run = (deps: JobsToolDeps, input: Record<string, unknown>) =>
  createJobsTool(deps).execute('t', input as never)

const job = (id: string, startedAt = 0, jobId?: string): RunningJob => ({
  toolCallId: id,
  jobId,
  command: `cmd-${id}`,
  startedAt,
})

describe('jobs tool', () => {
  test('list with no jobs', async () => {
    const { deps } = makeDeps([])
    expect((await run(deps, { action: 'list' })).content).toBe('No background jobs are running.')
  })

  test('list formats each job with elapsed seconds and short job ids', async () => {
    const { deps } = makeDeps([job('long-tool-call-id', 5_000, 'bg-1')]) // now=10000 → 5s
    const res = await run(deps, { action: 'list' })
    expect(res.content).toContain('bg-1')
    expect(res.content).toContain('cmd-long-tool-call-id')
    expect(res.content).toContain('5s')
  })

  test('stop/send_input require a job_id', async () => {
    const { deps } = makeDeps([job('j1')])
    expect((await run(deps, { action: 'stop' })).isError).toBe(true)
    expect((await run(deps, { action: 'send_input', input: 'x' })).isError).toBe(true)
  })

  test('rejects an unknown job id', async () => {
    const { deps, actions } = makeDeps([job('j1')])
    const res = await run(deps, { action: 'stop', job_id: 'ghost' })
    expect(res.isError).toBe(true)
    expect(res.content).toContain('No running job with id ghost')
    expect(actions).toHaveLength(0) // never dispatched
  })

  test('stop accepts a short job id and dispatches against the tool call id', async () => {
    const { deps, actions } = makeDeps([job('long-tool-call-id', 0, 'bg-1')])
    const res = await run(deps, { action: 'stop', job_id: 'bg-1' })
    expect(actions[0]).toMatchObject({ id: 'long-tool-call-id', action: 'kill' })
    // A stop is REQUESTED, never confirmed from here: the action is a void closure, and for
    // a process it means SIGTERM with SIGKILL held back. Saying "stopped" made the model
    // stop polling and reason as though the work were gone.
    expect(res.content).toContain('Stop requested for job bg-1')
    expect(res.content).toContain('not confirmed gone')
    expect(res.isError).toBe(false)
  })

  test('a failed action is reported as an error', async () => {
    const { deps } = makeDeps([job('j1')], false)
    const res = await run(deps, { action: 'stop', job_id: 'j1' })
    expect(res.isError).toBe(true)
    expect(res.content).toContain('Could not request a stop for job j1')
  })

  test('send_input requires input text and forwards it', async () => {
    const { deps, actions } = makeDeps([job('j1')])
    expect((await run(deps, { action: 'send_input', job_id: 'j1' })).isError).toBe(true) // no text
    const res = await run(deps, { action: 'send_input', job_id: 'j1', input: 'hello' })
    expect(actions[actions.length - 1]).toMatchObject({
      id: 'j1',
      action: 'send_input',
      payload: { text: 'hello' },
    })
    expect(res.content).toContain('Input sent to job j1')
    expect(res.content).toContain('not confirmed')
  })
})

describe('a job id this session does not own', () => {
  /**
   * `resolveJobId` deliberately returns null for an id belonging to another session, but
   * the id chain then fell through to `input.job_id` RAW, and the ownership membership
   * check sat AFTER the `read` branch — so it guarded stop/send_input and not read. The
   * host's `readJob` looked the id up in the PROCESS-WIDE background-jobs map with no
   * user/session filter, so a sub-agent, delegated task run or cron subsession could read
   * another chat's live PTY scrollback: dev-server output, a job's console, whatever env
   * that process echoed at startup. jobs-tool.ts's own header claims "every accessor here
   * is scoped to THIS user + session".
   */
  const foreign = 'tool-call-of-another-session'

  function deniedDeps() {
    const reads: string[] = []
    const { deps, actions } = makeDeps([job('mine', 0, 'bg-1')])
    return {
      actions,
      reads,
      deps: {
        ...deps,
        // What the real host does for a non-owned id.
        resolveJobId: () => null,
        readJob: (toolCallId: string) => {
          reads.push(toolCallId)
          return { output: 'SECRET=hunter2\n$ ', running: true }
        },
      } satisfies JobsToolDeps,
    }
  }

  test('read is refused, and the host is never asked for it', async () => {
    const { deps, reads } = deniedDeps()
    const res = await run(deps, { action: 'read', job_id: foreign })

    expect(res.isError).toBe(true)
    expect(res.content).toContain(foreign)
    expect(res.content).not.toContain('hunter2')
    // The strong assertion: the refusal happens BEFORE the host lookup, so a leak cannot
    // depend on how defensive the host happens to be.
    expect(reads).toEqual([])
  })

  test('stop and send_input stay refused too', async () => {
    for (const action of ['stop', 'send_input'] as const) {
      const { deps, actions } = deniedDeps()
      const res = await run(deps, {
        action,
        job_id: foreign,
        ...(action === 'send_input' ? { input: 'y\n' } : {}),
      })
      expect({ action, isError: res.isError }).toEqual({ action, isError: true })
      expect(actions).toEqual([])
    }
  })

  test('a job this session DOES own is still readable', async () => {
    // The guard must not break the feature it protects.
    const { deps, reads } = deniedDeps()
    const res = await run(
      { ...deps, resolveJobId: () => 'mine' },
      { action: 'read', job_id: 'bg-1' },
    )

    expect(res.isError).toBeFalsy()
    expect(res.content).toContain('hunter2')
    expect(reads).toEqual(['mine'])
  })
})

/**
 * `action:"read"` exists to show a running job's output, so its cap has to say what it dropped. It used
 * to prepend a bare `…` — no line count, no total, no next step — on the one call whose whole purpose is
 * inspecting that output. `tool_output` already gets this right ("clipped at N chars").
 */
describe('read states what it clipped', () => {
  const bigOutput = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n')

  const readDeps = (output: string): JobsToolDeps => ({
    listJobs: () => [job('tc-1', 0, 'bg-1')],
    runAction: () => true,
    now: () => 10_000,
    readJob: () => ({ output, running: true }),
  })

  test('a clipped read names the dropped lines and the real total', async () => {
    const res = await run(readDeps(bigOutput), { action: 'read', job_id: 'bg-1' })
    const text = String((res as { content?: string }).content ?? '')
    expect(text).toMatch(/truncated \d[\d,]* lines/)
    expect(text).toMatch(/of 5000 lines/)
    // Not a bare ellipsis where the notice should be.
    expect(text).not.toMatch(/\]\n…\n/)
    // The TAIL survives, so a late error is never the part that is cut.
    expect(text).toContain('line 4999')
  })

  test('an unclipped read carries no marker at all', async () => {
    const res = await run(readDeps('short and complete'), { action: 'read', job_id: 'bg-1' })
    const text = String((res as { content?: string }).content ?? '')
    expect(text).toContain('short and complete')
    expect(text).not.toContain('truncated')
  })
})

describe('jobs classify', () => {
  const tool = createJobsTool(makeDeps([]).deps)
  test.each([
    ['list', { effect: 'read' }],
    ['read', { effect: 'read' }],
    ['send_input', { effect: 'external' }],
    ['stop', { effect: 'session', irreversible: true }],
    ['unknown', { effect: 'external' }],
  ] as const)('%s', (action, expected) => {
    expect(tool.classify?.({ action })).toEqual(expected)
  })

  test('a missing input is external, never read', () => {
    expect(tool.classify?.(undefined)).toEqual({ effect: 'external' })
  })
})

describe('PTY routing and current observations', () => {
  const deps = () => ({
    ...makeDeps([{ ...job('tc-1', 0, 'bg-1'), terminalId: 'pty-1' }]).deps,
    readJob: () => ({ output: 'logs', running: true }),
  })

  test('PTY input points at named keys and a fresh screen with the exact id', async () => {
    const tool = createJobsTool(deps(), { terminalInput: true })
    const result = await tool.execute(
      'call',
      {
        action: 'send_input',
        job_id: 'bg-1',
        input: 'hello',
      },
      undefined,
      undefined,
      undefined,
    )
    expect(result.content).toContain('terminal_id="pty-1"')
    expect(result.content).toContain('keys:["Enter"]')
    expect(result.content).not.toContain('hello')
  })

  test('logs supersede previous reads and distinguish logs from the screen', async () => {
    const result = await createJobsTool(deps(), { terminalInput: true }).execute(
      'call',
      {
        action: 'read',
        job_id: 'bg-1',
      },
      undefined,
      undefined,
      undefined,
    )
    expect(result.supersedeKey).toBe('job:tc-1')
    expect(result.content).toContain('current TUI screen')
    expect(result.content).toContain('logs')
  })

  test('runs without terminal actions are not directed to an unavailable capability', async () => {
    const result = await createJobsTool(deps()).execute(
      'call',
      {
        action: 'read',
        job_id: 'bg-1',
      },
      undefined,
      undefined,
      undefined,
    )
    expect(result.content).not.toContain('bash action=')
    expect(result.content).not.toContain('terminal_id')
  })
})
