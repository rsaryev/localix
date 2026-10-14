import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { configurePlatformCapabilities } from '@/shared/lib/platformCapabilities'
import { PreviewBlockedOverlay } from './PreviewOverlays'

let teardown: () => Promise<void>
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
let previousActEnvironment: boolean | undefined
beforeAll(() => {
  teardown = registerDom()
  previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  await teardown()
})

test('the blocked-embed card routes external navigation through the configured host', async () => {
  const { createRoot } = await import('react-dom/client')
  const opened: Array<{ url: string; systemBrowser?: boolean }> = []
  const restore = configurePlatformCapabilities({
    external: { open: (url, systemBrowser) => opened.push({ url, systemBrowser }) },
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => {
      root.render(<PreviewBlockedOverlay url="https://example.com/preview" />)
    })
    const button = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Open in browser'),
    )
    expect(button).toBeDefined()
    await act(async () => button!.click())
    expect(opened).toEqual([{ url: 'https://example.com/preview', systemBrowser: true }])
  } finally {
    await act(async () => root.unmount())
    container.remove()
    restore()
  }
})
