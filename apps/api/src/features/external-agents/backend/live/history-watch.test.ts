import { describe, expect, test } from 'bun:test'
import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { HistoryFrame } from '../../shared/history-stream'
import { createHistoryWsFrames } from '../history-frames'
import { HistoryWatch, watchFiles, type WatchPath } from './history-watch'

/** A watcher the test fires by hand, recording what was armed and what was closed. */
function fakeWatch() {
  const armed: Array<{ path: string; recursive: boolean; fire: (name: string | null) => void }> = []
  let closed = 0
  const watchPath: WatchPath = (path, recursive, onEvent) => {
    armed.push({ path, recursive, fire: onEvent })
    return () => {
      closed += 1
    }
  }
  return { watchPath, armed, closed: () => closed }
}

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(frames: HistoryFrame[], wanted: HistoryFrame, timeoutMs = 3_000) {
  const started = Date.now()
  while (!frames.some((f) => JSON.stringify(f) === JSON.stringify(wanted))) {
    if (Date.now() - started > timeoutMs) throw new Error(`no ${JSON.stringify(wanted)}`)
    await settle(20)
  }
}

describe('the history watch', () => {
  test('a line appended deep in a real history root is pushed, without anyone polling', async () => {
    // The roster re-enumerated every root on a timer to learn this; the watch is told instead.
    const root = await mkdtemp(join(tmpdir(), 'ea-watch-'))
    const project = join(root, '-work-app')
    await mkdir(project, { recursive: true })
    const watch = new HistoryWatch(async () => [{ path: root, exists: true }], { windowMs: 50 })
    const frames: HistoryFrame[] = []
    const off = watch.subscribe((frame) => frames.push(frame))
    await until(frames, { live: true })
    await appendFile(join(project, 'session.jsonl'), '{"type":"user"}\n')
    await until(frames, { changed: true })
    off()
  })

  test('a burst of writes is one notice per window', async () => {
    const fake = fakeWatch()
    const root = await mkdtemp(join(tmpdir(), 'ea-burst-'))
    const watch = new HistoryWatch(async () => [{ path: root, exists: true }], {
      windowMs: 40,
      watchPath: fake.watchPath,
    })
    const frames: HistoryFrame[] = []
    watch.subscribe((frame) => frames.push(frame))
    await until(frames, { live: true })
    for (let i = 0; i < 25; i++) fake.armed[0]!.fire('a.jsonl')
    await settle(120)
    expect(frames.filter((f) => 'changed' in f)).toHaveLength(1)
    watch.close()
  })

  test('a database root watches its folder for its own name, WAL included', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ea-db-'))
    const db = join(dir, 'opencode.db')
    await writeFile(db, '')
    const fake = fakeWatch()
    const watch = new HistoryWatch(async () => [{ path: db, exists: true }], {
      windowMs: 10,
      watchPath: fake.watchPath,
    })
    const frames: HistoryFrame[] = []
    watch.subscribe((frame) => frames.push(frame))
    await until(frames, { live: true })
    expect(fake.armed[0]).toMatchObject({ path: dir, recursive: false })
    fake.armed[0]!.fire('unrelated.log')
    await settle(40)
    expect(frames.some((f) => 'changed' in f)).toBe(false)
    fake.armed[0]!.fire('opencode.db-wal')
    await until(frames, { changed: true })
    watch.close()
  })

  test('nothing watchable is reported as not live, so the panel keeps its own cadence', async () => {
    const watch = new HistoryWatch(async () => [{ path: '/nowhere', exists: false }])
    const frames: HistoryFrame[] = []
    watch.subscribe((frame) => frames.push(frame))
    await until(frames, { live: false })
    watch.close()
  })

  test('the last listener leaving closes every watcher; a closed panel watches nothing', async () => {
    const fake = fakeWatch()
    const root = await mkdtemp(join(tmpdir(), 'ea-close-'))
    const watch = new HistoryWatch(async () => [{ path: root, exists: true }], {
      watchPath: fake.watchPath,
    })
    const frames: HistoryFrame[] = []
    const first = watch.subscribe((frame) => frames.push(frame))
    await until(frames, { live: true })
    const late: HistoryFrame[] = []
    const second = watch.subscribe((frame) => late.push(frame))
    expect(late).toEqual([{ live: true }])
    first()
    expect(fake.closed()).toBe(0)
    second()
    expect(fake.closed()).toBe(1)
  })
})

describe('the realtime contribution', () => {
  test('a subscribed socket is sent the watch’s frames and released on stop', async () => {
    const fake = fakeWatch()
    const root = await mkdtemp(join(tmpdir(), 'ea-frames-'))
    const watch = new HistoryWatch(async () => [{ path: root, exists: true }], {
      windowMs: 10,
      watchPath: fake.watchPath,
    })
    const { wsFrames } = createHistoryWsFrames(() => watch)
    const sent: string[] = []
    const handle = wsFrames[0]!.start({}, (data) => sent.push(data), { userId: 'u1' })
    await settle(30)
    expect(sent).toEqual([JSON.stringify({ live: true })])
    wsFrames[0]!.stop(handle)
    expect(fake.closed()).toBe(1)
  })
})

describe('watching the logs a wait tails', () => {
  test('a change to a watched log calls back once per burst', async () => {
    const fake = fakeWatch()
    let calls = 0
    const off = watchFiles(['/a.jsonl', '/b.jsonl'], () => (calls += 1), {
      windowMs: 20,
      watchPath: fake.watchPath,
    })
    fake.armed[0]!.fire(null)
    fake.armed[1]!.fire(null)
    await settle(60)
    expect(calls).toBe(1)
    off()
    expect(fake.closed()).toBe(2)
  })
})
