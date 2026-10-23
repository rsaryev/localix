import { describe, expect, test } from 'bun:test'
import { createWsFrameConnection, createWsFrameRegistry } from '@localixai/mini-app-sdk/backend'

import { createDockerEventsWsFrame } from './index'
import type { DockerEventsFrame } from './events-contract'
import { createDockerEventsHub, parseDockerEvent, type DockerEventsChild } from './events-stream'

function fakeSpawner() {
  const children: Array<{
    child: DockerEventsChild
    write: (text: string) => void
    exit: () => void
    signals: Array<NodeJS.Signals | number | undefined>
  }> = []
  const spawn = () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    let exit!: () => void
    const exited = new Promise<void>((resolve) => (exit = resolve))
    const signals: Array<NodeJS.Signals | number | undefined> = []
    const stdout = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) })
    const finish = () => {
      try {
        controller.close()
      } catch {
        /* already closed */
      }
      exit()
    }
    const child: DockerEventsChild = {
      stdout,
      exited,
      kill: (signal) => {
        signals.push(signal)
        finish()
      },
    }
    children.push({
      child,
      write: (text) => controller.enqueue(new TextEncoder().encode(text)),
      exit: finish,
      signals,
    })
    return child
  }
  return { spawn, children }
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
const line = (fields: Record<string, unknown>) => `${JSON.stringify(fields)}\n`

describe('parseDockerEvent', () => {
  test('a container state change is a frame naming the container', () => {
    expect(
      parseDockerEvent(JSON.stringify({ Type: 'container', Action: 'die', Actor: { ID: 'abc' } })),
    ).toEqual({ kind: 'event', type: 'container', action: 'die', id: 'abc' })
  })

  test('health-check execs, foreign types and junk change nothing', () => {
    expect(parseDockerEvent(JSON.stringify({ Type: 'container', Action: 'exec_start: sh' }))).toBe(
      null,
    )
    expect(parseDockerEvent(JSON.stringify({ Type: 'plugin', Action: 'enable' }))).toBe(null)
    expect(parseDockerEvent('not json')).toBe(null)
  })
})

describe('createDockerEventsHub', () => {
  test('two followers share ONE child, and the last one to leave kills it', async () => {
    const fake = fakeSpawner()
    const hub = createDockerEventsHub({ spawn: fake.spawn, liveAfterMs: 5 })
    const seen: DockerEventsFrame[] = []
    const offA = hub.subscribe((frame) => seen.push(frame))
    const offB = hub.subscribe(() => {})
    expect(fake.children).toHaveLength(1)

    offA()
    expect(fake.children[0]!.signals).toEqual([])
    offB()
    expect(fake.children[0]!.signals).toEqual(['SIGTERM'])
    await tick(20)
    // Stopped on purpose: not restarted.
    expect(fake.children).toHaveLength(1)
  })

  test('events split across chunks arrive whole; live only after the child stayed up', async () => {
    const fake = fakeSpawner()
    const hub = createDockerEventsHub({ spawn: fake.spawn, liveAfterMs: 10 })
    const seen: DockerEventsFrame[] = []
    const off = hub.subscribe((frame) => seen.push(frame))
    expect(seen).toEqual([{ kind: 'status', status: 'down' }])

    const text = line({ Type: 'image', Action: 'pull', Actor: { ID: 'nginx' } })
    fake.children[0]!.write(text.slice(0, 7))
    fake.children[0]!.write(text.slice(7))
    await tick(25)
    expect(seen).toContainEqual({ kind: 'event', type: 'image', action: 'pull', id: 'nginx' })
    expect(seen.at(-1)).toEqual({ kind: 'status', status: 'live' })
    off()
  })

  test('a child that dies while followed reports down and is restarted', async () => {
    const fake = fakeSpawner()
    const hub = createDockerEventsHub({ spawn: fake.spawn, liveAfterMs: 1, restartDelay: () => 5 })
    const seen: DockerEventsFrame[] = []
    hub.subscribe((frame) => seen.push(frame))
    await tick(10)
    fake.children[0]!.exit()
    await tick(1)
    expect(seen.at(-1)).toEqual({ kind: 'status', status: 'down' })
    await tick(20)
    expect(fake.children).toHaveLength(2)
    hub.stopAll()
    expect(fake.children[1]!.signals).toEqual(['SIGTERM'])
  })

  test('a missing docker binary is down, not a thrown subscribe', () => {
    const hub = createDockerEventsHub({
      spawn: () => {
        throw new Error('ENOENT')
      },
      restartDelay: () => 60_000,
    })
    const seen: DockerEventsFrame[] = []
    hub.subscribe((frame) => seen.push(frame))
    expect(seen).toEqual([{ kind: 'status', status: 'down' }])
    hub.stopAll()
  })
})

describe('the k frame contribution', () => {
  test('two sockets share the hub child and receive k-tagged frames', async () => {
    const fake = fakeSpawner()
    const hub = createDockerEventsHub({ spawn: fake.spawn, liveAfterMs: 60_000 })
    const registry = createWsFrameRegistry()
    expect(registry.register(createDockerEventsWsFrame(hub))).toEqual({ status: 'registered' })
    const sent: string[][] = [[], []]
    const sockets = sent.map((frames) =>
      createWsFrameConnection(registry, (frame) => frames.push(frame), { userId: 'u' }),
    )
    for (const socket of sockets) socket.subscribe('devops:docker.events.subscribe', {})
    expect(fake.children).toHaveLength(1)

    fake.children[0]!.write(line({ Type: 'volume', Action: 'destroy', Actor: { ID: 'data' } }))
    await tick(5)
    for (const frames of sent) {
      expect(frames.at(-1)).toBe(
        `k\n${JSON.stringify({ kind: 'event', type: 'volume', action: 'destroy', id: 'data' })}`,
      )
    }
    sockets[0]!.teardown()
    expect(fake.children[0]!.signals).toEqual([])
    sockets[1]!.teardown()
    expect(fake.children[0]!.signals).toEqual(['SIGTERM'])
  })
})
