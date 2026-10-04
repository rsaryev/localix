import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { flush, triggerHarness } from '../../triggers/test-harness'
import type { WakeShape } from '../../triggers/delivery'
import { createExitNoticeAction, createExitNotices, type ExitNoticeSource } from './exit-notices'

type Harness = Awaited<ReturnType<typeof triggerHarness>>
let h: Harness
let wakes: WakeShape<ExitNoticeSource>[]

beforeEach(async () => {
  h = await triggerHarness()
  wakes = []
})
afterEach(() => h.close())

const boot = () => {
  const engine = h.engine({
    actions: [
      createExitNoticeAction(async (request) => {
        wakes.push(request)
        return { status: 'delivered' }
      }),
    ],
  })
  return { engine, notices: createExitNotices(engine, { warn: () => {} }) }
}
const arm = (notices: ReturnType<typeof boot>['notices'], restartNotice?: string) =>
  notices.arm({
    userId: 'u1',
    sessionId: 's1',
    agentId: 'lead',
    source: restartNotice ? 'bg-job' : 'hook',
    ...(restartNotice ? { restartNotice } : {}),
  })
const rows = () => h.db.selectFrom('triggers').select(['kind', 'state', 'end_reason']).execute()

describe('an exit notice', () => {
  test('is exactly one wake, keyed by its one fire, to the participant whose run started it', async () => {
    const { notices } = boot()
    const notice = await arm(notices, 'lost')
    notice!.fire('[Background job finished: build] exit=0')
    await flush()
    await flush()
    // A repeated exit report finds the trigger gone: not a second turn.
    notice!.fire('[Background job finished: build] exit=0')
    await flush()
    expect(wakes).toHaveLength(1)
    expect(wakes[0]).toMatchObject({
      source: 'bg-job',
      content: '[Background job finished: build] exit=0',
      to: { participant: 'agent:lead' },
    })
    expect(wakes[0]!.deliveryKey).toMatch(/^trg:.+:1$/)
    expect(await rows()).toEqual([{ kind: 'process-exit', state: 'ended', end_reason: 'exited' }])
  })

  test('a dismissed notice wakes nobody', async () => {
    const { notices } = boot()
    ;(await arm(notices))!.dismiss('passed')
    await flush()
    expect(wakes).toEqual([])
    expect(await rows()).toEqual([{ kind: 'process-exit', state: 'ended', end_reason: 'passed' }])
  })

  test('a restart that lost the process owes its owner ONE wake — a hook, none', async () => {
    const before = boot()
    await arm(before.notices, '[Background job bg-1 lost: build]')
    await arm(before.notices)
    const after = boot()
    await after.engine.hydrate()
    await after.engine.start()
    expect(wakes.map((wake) => wake.content)).toEqual(['[Background job bg-1 lost: build]'])
    expect((await rows()).map((row) => row.end_reason)).toEqual(['restart', 'restart'])
    // The next restart has nothing left to say.
    const third = boot()
    await third.engine.hydrate()
    await third.engine.start()
    expect(wakes).toHaveLength(1)
  })
})
