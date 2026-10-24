import { describe, expect, it } from 'bun:test'

import type { CcHookHandler } from './contracts'
import { MAX_MODEL_HOOKS_AT_ONCE, runInParallel } from './runtime-parallel'

const handler = (kind: CcHookHandler['kind'], command: string): CcHookHandler => ({
  source: 'plugin',
  command,
  kind,
  timeoutMs: 1000,
})

describe('runInParallel', () => {
  it('runs twelve prompt or agent hooks at once and the rest as they finish, results in order', async () => {
    const handlers = Array.from({ length: 14 }, (_, i) =>
      handler(i % 2 ? 'agent' : 'prompt', `${i}`),
    )
    handlers.push(handler('command', 'cmd'))
    let running = 0
    let most = 0
    const releases: (() => void)[] = []
    const done = runInParallel(handlers, async (h) => {
      running += 1
      most = Math.max(most, running)
      if (h.kind !== 'command') await new Promise<void>((resolve) => releases.push(resolve))
      running -= 1
      return h.command
    })
    // Let every slot start, then release the waiting hooks one by one.
    for (let i = 0; i < 14; i++) {
      await Promise.resolve()
      await new Promise((resolve) => setImmediate(resolve))
      releases.shift()?.()
    }
    expect(await done).toEqual([...Array.from({ length: 14 }, (_, i) => `${i}`), 'cmd'])
    expect(most).toBe(MAX_MODEL_HOOKS_AT_ONCE)
  })
})
