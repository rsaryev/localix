import * as os from 'node:os'
import { basename } from 'node:path'
import { readProcessOutputWithTimeout } from '@localixai/plugin-sdk/backend'
import type { ProcessRow, ProcessSnapshot } from '../shared/processes'

interface RawProcess {
  pid: number
  parentPid: number
  name: string
  memoryBytes: number
  memoryPercent: number
  cpuPercent: number | null
  cpuTimeSeconds?: number
}

export interface ProcessSource {
  platform: NodeJS.Platform
  now(): number
  totalMemory(): number
  logicalCores(): number
  run(command: string[]): Promise<string>
}

/**
 * Run a collector command and return its stdout.
 *
 * Through the SDK's bounded reader, not `Promise.all([pipe text, pipe text, exited])`: that waits
 * on pipe EOF, which anything the command left behind can hold open forever, and its SIGTERM
 * timeout bounded the process but not the wait. Every plugin copied from this template inherited
 * that hang.
 *
 * In the C locale: `ps` formats `%cpu`/`%mem` with the locale's decimal separator, so under
 * ru_RU or de_DE a row reads `0,5` and the parser — which, like every consumer of this output,
 * expects `0.5` — dropped every such row, leaving a process table of only the idle processes.
 * `LC_ALL` outranks every `LC_*` the user set; `LANG` covers a collector that reads only it.
 */
export async function runCollector(command: string[], timeoutMs = 5000): Promise<string> {
  const child = Bun.spawn(command, {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
  })
  const { stdout, stderr, exitCode } = await readProcessOutputWithTimeout(child, timeoutMs, {
    label: 'Process collector',
  })
  if (exitCode !== 0) throw new Error(stderr.trim() || `Process collector exited with ${exitCode}`)
  return stdout
}

const nativeSource: ProcessSource = {
  platform: process.platform,
  now: Date.now,
  totalMemory: os.totalmem,
  logicalCores: () => os.cpus().length,
  run: (command) => runCollector(command),
}

function unixRows(output: string): RawProcess[] {
  return output.split('\n').flatMap((source): RawProcess[] => {
    const match = source.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(.+)$/u)
    if (!match) return []
    return [
      {
        pid: Number(match[1]),
        parentPid: Number(match[2]),
        cpuPercent: Number(match[3]),
        memoryPercent: Number(match[4]),
        memoryBytes: Number(match[5]) * 1024,
        name: basename(match[6].trim()),
      },
    ]
  })
}

function windowsRows(output: string, totalMemory: number): RawProcess[] {
  const decoded = JSON.parse(output || '[]') as unknown
  const values = Array.isArray(decoded) ? decoded : [decoded]
  return values.flatMap((value): RawProcess[] => {
    if (!value || typeof value !== 'object') return []
    const row = value as Record<string, unknown>
    const pid = Number(row.ProcessId)
    const memoryBytes = Number(row.WorkingSetSize)
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isFinite(memoryBytes)) return []
    const name = typeof row.Name === 'string' && row.Name ? row.Name : `PID ${pid}`
    return [
      {
        pid,
        parentPid: Number(row.ParentProcessId) || 0,
        name,
        memoryBytes,
        memoryPercent: totalMemory > 0 ? (memoryBytes / totalMemory) * 100 : 0,
        cpuPercent: null,
        cpuTimeSeconds:
          (Number(row.KernelModeTime || 0) + Number(row.UserModeTime || 0)) / 10_000_000,
      },
    ]
  })
}

const WINDOWS_COMMAND = [
  'powershell.exe',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,KernelModeTime,UserModeTime | ConvertTo-Json -Compress',
]
const UNIX_COMMAND = ['ps', '-axo', 'pid=,ppid=,pcpu=,pmem=,rss=,comm=']

export function createProcessService(source: ProcessSource = nativeSource) {
  let previous = new Map<number, { cpu: number; at: number }>()
  async function read(): Promise<ProcessSnapshot> {
    const now = source.now()
    const totalMemory = source.totalMemory()
    const raw =
      source.platform === 'win32'
        ? windowsRows(await source.run(WINDOWS_COMMAND), totalMemory)
        : unixRows(await source.run(UNIX_COMMAND))
    const next = new Map<number, { cpu: number; at: number }>()
    const processes = raw.map((row): ProcessRow => {
      let cpuPercent = row.cpuPercent
      if (row.cpuTimeSeconds !== undefined) {
        const prior = previous.get(row.pid)
        if (prior && now > prior.at) {
          cpuPercent = Math.max(
            0,
            ((row.cpuTimeSeconds - prior.cpu) /
              ((now - prior.at) / 1000) /
              Math.max(1, source.logicalCores())) *
              100,
          )
        }
        next.set(row.pid, { cpu: row.cpuTimeSeconds, at: now })
      }
      return {
        pid: row.pid,
        parentPid: row.parentPid,
        name: row.name,
        cpuPercent,
        memoryBytes: row.memoryBytes,
        memoryPercent: row.memoryPercent,
      }
    })
    previous = next
    processes.sort(
      (a, b) => (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1) || b.memoryBytes - a.memoryBytes,
    )
    return { capturedAt: new Date(now).toISOString(), processes: processes.slice(0, 500) }
  }
  return { read }
}
export type ProcessService = ReturnType<typeof createProcessService>
