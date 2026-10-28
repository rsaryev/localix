import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AgentSessionsService } from './service'
import type { WatchPath } from './live/history-watch'

/**
 * The roster's history watch must run on the HOST's watcher once the boot load handed it over.
 * Bun's own recursive fs.watch on macOS drops most of a burst, and while the roster believes it is
 * live it polls only every few minutes — so falling back to it silently made a finished turn
 * invisible for that long.
 */
describe('external agents: history watching', () => {
  test('arms on the host watcher handed over by the boot load, even after construction', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ea-home-'))
    await mkdir(join(home, '.claude', 'projects'), { recursive: true })
    const service = new AgentSessionsService(await mkdtemp(join(tmpdir(), 'ea-svc-')), () => {}, {
      env: {},
      homeDir: home,
    })

    const watched: string[] = []
    const hostWatch: WatchPath = (path) => {
      watched.push(path)
      return () => {}
    }
    // Per-run loads carry no host services; they must not drop the boot load's watcher.
    service.setPathWatch(hostWatch)
    service.setPathWatch(undefined)

    const frames: unknown[] = []
    const live = Promise.withResolvers<void>()
    const unsubscribe = service.history.subscribe((frame) => {
      frames.push(frame)
      if ('live' in frame && frame.live) live.resolve()
    })
    await live.promise
    unsubscribe()

    expect(watched).toContain(join(home, '.claude', 'projects'))
    expect(frames).toContainEqual({ live: true })
  })
})
