import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('LocalModelsEmpty — an empty Local list links to where models are got', () => {
  test('names the kind, closes the picker and opens Settings → Models', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { LocalModelsEmpty } = await import('./LocalModelsEmpty')
    const { subscribeSettingsNav } = await import('@/shared/lib/settingsNavBus')
    const tabs: string[] = []
    const unsubscribe = subscribeSettingsNav((target) => tabs.push(target.tab))
    let dismissed = 0
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () =>
        root.render(<LocalModelsEmpty kind="embedding" onNavigate={() => dismissed++} />),
      )
      expect(host.textContent).toContain('No embedding models on this computer yet.')
      const button = [...host.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Get models'),
      )!
      await act(async () => button.click())
      expect(dismissed).toBe(1)
      expect(tabs.at(-1)).toBe('models')
    } finally {
      unsubscribe()
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
