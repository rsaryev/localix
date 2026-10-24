import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { MarketplaceListing } from '@/shared/api/contracts'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const restores: Array<() => void> = []
afterEach(() => {
  for (const restore of restores.splice(0)) restore()
})

const listing = (rows: MarketplaceListing[]) => rows

async function mount(rows: MarketplaceListing[]) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { backendClient } = await import('@/shared/api/client')
  const calls: unknown[][] = []
  let current = rows
  const spies = [
    spyOn(backendClient, 'listMarketplaces').mockImplementation(async () => current),
    spyOn(backendClient, 'setMarketplaceAutoUpdate').mockImplementation(async (name, on) => {
      calls.push(['autoUpdate', name, on])
      current = current.map((row) => (row.name === name ? { ...row, autoUpdate: on } : row))
    }),
    spyOn(backendClient, 'updateMarketplace').mockImplementation(async (name) => {
      calls.push(['update', name])
      return { refreshed: [name!], updated: ['tool'], manual: ['gated'], warnings: [] }
    }),
  ]
  for (const spy of spies) restores.push(() => spy.mockRestore())
  const { MarketplacesPanel } = await import('./MarketplacesPanel')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<MarketplacesPanel />))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
  const rowOf = (name: string) =>
    [...container.querySelectorAll('[role="listitem"], li')].find((el) =>
      el.textContent?.includes(name),
    ) as HTMLElement
  const cleanup = async () => {
    await act(async () => root.unmount())
    container.remove()
  }
  return { container, calls, act, rowOf, cleanup }
}

describe('the Marketplaces section', () => {
  test('each marketplace shows its auto-update switch; the official one says so', async () => {
    const view = await mount(
      listing([
        { name: 'localix', count: 1, plugins: [], autoUpdate: true, official: true },
        { name: 'acme', count: 2, plugins: [], autoUpdate: false },
      ]),
    )
    try {
      const official = view.rowOf('localix')
      expect(official.textContent).toContain('Official')
      const acmeSwitch = view.rowOf('acme').querySelector<HTMLInputElement>('input')!
      expect(acmeSwitch.getAttribute('aria-label')).toBe('Auto-update acme')
      expect(acmeSwitch.checked).toBe(false)
      await view.act(async () => acmeSwitch.click())
      await view.act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
      expect(view.calls).toEqual([['autoUpdate', 'acme', true]])
    } finally {
      await view.cleanup()
    }
  })

  test('Update marketplace updates its plugins and names the ones left to update by hand', async () => {
    const view = await mount(listing([{ name: 'acme', count: 2, plugins: [], autoUpdate: false }]))
    try {
      const button = [...view.rowOf('acme').querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Update marketplace',
      )!
      await view.act(async () => button.click())
      await view.act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
      expect(view.calls).toEqual([['update', 'acme']])
      expect(view.container.textContent).toContain('Updated tool')
      expect(view.container.textContent).toContain('Update by hand: gated')
    } finally {
      await view.cleanup()
    }
  })

  test('while an environment variable pauses auto-update, the switch is not offered', async () => {
    const view = await mount(
      listing([{ name: 'acme', count: 2, plugins: [], autoUpdate: true, autoUpdatePaused: true }]),
    )
    try {
      expect(view.rowOf('acme').querySelector('input')).toBeNull()
      expect(view.rowOf('acme').textContent).toContain('Auto-update paused')
    } finally {
      await view.cleanup()
    }
  })
})
