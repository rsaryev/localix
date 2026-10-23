import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cameraHub } from './camera-hub'
import { createSpaceWsFrames } from './ws-frames'
import { spaceStore } from './space-store'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('authorized project changes notify every subscribed chat after saving, and stop releases them', async () => {
  const root = mkdtempSync(join(tmpdir(), 'space-stream-'))
  roots.push(root)
  const resolutions: string[] = []
  const {
    wsFrames: [stream],
  } = createSpaceWsFrames({
    resolveSessionRoot: async (userId, sessionId) => {
      resolutions.push(`${userId}:${sessionId}`)
      return userId === 'owner' ? root : null
    },
  })
  const messages: Array<{ sessionId: string; revision: string }> = []
  const send = (json: string) => messages.push(JSON.parse(json))
  const a = stream!.start({ sessionId: 'a', userId: 'spoofed' }, send, { userId: 'owner' })
  const b = stream!.start({ sessionId: 'b' }, send, { userId: 'owner' })
  const foreign = stream!.start({ sessionId: 'a', userId: 'owner' }, send, { userId: 'foreign' })
  await Promise.resolve()
  expect(resolutions).toEqual(['owner:a', 'owner:b', 'foreign:a'])
  const created = await spaceStore.apply(root, [{ op: 'create', type: 'note', id: 'n' }], 'agent')
  expect(messages).toEqual([
    { sessionId: 'a', revision: created.snapshot.revision },
    { sessionId: 'b', revision: created.snapshot.revision },
  ])
  await spaceStore.apply(root, [{ op: 'create', type: 'note', id: 'n' }], 'user')
  expect(messages).toHaveLength(2) // A refusal saves nothing and announces nothing.
  stream!.stop(a)
  await spaceStore.apply(root, [{ op: 'delete', id: 'n' }], 'user')
  expect(messages.at(-1)?.sessionId).toBe('b')
  expect(messages).toHaveLength(3)
  stream!.stop(b)
  stream!.stop(foreign)
  await spaceStore.step(root, 0, 'user')
  expect(messages).toHaveLength(3)
})

test('stopping before ownership resolution cannot leak a subscription', async () => {
  const root = mkdtempSync(join(tmpdir(), 'space-stream-stop-'))
  roots.push(root)
  let resolve!: (root: string) => void
  const {
    wsFrames: [stream],
  } = createSpaceWsFrames({
    resolveSessionRoot: () =>
      new Promise((done) => {
        resolve = done
      }),
  })
  const messages: string[] = []
  const handle = stream!.start({ sessionId: 'a' }, (json) => messages.push(json), {
    userId: 'owner',
  })
  stream!.stop(handle)
  resolve(root)
  await Promise.resolve()
  await spaceStore.apply(root, [{ op: 'create', type: 'note' }], 'user')
  expect(messages).toEqual([])
})

test('backend shutdown releases active streams and pending ownership resolutions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'space-stream-shutdown-'))
  roots.push(root)
  let resolve!: (root: string) => void
  const backend = createSpaceWsFrames({
    resolveSessionRoot: (_userId, sessionId) =>
      sessionId === 'pending'
        ? new Promise((done) => {
            resolve = done
          })
        : Promise.resolve(root),
  })
  const [stream] = backend.wsFrames
  const messages: string[] = []
  const send = (json: string) => messages.push(json)
  const active = stream!.start({ sessionId: 'active' }, send, { userId: 'owner' })
  const pending = stream!.start({ sessionId: 'pending' }, send, { userId: 'owner' })
  await Promise.resolve()
  backend.onShutdown()
  resolve(root)
  await Promise.resolve()
  await spaceStore.apply(root, [{ op: 'create', type: 'note' }], 'user')
  expect(messages).toEqual([])
  stream!.stop(active)
  stream!.stop(pending)
})

test('the camera stream pushes the authorized chat its moves, a fresh one on start, and only while followed', async () => {
  const {
    wsFrames: [, camera],
  } = createSpaceWsFrames({
    resolveSessionRoot: async (userId) => (userId === 'owner' ? '/project' : null),
  })
  const sent = cameraHub.send('cam-a', { kind: 'zoom', zoom: 2 })
  const frames: unknown[] = []
  const foreign: unknown[] = []
  const handle = camera!.start({ sessionId: 'cam-a' }, (json) => frames.push(JSON.parse(json)), {
    userId: 'owner',
  })
  const spoof = camera!.start({ sessionId: 'cam-a' }, (json) => foreign.push(json), {
    userId: 'foreign',
  })
  await Promise.resolve()
  expect(frames).toEqual([
    { sessionId: 'cam-a', camera: { seq: sent, move: { kind: 'zoom', zoom: 2 } } },
  ])
  expect(cameraHub.listening('cam-a')).toBe(true)
  const next = cameraHub.send('cam-a', { kind: 'pan', x: 0.5, y: 0 })
  expect(frames.at(-1)).toEqual({
    sessionId: 'cam-a',
    camera: { seq: next, move: { kind: 'pan', x: 0.5, y: 0 } },
  })
  camera!.stop(handle)
  camera!.stop(spoof)
  expect(cameraHub.listening('cam-a')).toBe(false)
  cameraHub.send('cam-a', { kind: 'zoom', zoom: 1 })
  expect(frames).toHaveLength(2)
  expect(foreign).toEqual([])
})
