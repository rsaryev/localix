/**
 * The orphan guard's on-disk record of tracked process groups.
 *
 * `process.on('exit')` cannot run on SIGKILL, so the in-memory set dies with the API and a
 * detached child (llama-server, a background job) is reparented to PID 1. The record outlives
 * us: one file per API process, `api.<pid>.pids`, one line per tracked group, `<pgid>|<token>`.
 * The token is the leader's start time (`ps -o lstart=`), empty until it is read. A watchdog
 * (orphan-guard-watchdog.ts) and the next API start both read it and SIGKILL the groups.
 *
 * Pid reuse: a pid is killed only when its group is not provably someone else's. A live leader
 * must carry the recorded start time. A dead leader is fine: a pid cannot be recycled while a
 * group with that number still has members, so `kill(-pgid)` then reaches only our own leftovers
 * (and fails harmlessly when there are none — the bare pid is never signalled).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isAlive } from './process-tree'

export const PIDFILE_SUFFIX = '.pids'

export interface RecordedGroup {
  pid: number
  /** Start time of the leader when recorded; null when it was not (yet) known. */
  token: string | null
}

export const pidfileFor = (runDir: string, apiPid: number): string =>
  join(runDir, `api.${apiPid}${PIDFILE_SUFFIX}`)

/** `ps` output differs in padding between platforms; compare it whitespace-normalised. */
export const normalizeToken = (raw: string): string | null =>
  raw.trim().split(/\s+/).join(' ') || null

/** Start time of a live process, or null (no such process, no `ps`, Windows). */
export function readStartToken(pid: number): string | null {
  if (process.platform === 'win32') return null
  try {
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
    return normalizeToken(out)
  } catch {
    return null
  }
}

/** Replace the file's contents atomically, so a reader never sees half a list. */
export function writePidfile(file: string, groups: readonly RecordedGroup[]): void {
  try {
    mkdirSync(join(file, '..'), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, groups.map((g) => `${g.pid}|${g.token ?? ''}\n`).join(''))
    renameSync(tmp, file)
  } catch {
    // Best effort: failing to record must never fail the spawn that is being tracked.
  }
}

export function removePidfile(file: string): void {
  rmSync(file, { force: true })
}

export function readPidfile(file: string): RecordedGroup[] {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const groups: RecordedGroup[] = []
  for (const line of text.split('\n')) {
    const [rawPid, token] = line.split('|')
    const pid = Number(rawPid)
    if (Number.isInteger(pid) && pid > 0) groups.push({ pid, token: token?.trim() || null })
  }
  return groups
}

/** What stale reaping needs from the OS; tests pass their own. */
export interface ReapOs {
  platform: NodeJS.Platform
  isAlive: (pid: number) => boolean
  startToken: (pid: number) => string | null
  /** SIGKILL the group `-pgid` only — never the bare pid. */
  killGroup: (pgid: number) => void
  /** Windows: `taskkill /F /T /PID`. */
  killTree: (pid: number) => void
}

export const REAL_REAP_OS: ReapOs = {
  platform: process.platform,
  isAlive,
  startToken: readStartToken,
  killGroup: (pgid) => {
    try {
      process.kill(-pgid, 'SIGKILL')
    } catch {
      /* no such group */
    }
  },
  killTree: (pid) => {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true })
  },
}

/** Whether the recorded group is still the one we started (see the file header). */
export function isOurGroup(group: RecordedGroup, os: ReapOs): boolean {
  if (group.token === null) return true
  const current = os.startToken(group.pid)
  return current === null || current === group.token
}

export function reapGroup(group: RecordedGroup, os: ReapOs = REAL_REAP_OS): void {
  if (os.platform === 'win32') return os.killTree(group.pid)
  if (isOurGroup(group, os)) os.killGroup(group.pid)
}

/**
 * Kill everything recorded by API processes that no longer exist, then delete their files.
 * Returns how many files it cleared. The caller's own file and live APIs' files are untouched.
 */
export function reapStalePidfiles(
  runDir: string,
  ownPid: number,
  os: ReapOs = REAL_REAP_OS,
): number {
  let names: string[]
  try {
    names = readdirSync(runDir)
  } catch {
    return 0
  }
  let cleared = 0
  for (const name of names) {
    const match = /^api\.(\d+)\.pids$/.exec(name)
    if (!match) continue
    const apiPid = Number(match[1])
    if (apiPid === ownPid || os.isAlive(apiPid)) continue
    const file = join(runDir, name)
    for (const group of readPidfile(file)) reapGroup(group, os)
    removePidfile(file)
    cleared++
  }
  return cleared
}
