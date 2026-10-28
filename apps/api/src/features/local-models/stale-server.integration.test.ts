import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isAlive } from '../../lib/process-tree'
import { reapServerPid } from './stale-server'

const dirs: string[] = []
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})
const temp = async () => {
  const d = await mkdtemp(path.join(tmpdir(), 'localix-stale-'))
  dirs.push(d)
  return d
}

describe.skipIf(process.platform === 'win32')('reaping a router left behind', () => {
  test('kills a recorded process that is still ours, and only that one', async () => {
    const dir = await temp()
    const marker = path.join(dir, 'presets.ini')
    const idle = 'setTimeout(() => {}, 30000)'
    const ours = Bun.spawn([process.execPath, '-e', idle, marker], {
      detached: true,
      windowsHide: true,
    })
    const stranger = Bun.spawn([process.execPath, '-e', idle], {
      detached: true,
      windowsHide: true,
    })
    try {
      expect(await reapServerPid(stranger.pid, marker)).toBe(false)
      expect(isAlive(stranger.pid)).toBe(true)

      expect(await reapServerPid(ours.pid, marker)).toBe(true)
      await ours.exited
      expect(isAlive(ours.pid)).toBe(false)
    } finally {
      ours.kill('SIGKILL')
      stranger.kill('SIGKILL')
    }
  }, 10_000)
})
