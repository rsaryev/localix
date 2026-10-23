import { z } from 'zod'
import { nonnegative } from './schema'

export const SYSTEM_URI = 'localix://resource/template/system'
export const systemSnapshotSchema = z.object({
  capturedAt: z.string(),
  os: z.object({
    name: z.string(),
    platform: z.string(),
    release: z.string(),
    architecture: z.string(),
    uptimeSeconds: nonnegative,
  }),
  cpu: z.object({
    model: z.string(),
    logicalCores: nonnegative.int(),
    usagePercent: z.number().min(0).max(100).nullable(),
    cores: z.array(z.number().min(0).max(100)).nullable(),
  }),
  memory: z.object({ totalBytes: nonnegative, freeBytes: nonnegative, usedBytes: nonnegative }),
  runtime: z.object({
    name: z.literal('Bun'),
    version: z.string(),
    uptimeSeconds: nonnegative,
    memoryBytes: nonnegative,
  }),
})
export type SystemSnapshot = z.infer<typeof systemSnapshotSchema>

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`
  return `${(bytes / 1024 ** 2).toFixed(0)} MiB`
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

/** How long ago something happened, in the words a status line uses. */
export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  return `${formatUptime(seconds)} ago`
}

/** One compact, timestamped description shared by the UI binding and backend resolver. */
export function formatSystemSnapshot(snapshot: SystemSnapshot): string {
  return [
    `Localix backend system snapshot at ${snapshot.capturedAt} (not the browser device).`,
    `OS: ${snapshot.os.name}; platform: ${snapshot.os.platform}; kernel: ${snapshot.os.release}; architecture: ${snapshot.os.architecture}.`,
    `CPU: ${snapshot.cpu.model}; ${snapshot.cpu.logicalCores} logical cores; utilization: ${snapshot.cpu.usagePercent === null ? 'awaiting a second sample' : `${snapshot.cpu.usagePercent.toFixed(1)}%`}.`,
    `Memory: ${formatBytes(snapshot.memory.usedBytes)} used / ${formatBytes(snapshot.memory.totalBytes)} total; ${formatBytes(snapshot.memory.freeBytes)} free. Used = total − free, including OS caches.`,
    `System uptime: ${formatUptime(snapshot.os.uptimeSeconds)}.`,
    `Runtime: Bun ${snapshot.runtime.version}; process uptime: ${formatUptime(snapshot.runtime.uptimeSeconds)}; resident memory: ${formatBytes(snapshot.runtime.memoryBytes)}.`,
    'Read-only system information. Utilization is sampled; these values are not a diagnosis.',
  ].join('\n')
}
