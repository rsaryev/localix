import { afterEach, expect, test } from 'bun:test'
import { __setRegistryFlushScheduler, noteRegistryChange } from './registryChanges'

const raf = globalThis.requestAnimationFrame
const caf = globalThis.cancelAnimationFrame
afterEach(() => {
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = caf
})

/**
 * A frame asked for while a window was there is let go after it went (a DOM test's teardown
 * removes the frame functions): letting it go must not need the window back.
 */
test('a pending frame is let go after the window that scheduled it is gone', () => {
  __setRegistryFlushScheduler(null)
  globalThis.requestAnimationFrame = () => 7
  globalThis.cancelAnimationFrame = () => {}
  noteRegistryChange()
  globalThis.cancelAnimationFrame = undefined as never
  expect(() => __setRegistryFlushScheduler(null)).not.toThrow()
})
