import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
})

afterAll(async () => {
  await teardown()
})

/**
 * The seam a plugin's links actually travel, end to end.
 *
 * The reader (and every other plugin surface) opens a link by calling
 * `pluginExternal.open`, which reaches the host through the runtime bound in
 * `app/pluginRuntime.ts` and lands on the platform's `external.open` port. Each
 * half was covered; the JOIN was not — and an unbound or duplicated runtime module
 * would break plugin links while leaving every host link working, which is exactly
 * the shape of "links do nothing in the book but the app seems fine".
 */
describe('plugin external wiring', () => {
  test('a plugin link reaches the platform external port', async () => {
    // Importing the host module is what BINDS the runtime — it does so at module
    // scope. Without this import `currentRuntime()` throws instead of routing.
    await import('./pluginRuntime')
    const { configurePlatformCapabilities } = await import('@/shared/lib/platformCapabilities')
    const { pluginExternal } = await import('@localixai/mini-app-sdk/ui/runtime')

    const opened: Array<{ url: string; systemBrowser?: boolean }> = []
    const restore = configurePlatformCapabilities({
      external: { open: (url, systemBrowser) => opened.push({ url, systemBrowser }) },
    })
    try {
      await pluginExternal.open('https://example.com/book/reference')
      await pluginExternal.open('https://example.com/oauth', true)
      expect(opened).toEqual([
        { url: 'https://example.com/book/reference', systemBrowser: false },
        { url: 'https://example.com/oauth', systemBrowser: true },
      ])
    } finally {
      restore()
    }
  })

  test('a plugin cannot smuggle a non-browser scheme through the port', async () => {
    await import('./pluginRuntime')
    const { configurePlatformCapabilities } = await import('@/shared/lib/platformCapabilities')
    const { pluginExternal } = await import('@localixai/mini-app-sdk/ui/runtime')

    const opened: string[] = []
    const restore = configurePlatformCapabilities({
      external: { open: (url) => opened.push(url) },
    })
    try {
      expect(() => pluginExternal.open('javascript:alert(1)')).toThrow()
      expect(() => pluginExternal.open('file:///etc/passwd')).toThrow()
      expect(opened).toEqual([])
    } finally {
      restore()
    }
  })
})
