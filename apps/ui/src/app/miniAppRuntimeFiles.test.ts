import { describe, expect, it } from 'bun:test'
import type { FsChange } from '@/shared/lib/fsChangeBus'
import { watchWorkspace } from './miniAppRuntimeFiles'

function harness(live: boolean | Error = true) {
  const fsListeners = new Set<(change: FsChange) => void>()
  const reconnects = new Set<() => void>()
  const disconnects = new Set<() => void>()
  const listed: string[] = []
  const changes: Array<readonly string[] | null> = []
  const lives: boolean[] = []
  const watching = new Map<string, number>()
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  const off = watchWorkspace(
    's1',
    { onChange: (paths) => changes.push(paths), onLive: (value) => lives.push(value) },
    {
      listDirectory: async (sessionId) => {
        listed.push(sessionId)
        if (live instanceof Error) throw live
        return { live }
      },
      onFsChange: (listener) => {
        fsListeners.add(listener)
        return () => fsListeners.delete(listener)
      },
      onReconnect: (handler) => {
        reconnects.add(handler)
        return () => reconnects.delete(handler)
      },
      onDisconnect: (handler) => {
        disconnects.add(handler)
        return () => disconnects.delete(handler)
      },
      watchSession: (sessionId) => {
        watching.set(sessionId, (watching.get(sessionId) ?? 0) + 1)
        return () => watching.set(sessionId, (watching.get(sessionId) ?? 1) - 1)
      },
    },
  )
  const publish = (change: FsChange) => {
    for (const listener of fsListeners) listener(change)
  }
  const reconnect = () => {
    for (const handler of reconnects) handler()
  }
  return {
    off,
    publish,
    reconnect,
    settle,
    listed,
    changes,
    lives,
    watching,
    fsListeners,
    reconnects,
    disconnects,
    disconnect: () => {
      for (const handler of disconnects) handler()
    },
  }
}

describe('the workspace-change door a native mini app holds', () => {
  it('arms the watcher by listing the root — nothing else may have — and reports it live', async () => {
    const h = harness(true)
    await h.settle()
    expect(h.listed).toEqual(['s1'])
    expect(h.lives).toEqual([true])
    h.off()
  })

  it('passes on only its own chat’s changes; an empty list is the coarse signal', async () => {
    const h = harness(true)
    h.publish({ sessionId: 'other', paths: ['/x/a.ts'] })
    h.publish({ sessionId: 's1', paths: ['/w/a.ts', '/w'] })
    h.publish({ sessionId: 's1', paths: [] })
    expect(h.changes).toEqual([['/w/a.ts', '/w'], null])
    // A coarse signal is also how a failing watcher asks to be re-listed: re-arm and re-answer.
    await h.settle()
    expect(h.listed).toEqual(['s1', 's1'])
    h.off()
  })

  it('a reconnect may have lost events and watchers: coarse change, then re-arm', async () => {
    const h = harness(true)
    h.reconnect()
    expect(h.changes).toEqual([null])
    await h.settle()
    expect(h.listed).toEqual(['s1', 's1'])
    h.off()
  })

  it('a remote session or a failed listing is not live', async () => {
    const remote = harness(false)
    const failed = harness(new Error('offline'))
    await remote.settle()
    expect(remote.lives).toEqual([false])
    expect(failed.lives).toEqual([false])
    remote.off()
    failed.off()
  })

  // The server sends `fs.changed` only for sessions the connection declares it renders; a mini app
  // in a chat with no mounted chat pane or tree would otherwise be "live" and never hear a change.
  it('declares its chat as watched for as long as it holds the door', () => {
    const h = harness(true)
    expect(h.watching.get('s1')).toBe(1)
    h.off()
    expect(h.watching.get('s1')).toBe(0)
  })

  it('unsubscribing releases both listeners and silences a late answer', async () => {
    const h = harness(true)
    h.off()
    await h.settle()
    expect(h.fsListeners.size).toBe(0)
    expect(h.reconnects.size).toBe(0)
    expect(h.lives).toEqual([])
  })
})

describe('workspace watcher health', () => {
  it('drops liveness immediately on disconnect and restores it only after re-arm', async () => {
    const h = harness(true)
    await h.settle()
    h.disconnect()
    expect(h.lives).toEqual([true, false])
    h.reconnect()
    await h.settle()
    expect(h.lives).toEqual([true, false, true])
    h.off()
    expect(h.disconnects.size).toBe(0)
  })
  it('forwards exact entries and does not immediately re-arm an evicted watcher', async () => {
    const h = harness(true)
    await h.settle()
    h.publish({
      sessionId: 's1',
      paths: ['/w'],
      changedPaths: ['/w/.localix/resumes/new/resume.json'],
    })
    expect(h.changes).toEqual([['/w/.localix/resumes/new/resume.json']])
    h.publish({ sessionId: 's1', paths: [], live: false })
    expect(h.lives.at(-1)).toBe(false)
    await h.settle()
    expect(h.listed).toEqual(['s1'])
    h.off()
  })
})
