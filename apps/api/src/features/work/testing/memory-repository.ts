/**
 * A work repository that keeps rows in this process — for a host where nothing must outlive it
 * (a unit test, an embedded runner). It honours the same contract as the database one: an end
 * only lands on running work, and ids spent stay spent.
 */
import type { WorkRecord } from '../contracts'
import type { WorkRepository } from '../repository'

export function createMemoryWorkRepository(): WorkRepository & { rows: Map<string, WorkRecord> } {
  const rows = new Map<string, WorkRecord>()
  return {
    rows,
    async insert(record) {
      rows.set(record.id, { ...record })
    },
    async setTerminal(id, terminalId) {
      const row = rows.get(id)
      if (row) row.terminalId = terminalId
    },
    async end(id, end) {
      const row = rows.get(id)
      if (row?.status === 'running') Object.assign(row, end)
    },
    async highWaterMarks() {
      const marks = new Map<string, { sessionId: string; prefix: string; n: number }>()
      for (const row of rows.values()) {
        const [prefix = '', digits = '0'] = row.displayId.split('-')
        const key = `${row.sessionId}:${prefix}`
        const n = Math.max(Number(digits), marks.get(key)?.n ?? 0)
        marks.set(key, { sessionId: row.sessionId, prefix, n })
      }
      return [...marks.values()]
    },
    async recordEvents(id, seen) {
      const row = rows.get(id)
      if (row) Object.assign(row, seen)
    },
    async loseRunning(endedAt, spare) {
      const lost: WorkRecord[] = []
      for (const row of rows.values())
        if (row.status === 'running' && !spare.includes(row.kind)) {
          Object.assign(row, { status: 'lost', endedAt })
          lost.push({ ...row })
        }
      return lost
    },
    async listRunning(kinds) {
      return [...rows.values()]
        .filter((row) => row.status === 'running' && kinds.includes(row.kind))
        .map((row) => ({ ...row }))
    },
  }
}
