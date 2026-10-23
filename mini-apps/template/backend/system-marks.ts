import { randomUUID } from 'node:crypto'
import { SYSTEM_MARKS_LIMIT, systemMarksSchema, type SystemMarks } from '../shared/system-marks'
import { openJsonStore } from './store'
import type { SystemReader } from './system'

/**
 * Marks: a note pinned to the machine's CPU and memory at one moment — "before the build",
 * "closed Docker" — so a later sample has something to be compared with.
 *
 * The view adds them and the agent adds them with `system_mark`, and both go through this one
 * store under the mini app's data folder: each sees the other's marks, and they outlive the pane,
 * the session and the app.
 */
export function createSystemMarks(dataDir: string, read: SystemReader, now = () => new Date()) {
  const store = openJsonStore({
    dir: dataDir,
    file: 'marks.json',
    schema: systemMarksSchema,
    initial: { marks: [] },
  })
  return {
    list: (): Promise<SystemMarks> => store.read(),
    add: (note: string): Promise<SystemMarks> =>
      store.update(({ marks }) => {
        const sample = read()
        const mark = {
          id: randomUUID(),
          note,
          at: now().toISOString(),
          cpuPercent: sample.cpu.usagePercent,
          memoryUsedBytes: sample.memory.usedBytes,
        }
        return { marks: [...marks, mark].slice(-SYSTEM_MARKS_LIMIT) }
      }),
    remove: (id: string): Promise<SystemMarks> =>
      store.update(({ marks }) => ({ marks: marks.filter((mark) => mark.id !== id) })),
  }
}

export type SystemMarksService = ReturnType<typeof createSystemMarks>
