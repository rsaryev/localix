import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { backendClient } from '@/shared/api/client'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

type RefreshResult = Awaited<ReturnType<(typeof backendClient)['refreshModelCatalog']>>

async function mount(result: RefreshResult | Error) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SWRConfig } = await import('swr')
  const { backendClient } = await import('@/shared/api/client')
  const { ModelCatalogSection } = await import('./ModelCatalogSection')
  const refresh = spyOn(backendClient, 'refreshModelCatalog').mockImplementation(async () => {
    if (result instanceof Error) throw result
    return result
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <ModelCatalogSection />
      </SWRConfig>,
    ),
  )
  const button = [...host.querySelectorAll('button')].find(
    (entry) => entry.textContent === 'Check for new models',
  )!
  return {
    host,
    refresh,
    click: async () => act(async () => button.click()),
    cleanup: async () => {
      await act(async () => root.unmount())
      host.remove()
      refresh.mockRestore()
    },
  }
}

describe('Settings → Models → Model list', () => {
  test('a check that succeeds says the list is up to date', async () => {
    const view = await mount({ ok: true, changed: true, failedProviders: [] })
    try {
      await view.click()
      expect(view.refresh).toHaveBeenCalledTimes(1)
      expect(view.host.textContent).toContain('The model list is up to date.')
      expect(view.host.querySelector('[role="alert"]')).toBeNull()
    } finally {
      await view.cleanup()
    }
  })

  test('a failed check says the current list stays, with the cause', async () => {
    const view = await mount({
      ok: false,
      changed: false,
      failedProviders: ['openai'],
      message: 'models.dev API returned 503',
    })
    try {
      await view.click()
      expect(view.host.querySelector('[role="alert"]')?.textContent).toBe(
        'Some providers could not be checked and keep their current list: models.dev API returned 503',
      )
    } finally {
      await view.cleanup()
    }
  })

  test('a request that fails is reported, not thrown', async () => {
    const view = await mount(new Error('Network unreachable'))
    try {
      await view.click()
      expect(view.host.querySelector('[role="alert"]')?.textContent).toBe('Network unreachable')
    } finally {
      await view.cleanup()
    }
  })
})
