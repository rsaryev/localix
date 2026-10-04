import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AgentSessionsService } from './service'

/**
 * A fresh list of stale states was the shape this had before the host exposed a terminal reader.
 *
 * The panel re-fetches the roster every few seconds while something is running, but a delegation's
 * state came from whatever the model last happened to screen — so the list moved and the states did
 * not. The same gap that made `wait` unable to see what it waited for, one surface over.
 */
async function serviceWithLiveDelegation(screenText: string | null) {
  // An EMPTY history home. What is under test is the live half — one screen read per running
  // delegation — and none of it involves a transcript on disk. Left to default, each case scanned
  // the developer's real agent history from a cold cache: 3.2 s here, and enough to tip this case
  // past its timeout under full-suite load while passing on its own.
  const home = await mkdtemp(join(tmpdir(), 'ea-home-'))
  const service = new AgentSessionsService(await mkdtemp(join(tmpdir(), 'ea-svc-')), () => {}, {
    env: {},
    homeDir: home,
  })
  await service.start()
  service.live.open({ terminalId: 't1', localixSessionId: 's1', provider: 'claude-code' })
  const reads: string[] = []
  service.setTerminalRead({
    async screen({ terminalId }) {
      reads.push(terminalId)
      return screenText === null
        ? null
        : { text: screenText, cursor: { row: 0, col: 0 }, cols: 80, rows: 24 }
    },
    async finalScreen() {
      return null
    },
    list() {
      return []
    },
  })
  return { service, reads }
}

const APPROVAL = 'enter to select \u00b7 esc to cancel \u00b7 \u2191\u2193 to navigate'

describe('the roster reads its live rows', () => {
  test('a state that changed since the model last looked is reflected', async () => {
    const { service } = await serviceWithLiveDelegation(APPROVAL)
    expect(service.live.get('t1')?.state).toBe('unknown')

    const roster = await service.roster({ limit: 50 }, 's1')
    const live = roster.items.find((row) => row.terminalId === 't1')
    expect(live?.state).toBe('blocked')
  })

  test('one read per live delegation, not per row in the list', async () => {
    // The cost has to stay bounded by what is RUNNING, not by how much history exists.
    const { service, reads } = await serviceWithLiveDelegation(APPROVAL)
    await service.roster({ limit: 50 }, 's1')
    expect(reads).toEqual(['t1'])
  })

  test('a pane that cannot be read leaves the row as it was', async () => {
    // Not this session's terminal, or gone between listing and reading — neither is a reason to
    // fail a roster, and its own close observation will arrive through the hook.
    const { service } = await serviceWithLiveDelegation(null)
    const roster = await service.roster({ limit: 50 }, 's1')
    expect(roster.items.find((row) => row.terminalId === 't1')?.state).toBe('unknown')
  })
})
