import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import {
  BEFORE_QUIT_EVENT,
  createPendingWrite,
  flushAllBeforeQuit,
  installQuitFlush,
  registerQuitFlush,
} from './quitFlush'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => {
  await teardown()
})

describe('pending writes are flushed, never dropped', () => {
  test('disposing an owner inside its debounce writes instead of clearing', () => {
    const writes: string[] = []
    const write = createPendingWrite('test:dispose', 10_000, () => writes.push('caret'))
    write.schedule()
    // The CodeEditor defect: dispose used to clearTimeout here and the caret save was lost.
    write.dispose()
    expect(writes).toEqual(['caret'])
    // And it left the quit list: a later quit does not write a disposed owner again.
    write.schedule()
    return flushAllBeforeQuit(50).then(() => expect(writes).toEqual(['caret']))
  })

  test('a flush with nothing pending does not write', () => {
    const writes: number[] = []
    const write = createPendingWrite('test:idle', 10, () => writes.push(1))
    write.flush()
    write.dispose()
    expect(writes).toEqual([])
  })

  test('one failing or hung owner never blocks the others, and is named', async () => {
    const written: string[] = []
    const offs = [
      registerQuitFlush('test:throws', () => {
        throw new Error('boom')
      }),
      registerQuitFlush('test:hangs', () => new Promise(() => {})),
      registerQuitFlush('test:ok', () => void written.push('ok')),
    ]
    const unfinished = await flushAllBeforeQuit(30)
    expect(written).toEqual(['ok'])
    expect(unfinished).toContain('test:throws')
    expect(unfinished).toContain('test:hangs')
    expect(unfinished).not.toContain('test:ok')
    for (const off of offs) off()
  })
})

describe('the before-quit handshake', () => {
  test('the page flushes, THEN answers quit_ready', async () => {
    const order: string[] = []
    let deliver: (() => void) | undefined
    const bridge = {
      event: {
        listen: async (name: string, handler: () => void) => {
          if (name === BEFORE_QUIT_EVENT) deliver = handler
          return () => {}
        },
      },
      core: {
        invoke: async (command: string) => void order.push(command),
      },
    }
    ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = bridge
    const off = registerQuitFlush('test:settings', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push('patch sent')
    })
    const uninstall = installQuitFlush()
    try {
      await Promise.resolve()
      expect(deliver).toBeDefined()
      deliver!()
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(order).toEqual(['patch sent', 'quit_ready'])
    } finally {
      uninstall()
      off()
      delete (window as unknown as { __TAURI__?: unknown }).__TAURI__
    }
  })

  test('pagehide writes what is pending, as the reload path needs', () => {
    const writes: string[] = []
    const write = createPendingWrite('test:pagehide', 10_000, () => writes.push('draft'))
    const uninstall = installQuitFlush()
    try {
      write.schedule()
      window.dispatchEvent(new Event('pagehide'))
      expect(writes).toEqual(['draft'])
    } finally {
      uninstall()
      write.dispose()
    }
  })
})
