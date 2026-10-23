import { describe, expect, test } from 'bun:test'

import type { RuntimeEndpoint } from './lib/runtime-endpoint'
import { isOwnDescriptor } from './runtime-daemon'

/**
 * The dev-reload deadlock: `bun --watch` re-evaluates the entry inside the SAME process, and the
 * reloaded module found a descriptor whose pid was alive — itself — and attached to it. Both
 * discovery call sites ask `isOwnDescriptor` first.
 */
describe('a watch reload must not attach to its own outgoing runtime', () => {
  test('the guard compares against this process', () => {
    const descriptor = (pid: number) => ({ pid }) as RuntimeEndpoint
    expect(isOwnDescriptor(descriptor(process.pid))).toBe(true)
    expect(isOwnDescriptor(descriptor(process.pid + 1))).toBe(false)
    expect(isOwnDescriptor(null)).toBe(false)
  })
})
