import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import {
  pidfileFor,
  readPidfile,
  reapGroup,
  reapStalePidfiles,
  writePidfile,
  type ReapOs,
} from './orphan-guard-pidfile'
import { installOrphanGuard, trackSpawnedProcess } from './orphan-guard'

const dir = tempDirPerTest('orphan-pidfile')

/** A fake OS: the given pids are alive, `tokens` are their start times, kills are recorded. */
function fakeOs(alive: number[], tokens: Record<number, string> = {}, platform = 'linux') {
  const killed: number[] = []
  const trees: number[] = []
  const os: ReapOs = {
    platform: platform as NodeJS.Platform,
    isAlive: (pid) => alive.includes(pid),
    startToken: (pid) => tokens[pid] ?? null,
    killGroup: (pgid) => void killed.push(pgid),
    killTree: (pid) => void trees.push(pid),
  }
  return { os, killed, trees }
}

describe('the pidfile', () => {
  test('round-trips groups through an atomic write', () => {
    const file = join(dir(), 'run', 'api.1.pids')
    const groups = [
      { pid: 10, token: 'Mon Oct 27 10:00:00 2026' },
      { pid: 11, token: null },
    ]
    writePidfile(file, groups)
    expect(readPidfile(file)).toEqual(groups)
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })

  test('tolerates junk lines and a missing file', () => {
    const file = join(dir(), 'api.2.pids')
    writeFileSync(file, '10|tok\n\nnope\n-3|x\n11|\n')
    expect(readPidfile(file)).toEqual([
      { pid: 10, token: 'tok' },
      { pid: 11, token: null },
    ])
    expect(readPidfile(join(dir(), 'missing'))).toEqual([])
  })
})

describe('reaping a group', () => {
  test('kills a group with no recorded token, a dead leader, or a matching start time', () => {
    const a = fakeOs([], {})
    reapGroup({ pid: 5, token: null }, a.os)
    reapGroup({ pid: 6, token: 'T' }, a.os) // leader gone: only our leftovers can hold the group
    const b = fakeOs([7], { 7: 'T' })
    reapGroup({ pid: 7, token: 'T' }, b.os)
    expect(a.killed).toEqual([5, 6])
    expect(b.killed).toEqual([7])
  })

  test('spares a live leader that started at another time: the pid was recycled', () => {
    const { os, killed } = fakeOs([8], { 8: 'later' })
    reapGroup({ pid: 8, token: 'earlier' }, os)
    expect(killed).toEqual([])
  })

  test('on Windows the whole tree is taken down with taskkill', () => {
    const { os, killed, trees } = fakeOs([], {}, 'win32')
    reapGroup({ pid: 9, token: null }, os)
    expect(trees).toEqual([9])
    expect(killed).toEqual([])
  })
})

describe('stale pidfiles', () => {
  test('a dead API is reaped and its file removed; live and own APIs are left alone', () => {
    const runDir = dir()
    writePidfile(pidfileFor(runDir, 100), [{ pid: 200, token: null }]) // dead API
    writePidfile(pidfileFor(runDir, 101), [{ pid: 201, token: null }]) // live API
    writePidfile(pidfileFor(runDir, 102), [{ pid: 202, token: null }]) // this process
    writeFileSync(join(runDir, 'notes.txt'), 'x')
    const { os, killed } = fakeOs([101, 102])

    expect(reapStalePidfiles(runDir, 102, os)).toBe(1)

    expect(killed).toEqual([200])
    expect(existsSync(pidfileFor(runDir, 100))).toBe(false)
    expect(existsSync(pidfileFor(runDir, 101))).toBe(true)
    expect(existsSync(pidfileFor(runDir, 102))).toBe(true)
    expect(existsSync(join(runDir, 'notes.txt'))).toBe(true)
  })

  test('a missing run directory is nothing to reap', () => {
    expect(reapStalePidfiles(join(dir(), 'nope'), 1, fakeOs([]).os)).toBe(0)
  })
})

describe('the guard keeps the pidfile current', () => {
  test('track and untrack rewrite it; the start time is added when read; uninstall deletes it', async () => {
    const runDir = join(dir(), 'run')
    mkdirSync(runDir)
    const file = pidfileFor(runDir, process.pid)
    const uninstall = installOrphanGuard({
      runDir,
      watchdog: false,
      startToken: async (pid) => `start-${pid}`,
    })
    const untrack = trackSpawnedProcess(424242)
    expect(readPidfile(file)).toEqual([{ pid: 424242, token: null }])
    await Promise.resolve() // let the token read settle
    await Promise.resolve()
    expect(readPidfile(file)).toEqual([{ pid: 424242, token: 'start-424242' }])

    untrack()
    expect(readPidfile(file)).toEqual([])

    uninstall()
    expect(existsSync(file)).toBe(false)
  })
})
