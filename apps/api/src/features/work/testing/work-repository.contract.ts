/**
 * The behaviour every WorkRepository must have — the database one and the in-memory one that
 * stands in for it in other features' tests. Each runs this suite, so the fake cannot drift from
 * the real thing unseen. A host supplies `make`, which returns a fresh repository whose sessions
 * `s1` and `s2` already exist.
 */
import { describe, expect, test } from 'bun:test'

import type { WorkRecord } from '../contracts'
import type { WorkRepository } from '../repository'

const record = (id: string, patch: Partial<WorkRecord> = {}): WorkRecord => ({
  id,
  userId: 'u1',
  sessionId: 's1',
  displayId: `bg-${id}`,
  kind: 'job',
  label: id,
  status: 'running',
  exitCode: null,
  toolCallId: `tc-${id}`,
  messageId: null,
  terminalId: null,
  childSessionId: null,
  eventCount: 0,
  lastEvent: null,
  lastEventAt: null,
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: null,
  ...patch,
})

export function describeWorkRepositoryContract(
  name: string,
  make: () => Promise<WorkRepository> | WorkRepository,
) {
  describe(`${name} honours the work repository contract`, () => {
    test('an end lands only on running work, and the first end stands', async () => {
      const repo = await make()
      await repo.insert(record('a'))
      await repo.end('a', { status: 'failed', exitCode: 2, endedAt: '2026-01-01T00:01:00.000Z' })
      await repo.end('a', { status: 'succeeded', exitCode: 0, endedAt: '2026-01-01T00:02:00.000Z' })
      expect(await repo.loseRunning('2026-01-01T00:03:00.000Z', [])).toEqual([])
      await repo.insert(record('b'))
      await repo.end('missing', { status: 'failed', exitCode: 1, endedAt: 'x' })
      expect((await repo.listRunning(['job'])).map((r) => r.id)).toEqual(['b'])
    })

    test('ids spent stay spent: the high-water mark is per session and prefix', async () => {
      const repo = await make()
      await repo.insert(record('a', { displayId: 'bg-2' }))
      await repo.insert(record('b', { displayId: 'bg-10' }))
      await repo.insert(record('c', { displayId: 'mon-1', kind: 'monitor' }))
      await repo.insert(record('d', { sessionId: 's2', displayId: 'bg-1' }))
      await repo.end('b', { status: 'succeeded', exitCode: 0, endedAt: 'x' })
      const marks = await repo.highWaterMarks()
      const sorted = [...marks].sort((x, y) =>
        `${x.sessionId}${x.prefix}`.localeCompare(`${y.sessionId}${y.prefix}`),
      )
      expect(sorted).toEqual([
        { sessionId: 's1', prefix: 'bg', n: 10 },
        { sessionId: 's1', prefix: 'mon', n: 1 },
        { sessionId: 's2', prefix: 'bg', n: 1 },
      ])
    })

    test('losing running work marks it lost, spares the named kinds and answers what it was', async () => {
      const repo = await make()
      await repo.insert(record('a'))
      await repo.insert(record('b', { displayId: 'mon-1', kind: 'monitor' }))
      await repo.insert(record('c', { displayId: 'bg-9' }))
      await repo.end('c', { status: 'succeeded', exitCode: 0, endedAt: 'x' })
      const lost = await repo.loseRunning('2026-02-02T00:00:00.000Z', ['monitor'])
      expect(lost.map((r) => [r.id, r.status, r.endedAt])).toEqual([
        ['a', 'lost', '2026-02-02T00:00:00.000Z'],
      ])
      expect((await repo.listRunning(['job', 'monitor'])).map((r) => r.id)).toEqual(['b'])
    })

    test('running work is listed by kind, oldest first, and no kinds list nothing', async () => {
      const repo = await make()
      await repo.insert(record('late', { startedAt: '2026-01-01T00:00:09.000Z' }))
      await repo.insert(record('early', { startedAt: '2026-01-01T00:00:01.000Z' }))
      await repo.insert(record('mon', { kind: 'monitor' }))
      expect((await repo.listRunning(['job'])).map((r) => r.id)).toEqual(['early', 'late'])
      expect(await repo.listRunning([])).toEqual([])
    })

    test('a terminal and the events a monitor has seen are recorded on the row', async () => {
      const repo = await make()
      await repo.insert(record('a'))
      await repo.setTerminal('a', 'term-1')
      await repo.recordEvents('a', { eventCount: 3, lastEvent: 'ready', lastEventAt: 't' })
      const [row] = await repo.listRunning(['job'])
      expect(row).toMatchObject({
        terminalId: 'term-1',
        eventCount: 3,
        lastEvent: 'ready',
        lastEventAt: 't',
      })
    })

    test('a second record of the same id is refused, never merged', async () => {
      const repo = await make()
      await repo.insert(record('a'))
      await expect(repo.insert(record('a', { label: 'again' }))).rejects.toThrow()
    })
  })
}
