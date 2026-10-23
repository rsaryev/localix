import { describe, expect, test } from 'bun:test'

import { createMemoryWorkRepository } from '../../../work/testing/memory-repository'
import { createWorkRegistry } from '../../../work/registry'
import type { ActionRegistryEntry } from '../agent-runner-state'
import { routedParticipants, sessionFixture } from '../../../../testing/session-fixture'
import { endSubagentWork, subagentWorkKey, trackChildRun, trackSubagent } from './subagent-work'

const owner = { userId: 'u', sessionId: 'parent' }

function fixture() {
  const repo = createMemoryWorkRepository()
  const work = createWorkRegistry({ repo })
  const actionRegistry = new Map<string, ActionRegistryEntry>()
  const stopped: string[] = []
  const track = (childSessionId: string) =>
    trackSubagent(
      { work, actionRegistry },
      {
        owner,
        agentId: 'builtin:lead',
        childSessionId,
        label: `qa · LX-${childSessionId}`,
        stop: () => void stopped.push(childSessionId),
      },
    )
  return { repo, work, actionRegistry, stopped, track }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

describe('a detached sub-agent is background work', () => {
  test('it is listed as sub-N with its child session, beside jobs, and is not a job slot', async () => {
    const { work, track } = fixture()
    track('c1')
    work.start({
      owner,
      agentId: null,
      kind: 'job',
      label: 'bun dev',
      toolCallId: 'call-1',
      messageId: null,
    })
    const listed = work.list(owner)
    expect(listed.map((record) => [record.displayId, record.kind, record.childSessionId])).toEqual([
      ['sub-1', 'subagent', 'c1'],
      ['bg-1', 'job', null],
    ])
    // The job cap counts processes; the delegation budget bounds children.
    expect(work.count(owner)).toBe(1)
  })

  test('Stop goes through the owner-tagged action registry and stops the child', async () => {
    const { actionRegistry, stopped, track } = fixture()
    track('c1')
    const entry = actionRegistry.get(subagentWorkKey('c1'))
    expect(entry).toMatchObject({ userId: 'u', sessionId: 'parent' })
    entry!.actions.kill!.execute()
    await settle()
    expect(stopped).toEqual(['c1'])
  })

  test("the child's terminal status lands on the record, once", async () => {
    const { repo, work, actionRegistry, track } = fixture()
    const statuses: Record<string, string | null> = {
      done: 'completed',
      broke: 'failed',
      halted: 'stopped',
      unread: null,
    }
    const tracked = Object.keys(statuses).map((id) => [id, track(id)] as const)
    for (const [id, handle] of tracked) handle.end(statuses[id]!)
    // A later end (the continuation's finally) does not overwrite the first.
    for (const [, handle] of tracked) handle.end('completed')
    await settle()
    expect(work.list(owner)).toEqual([])
    expect(actionRegistry.size).toBe(0)
    const byChild = Object.fromEntries(
      [...repo.rows.values()].map((row) => [row.childSessionId, row.status]),
    )
    expect(byChild).toEqual({
      done: 'succeeded',
      broke: 'failed',
      halted: 'cancelled',
      unread: 'failed',
    })
  })

  test('a child the process died under is lost after restart, and its id is not reissued', async () => {
    const { repo, track } = fixture()
    track('c1')
    await settle()
    const restarted = createWorkRegistry({ repo })
    const lost = await restarted.hydrate()
    expect(lost.map((record) => [record.displayId, record.status])).toEqual([['sub-1', 'lost']])
    expect(restarted.mint(owner, 'subagent')).toBe('sub-2')
  })
})

/**
 * EVERY run of a delegated child shows in its parent's work strip with a Stop — not only the run
 * the delegation launched. A child woken again by a message used to run with no row and no Stop.
 */
describe('each run of a delegated child is tracked', () => {
  const child = sessionFixture({
    id: 'child',
    title: 'Audit',
    sessionKind: 'subagent',
    parentSessionId: 'parent',
    agents: routedParticipants({ agentId: 'builtin:qa', handle: 'qa' }),
    provenance: {
      kind: 'task-delegation',
      parentSessionId: 'parent',
      toolCallId: 'tc',
      parentParticipant: 'agent:builtin:lead',
    },
  })

  test('a run opens a sub-N row owned by the delegating session, under the delegating agent', () => {
    const { work, actionRegistry } = fixture()
    trackChildRun({ work, actionRegistry }, 'u', child)
    const [row] = work.list(owner)
    expect(row).toMatchObject({
      kind: 'subagent',
      childSessionId: 'child',
      agentId: 'builtin:lead',
      label: 'qa',
    })
    expect(actionRegistry.get(subagentWorkKey('child'))?.actions.kill).toBeDefined()
  })

  test('a second segment of the same run opens nothing; the next run after its end opens again', () => {
    const { work, actionRegistry } = fixture()
    const deps = { work, actionRegistry }
    trackChildRun(deps, 'u', child)
    trackChildRun(deps, 'u', child)
    expect(work.list(owner)).toHaveLength(1)
    endSubagentWork(deps, 'child', 'completed')
    expect(work.list(owner)).toHaveLength(0)
    trackChildRun(deps, 'u', child)
    expect(work.list(owner)).toHaveLength(1)
  })

  test('a closed child, a chat and a job open nothing', () => {
    const { work, actionRegistry } = fixture()
    const deps = { work, actionRegistry }
    trackChildRun(deps, 'u', { ...child, closedAt: '2026-10-01' })
    trackChildRun(deps, 'u', sessionFixture({ id: 'chat' }))
    trackChildRun(deps, 'u', sessionFixture({ id: 'job', sessionKind: 'job' }))
    expect(work.list(owner)).toEqual([])
  })
})
