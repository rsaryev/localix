import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { turns } from '@/testing/settle'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const provider = (id: string, name: string, modelCount: number) => ({
  id,
  name,
  modelCount,
  authType: 'api-key',
})

// The scene draws the picker's provider column. The core names no provider: what the catalog
// offers, in its order, is what the slide shows, and a provider with no chat model is left out
// as the picker leaves it out.
test('the model slide draws the catalog’s own providers and the first one’s models', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { backendClient } = await import('@/shared/api/client')
  const catalog = spyOn(backendClient, 'getCatalog').mockResolvedValue({
    providers: [
      provider('zeta', 'Zeta AI', 2),
      provider('classifier', 'Classifier Only', 0),
      provider('omega', 'Omega', 1),
    ],
    models: [
      { id: 'zeta/swift', name: 'Swift 2', providerId: 'zeta' },
      { id: 'omega/large', name: 'Omega Large', providerId: 'omega' },
    ],
    oauthProviderIds: ['zeta'],
    oauthProviders: [
      { providerId: 'zeta', loginLabel: 'Zeta (subscription)', loginDescription: '' },
    ],
  } as never)
  const { ModelScene } = await import('./ModelScene')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<ModelScene />))
    await act(() => turns())
    const providers = [...host.querySelectorAll('.wt-col:nth-child(2) .wt-row:not(.wt-field)')]
    expect(providers.map((row) => row.textContent?.trim())).toEqual(['Zeta AI', 'Omega'])
    expect(host.querySelector('.wt-connect .wt-label')?.textContent).toBe('Zeta AI')
    expect(host.querySelector('.wt-oauth')?.textContent).toBe('Zeta (subscription)')
    expect([...host.querySelectorAll('.wt-models .wt-row')].map((r) => r.textContent)).toEqual([
      'Swift 2',
    ])
  } finally {
    await act(async () => root.unmount())
    host.remove()
    catalog.mockRestore()
  }
})
