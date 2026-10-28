import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createBoardService } from './service'
import { createBoardWsFrames } from './ws-frames'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A service whose ownership check admits only `u1`'s session `s1`, like the host's. */
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'kanban-ws-'))
  roots.push(root)
  const boards = createBoardService({
    resolveDir: async (userId, sessionId) => {
      if (userId !== 'u1' || sessionId !== 's1') throw new Error('Session not found')
      return join(root, sessionId)
    },
  })
  const [stream] = createBoardWsFrames(boards)
  return { boards, stream: stream! }
}

const settle = () => turns()

describe('board live stream', () => {
  test('streams the owner’s board changes', async () => {
    const { boards, stream } = setup()
    const frames: string[] = []
    stream.start({ sessionId: 's1' }, (data) => frames.push(data), { userId: 'u1' })
    await settle()
    await boards.create({ userId: 'u1', sessionId: 's1' }, { title: 'x' }, 'user')
    expect(frames.map((frame) => JSON.parse(frame).type)).toEqual(['task.created'])
  })

  test('streams nothing to a socket whose user does not own the chat', async () => {
    const { boards, stream } = setup()
    const frames: string[] = []
    stream.start({ sessionId: 's1' }, (data) => frames.push(data), { userId: 'intruder' })
    await settle()
    await boards.create({ userId: 'u1', sessionId: 's1' }, { title: 'x' }, 'user')
    expect(frames).toEqual([])
  })

  test('a stop that arrives before the ownership check settles still releases the stream', async () => {
    const { boards, stream } = setup()
    const frames: string[] = []
    const handle = stream.start({ sessionId: 's1' }, (data) => frames.push(data), { userId: 'u1' })
    stream.stop(handle)
    await settle()
    await boards.create({ userId: 'u1', sessionId: 's1' }, { title: 'x' }, 'user')
    expect(frames).toEqual([])
  })

  test('keys one stream per session', () => {
    const { stream } = setup()
    expect(stream.key?.({ sessionId: 's1' })).toBe('s1')
    expect(stream.key?.({})).toBe('invalid')
  })
})
