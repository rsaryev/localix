import { afterEach, expect, test } from 'bun:test'
import { __setRegistryFlushScheduler, noteRegistryChange } from './registryChanges'

// No window here, so no frame functions: put back "absent", not `undefined` (the key would stay).
afterEach(() => {
  Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
  Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
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
  Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
  expect(() => __setRegistryFlushScheduler(null)).not.toThrow()
})
