import { afterEach, describe, expect, test } from 'bun:test'

import {
  configurePlatformCapabilities,
  platformCapabilities,
  resetPlatformCapabilities,
} from './platformCapabilities'

afterEach(resetPlatformCapabilities)

describe('platform capability port', () => {
  test('supports a narrow override and restores the previous host', async () => {
    const writes: string[] = []
    const restore = configurePlatformCapabilities({
      clipboard: {
        writeText: async (text) => {
          writes.push(text)
          return true
        },
      },
    })
    expect(await platformCapabilities().clipboard.writeText('hello')).toBe(true)
    expect(writes).toEqual(['hello'])

    const overridden = platformCapabilities().clipboard.writeText
    restore()
    expect(platformCapabilities().clipboard.writeText).not.toBe(overridden)
  })

  test('desktop absence is represented as null instead of a rejected fake call', () => {
    const restore = configurePlatformCapabilities({
      desktop: { invoke: () => null },
    })
    expect(platformCapabilities().desktop.invoke('missing')).toBeNull()
    restore()
  })
})
