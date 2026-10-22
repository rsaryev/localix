import { expect, test } from 'bun:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { ModsApi, Next } from '@localixai/claude-plugin/mods'
import type { Endpoint } from './endpoint'
import { createCalls } from './stand-in'

/** The host's side of calls into a mod's instance: abandoned calls, and whose context runs. */

function endpointNeverAnswering() {
  const notes: Array<[string, unknown]> = []
  const waiting: AbortSignal[] = []
  const endpoint: Endpoint = {
    request: (_type, _payload, signal) =>
      new Promise((_resolve, reject) => {
        if (signal) waiting.push(signal)
        signal?.addEventListener('abort', () => reject(signal.reason as Error), { once: true })
      }),
    notify: (type, payload) => void notes.push([type, payload]),
    receive: () => {},
    close: () => {},
  }
  return { endpoint, notes, waiting }
}

function nextWith(controller: AbortController): Next {
  return Object.assign(() => Promise.resolve(undefined), {
    signal: controller.signal,
    origin: { plugin: 'p', tier: 'user' as const },
    budget: { ms: 1000, remainingMs: 1000 },
    to: () => Promise.resolve(undefined),
  }) as unknown as Next
}

test('an abandoned call stops waiting on the instance at once, and is closed', async () => {
  const { endpoint, notes, waiting } = endpointNeverAnswering()
  const calls = createCalls(endpoint)
  const controller = new AbortController()
  const hook = calls.standIn({ id: 1, generator: false })
  const running = hook({} as ModsApi, {}, nextWith(controller)) as Promise<unknown>
  expect(calls.get(1)).toBeDefined()
  expect(waiting).toHaveLength(1)
  controller.abort(new Error('the hook was skipped'))
  await expect(running).rejects.toThrow('the hook was skipped')
  expect(calls.get(1)).toBeUndefined()
  expect(notes).toEqual([['abort', { call: 1 }]])
})

test("what an instance asks runs in its call's own context, whichever call is running now", async () => {
  const { endpoint } = endpointNeverAnswering()
  const calls = createCalls(endpoint)
  const scene = new AsyncLocalStorage<string>()
  const hook = calls.standIn({ id: 1, generator: false })
  const open = (name: string) =>
    scene.run(name, () => void hook({} as ModsApi, {}, nextWith(new AbortController())))
  open('conversation A')
  open('conversation B')
  const seen = scene.run('conversation B', () => [
    calls.within(1, () => scene.getStore()),
    calls.within(2, () => scene.getStore()),
    // A call never issued runs in no context of the host's.
    calls.within(99, () => scene.getStore()),
  ])
  expect(seen).toEqual(['conversation A', 'conversation B', 'conversation B'])
  expect(calls.within(99, () => scene.getStore())).toBeUndefined()
})
