import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isAlive } from '../../lib/process-tree'
import { reapStaleServer, recordServer } from './stale-server'

const dirs: string[] = []
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})
const temp = async () => {
  const d = await mkdtemp(path.join(tmpdir(), 'localix-stale-'))
  dirs.push(d)
  return d
}

describe.skipIf(process.platform === 'win32')('reapStaleServer', () => {
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
      const pidFile = path.join(dir, 'router.pid')
      await recordServer(pidFile, stranger.pid)
      expect(await reapStaleServer(pidFile, marker)).toBe(false)
      expect(isAlive(stranger.pid)).toBe(true)

      await recordServer(pidFile, ours.pid)
      expect(await reapStaleServer(pidFile, marker)).toBe(true)
      await Promise.race([ours.exited, Bun.sleep(3000)])
      expect(isAlive(ours.pid)).toBe(false)
    } finally {
      ours.kill('SIGKILL')
      stranger.kill('SIGKILL')
    }
  }, 10_000)

  test('a missing or garbage pid file is nothing to reap', async () => {
    const dir = await temp()
    expect(await reapStaleServer(path.join(dir, 'none.pid'), 'x')).toBe(false)
    await writeFile(path.join(dir, 'bad.pid'), 'not a pid')
    expect(await reapStaleServer(path.join(dir, 'bad.pid'), 'x')).toBe(false)
  })
})
