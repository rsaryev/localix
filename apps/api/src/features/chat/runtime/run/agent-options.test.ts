import { afterEach, beforeEach, expect, test } from 'bun:test'

import { sessionFixture } from '../../../../testing/session-fixture'
import { CHAT_RUN_PROFILE } from '../../../agent-core/run-shape'
import {
  __resetDelegationLanes,
  laneOf,
  releaseLane,
  requestLane,
} from '../../../agent-core/delegation-lanes'
import { DELEGATION_SLOT_CAP } from '../../../agent-core/delegation-budget'
import { createTaskStopTool } from '../../../agent-core/tools/agent/task-stop'
import { setAgentService } from '../agent-service-binding'
import { buildAgentOptions } from './agent-options'

const PARENT = 'parent'
const stopped: string[] = []
const started: string[] = []
const recorded: string[] = []
/** What the database says of the child that waits: `idle`, or — as seen live — `running`. */
let waitingStatus = 'idle'

/** Children c0..c(cap): the first `cap` hold a lane, the last waits behind them. */
const children = Array.from({ length: DELEGATION_SLOT_CAP + 1 }, (_, i) => `c${i}`)

beforeEach(() => {
  stopped.length = 0
  started.length = 0
  recorded.length = 0
  waitingStatus = 'idle'
  for (const child of children) requestLane(PARENT, child, () => void started.push(child))
  started.length = 0
  setAgentService({
    listDelegatedRuns: async () =>
      // As the database has it: the ones holding a lane run, the waiting one has not started.
      children.map((id, i) => ({
        sessionId: id,
        taskName: id,
        status: i < DELEGATION_SLOT_CAP ? 'running' : waitingStatus,
        level: 1,
      })),
    stopSession: async (id: string) => void stopped.push(id),
    recordChildStopped: async (_user: string, id: string) => void recorded.push(id),
  } as never)
})
afterEach(() => {
  setAgentService(null as never)
  __resetDelegationLanes()
})

function taskStop() {
  const ports = buildAgentOptions({
    userId: 'user-a',
    session: sessionFixture({ id: PARENT }),
    reportsToDelegator: false,
    agentProfile: CHAT_RUN_PROFILE,
    repo: {} as never,
    taskDelegation: {} as never,
  }).TaskStop!
  return createTaskStopTool(ports)
}

test('TaskStop withdraws a subagent that is waiting for a lane, so it never starts', async () => {
  const waiting = children[DELEGATION_SLOT_CAP]!
  expect(laneOf(waiting)?.state).toBe('queued')

  const out = await taskStop().execute(
    'call-1',
    { task_id: waiting },
    undefined,
    undefined,
    undefined,
  )

  expect(out.isError).toBeUndefined()
  expect(laneOf(waiting)).toBeUndefined()
  // The lane a running sibling frees goes to nobody: the withdrawn child does not start.
  for (const child of children.slice(0, DELEGATION_SLOT_CAP)) {
    releaseLane(child)
  }
  expect(started).toEqual([])
})

test('TaskStop on a running subagent still stops its run', async () => {
  const out = await taskStop().execute('call-1', { task_id: 'c0' }, undefined, undefined, undefined)
  expect(out.isError).toBeUndefined()
  expect(stopped).toEqual(['c0'])
})

test('a waiting subagent is withdrawn and answered as one whatever its stored status says', async () => {
  // LOCALIX-430: its row read `running`, so the first TaskStop got "Stop requested" and the
  // child was left to a second one. The lane is the only authority on who waits.
  waitingStatus = 'running'
  const waiting = children[DELEGATION_SLOT_CAP]!
  const out = await taskStop().execute(
    'call-1',
    { task_id: waiting },
    undefined,
    undefined,
    undefined,
  )
  expect(out.content).toContain('withdrawn from the queue')
  expect(laneOf(waiting)).toBeUndefined()
  expect(stopped).toEqual([])
})

test('stopping a subagent records that no report of it is owed, so the sweep stays quiet', async () => {
  const waiting = children[DELEGATION_SLOT_CAP]!
  await taskStop().execute('call-1', { task_id: waiting }, undefined, undefined, undefined)
  await taskStop().execute('call-2', { task_id: 'c0' }, undefined, undefined, undefined)
  expect(recorded).toEqual([waiting, 'c0'])
})
