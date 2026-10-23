import * as os from 'node:os'
import type { SystemSnapshot } from '../shared/system'

export interface SystemSource {
  platform(): string
  release(): string
  arch(): string
  uptime(): number
  cpus(): os.CpuInfo[]
  totalmem(): number
  freemem(): number
  now(): number
  runtimeVersion(): string
  runtimeUptime(): number
  residentMemory(): number
}

const nativeSource: SystemSource = {
  ...os,
  now: Date.now,
  runtimeVersion: () => Bun.version,
  runtimeUptime: () => process.uptime(),
  residentMemory: () => process.memoryUsage().rss,
}

/** CPU counters work on Windows too; load averages there are always zero. */
export function cpuPercent(previous: os.CpuInfo, current: os.CpuInfo): number | null {
  const total = (cpu: os.CpuInfo) => Object.values(cpu.times).reduce((sum, value) => sum + value, 0)
  const elapsed = total(current) - total(previous)
  const idle = current.times.idle - previous.times.idle
  if (elapsed <= 0 || idle < 0 || idle > elapsed) return null
  return Math.round((1 - idle / elapsed) * 1000) / 10
}

/** No shell, background timer, hostname, user names, paths or network addresses. */
export function createSystemReader(source: SystemSource = nativeSource) {
  let cached: SystemSnapshot | null = null
  let previous: os.CpuInfo[] | null = null
  let sampledAt = -Infinity
  return (): SystemSnapshot => {
    const now = source.now()
    if (cached && now >= sampledAt && now - sampledAt < 1000) return cached
    const cpus = source.cpus()
    const samples =
      previous?.length === cpus.length
        ? cpus.map((cpu, index) => cpuPercent(previous![index], cpu))
        : []
    const cores =
      samples.length > 0 && samples.every((value) => value !== null) ? (samples as number[]) : null
    const totalBytes = Math.max(0, source.totalmem())
    const freeBytes = Math.min(totalBytes, Math.max(0, source.freemem()))
    const platform = source.platform()
    cached = {
      capturedAt: new Date(now).toISOString(),
      os: {
        name:
          ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' } as Record<string, string>)[
            platform
          ] ?? platform,
        platform,
        release: source.release(),
        architecture: source.arch(),
        uptimeSeconds: source.uptime(),
      },
      cpu: {
        model: cpus[0]?.model.trim() || 'Unavailable',
        logicalCores: cpus.length,
        usagePercent: cores
          ? Math.round((cores.reduce((sum, value) => sum + value, 0) / cores.length) * 10) / 10
          : null,
        cores,
      },
      memory: { totalBytes, freeBytes, usedBytes: totalBytes - freeBytes },
      runtime: {
        name: 'Bun',
        version: source.runtimeVersion(),
        uptimeSeconds: source.runtimeUptime(),
        memoryBytes: source.residentMemory(),
      },
    }
    sampledAt = now
    previous = cpus
    return cached
  }
}

export type SystemReader = ReturnType<typeof createSystemReader>
