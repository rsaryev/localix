import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { configurePlatformCapabilities } from '@/shared/lib/platformCapabilities'
import { PreviewStatusOverlay } from './PreviewOverlays'

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

test('preview recovery routes external navigation through the configured host', async () => {
  const { createRoot } = await import('react-dom/client')
  const opened: string[] = []
  const restore = configurePlatformCapabilities({ external: { open: (url) => opened.push(url) } })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => {
      root.render(
        <PreviewStatusOverlay
          kind="blocked"
          url="https://example.com/preview"
          onReload={() => {}}
        />,
      )
    })
    const button = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Open in browser'),
    )
    expect(button).toBeDefined()
    await act(async () => button!.click())
    expect(opened).toEqual(['https://example.com/preview'])
  } finally {
    await act(async () => root.unmount())
    container.remove()
    restore()
  }
})
