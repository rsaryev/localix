import { describe, expect, test } from 'bun:test'

import { INERT_CC_HOOKS, type CcHooksRuntime } from '../../../cc-hooks'
import type { RunPolicy } from '../../policy/run-policy'
import type { SessionRecord } from '../../repository'
import { runTeammateIdle } from './teammate-idle'

const session = {
  id: 's',
  agents: [{ agentId: 'a2', handle: 'researcher' }],
} as unknown as SessionRecord
const seat = (role: string) => ({ seat: { role } }) as unknown as RunPolicy

function hooks(verdict: Awaited<ReturnType<CcHooksRuntime['runTeammateIdle']>>) {
  const seen: unknown[] = []
  const runtime: CcHooksRuntime = {
    ...INERT_CC_HOOKS,
    active: true,
    runTeammateIdle: async (teammate) => {
      seen.push(teammate)
      return verdict
    },
  }
  return { runtime, seen }
}

describe('TeammateIdle', () => {
  test('a member going quiet is asked, by its handle; exit 2 keeps it working', async () => {
    const h = hooks({ blocked: true, reason: 'build first' })
    expect(await runTeammateIdle(h.runtime, seat('member'), session, 'a2', () => {})).toEqual({
      keepWorking: 'build first',
    })
    expect(h.seen).toEqual([{ name: 'researcher', agentId: 'a2' }])
  })

  test('continue:false stops the member, said as a notice', async () => {
    const h = hooks({ blocked: false, stopReason: 'enough' })
    const notices: string[] = []
    expect(
      await runTeammateIdle(h.runtime, seat('member'), session, 'a2', (m) => notices.push(m)),
    ).toEqual({ stopped: true })
    expect(notices).toEqual(['enough'])
  })

  test('the leader and a lone agent are no teammates', async () => {
    const h = hooks({ blocked: true })
    for (const role of ['leader', 'solo'])
      expect(await runTeammateIdle(h.runtime, seat(role), session, 'a2', () => {})).toEqual({})
    expect(h.seen).toEqual([])
  })
})
