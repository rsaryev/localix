import { z } from 'zod'
import { nonnegative } from './schema'

export const processRowSchema = z.object({
  pid: z.number().int().positive(),
  parentPid: z.number().int().nonnegative(),
  name: z.string(),
  cpuPercent: z.number().min(0).nullable(),
  memoryBytes: nonnegative,
  memoryPercent: z.number().min(0).max(100),
})
export const processSnapshotSchema = z.object({
  capturedAt: z.string(),
  processes: z.array(processRowSchema),
})
export type ProcessRow = z.infer<typeof processRowSchema>
export type ProcessSnapshot = z.infer<typeof processSnapshotSchema>

export function formatProcessSnapshot(snapshot: ProcessSnapshot, limit = 100): string {
  const rows = snapshot.processes
    .slice(0, limit)
    .map(
      (row) =>
        `${row.pid}\t${row.parentPid}\t${row.cpuPercent === null ? '—' : `${row.cpuPercent.toFixed(1)}%`}\t${(row.memoryBytes / 1024 ** 2).toFixed(0)} MiB\t${row.memoryPercent.toFixed(1)}%\t${row.name}`,
    )
  return [
    `Backend processes at ${snapshot.capturedAt}; sorted by CPU.`,
    'PID\tPPID\tCPU\tMEMORY\tMEMORY %\tNAME',
    ...rows,
    snapshot.processes.length > limit
      ? `${snapshot.processes.length - limit} more processes omitted.`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}
