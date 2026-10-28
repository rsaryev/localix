/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'

import { testWork } from '../../../../testing/work-fixture'
import { buildJobsTool } from './jobs-tool'
import type { RuntimeState } from '../agent-runner-state'
import type { RunnerDeps } from '../agent-runner-types'

/**
 * The HOST half of the jobs guard.
 *
 * `jobs.ts` now refuses an id this session does not own, so this file asserts the second
 * layer independently: the background-jobs map is PROCESS-WIDE, and `readJob` looked its
 * argument up in it with no filter while every sibling accessor
 * (`listJobs`/`resolveJobId`/`runAction`) filtered. The module's own header promises
 * "every accessor here is scoped to THIS user + session". Cross-USER was already stopped
 * one layer further down by `terminalService.get(userId, …)`; cross-SESSION was not — and
 * on a single-user install that is every other chat's live terminal.
 *
 * What this suite actually measures: the boundary is now closed TWICE, and it holds with
 * either layer removed. Verified by neutering them in turn — tool guard off → these still
 * pass (the host refuses); host guard off → these still pass (the tool refuses); BOTH off
 * → two of them fail. So it is a defence-in-depth assertion over the pair, not an isolated
 * host-layer test; reaching the host closure alone would mean intercepting what
 * `buildJobsTool` hands `createJobsTool`.
 */
function harness() {
  const reads: Array<{ userId: string; terminalId: string }> = []
  const work: RuntimeState['work'] = testWork()
  const job = (
    toolCallId: string,
    userId: string,
    sessionId: string,
    displayId: string,
    pty: string,
  ) => {
    work.start({
      owner: { userId, sessionId },
      kind: 'job',
      label: 'dev',
      toolCallId,
      messageId: null,
      displayId,
    })
    work.setTerminal(toolCallId, pty)
  }
  job('mine', 'u1', 's1', 'bg-1', 't-mine')
  job('other-session', 'u1', 's2', 'bg-2', 't-other')
  job('other-user', 'u2', 's3', 'bg-3', 't-foreign')

  const deps = {
    readTerminalJob: (args: { userId: string; terminalId: string }) => {
      reads.push(args)
      return { output: 'SECRET=hunter2', running: true }
    },
    streamRegistry: { publish: () => {} },
  } as unknown as RunnerDeps

  const tool = buildJobsTool({
    deps,
    work,
    userId: 'u1',
    sessionId: 's1',
    runAction: () => true,
  })
  return { tool, reads }
}

/** The `readJob` closure the host handed the tool, reached through the tool's own read. */
const read = (tool: ReturnType<typeof harness>['tool'], jobId: string) =>
  tool.execute('t', { action: 'read', job_id: jobId } as never)

describe('the host jobs accessors are session-scoped', () => {
  test("reading another SESSION's job returns nothing and never touches its terminal", async () => {
    const { tool, reads } = harness()
    const res = await read(tool, 'other-session')

    expect(res.isError).toBe(true)
    expect(res.content).not.toContain('hunter2')
    // The terminal read must not even be attempted — otherwise containment would rest on
    // how defensive the terminal service happens to be.
    expect(reads).toEqual([])
  })

  test("reading another USER's job is refused at this layer, not just the one below", async () => {
    const { tool, reads } = harness()
    const res = await read(tool, 'other-user')

    expect(res.isError).toBe(true)
    expect(reads).toEqual([])
  })

  test('this session reads its OWN job, addressed either way', async () => {
    // The guard must not break the feature: both the short jobId we hand the model and
    // the internal toolCallId still work.
    for (const id of ['bg-1', 'mine']) {
      const { tool, reads } = harness()
      const res = await read(tool, id)
      expect({ id, isError: res.isError }).toEqual({ id, isError: undefined })
      expect(res.content).toContain('hunter2')
      expect(reads).toEqual([{ userId: 'u1', terminalId: 't-mine' }])
    }
  })

  test('list shows only this session, which is where the model learns valid ids', async () => {
    const { tool } = harness()
    const res = await tool.execute('t', { action: 'list' } as never)
    expect(res.content).toContain('bg-1')
    expect(res.content).not.toContain('bg-2')
    expect(res.content).not.toContain('bg-3')
  })
})
