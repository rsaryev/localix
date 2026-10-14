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

describe('DiffViewModeToggle', () => {
  test('names the action group and persists the pressed layout choice', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { DiffViewModeToggle } = await import('./DiffViewModeToggle')
    const { setDiffViewMode } = await import('./diffViewMode')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    setDiffViewMode('unified')
    try {
      await act(async () => root.render(<DiffViewModeToggle embedded />))

      const group = host.querySelector<HTMLElement>('[role="group"]')
      const unified = host.querySelector<HTMLButtonElement>('[aria-label="Unified diff view"]')
      const split = host.querySelector<HTMLButtonElement>(
        '[aria-label="Split (side-by-side) diff view"]',
      )

      expect(group?.getAttribute('aria-label')).toBe('Diff layout')
      expect(host.querySelector('[role="toolbar"]')).toBeNull()
      expect(unified?.getAttribute('aria-pressed')).toBe('true')
      expect(split?.getAttribute('aria-pressed')).toBe('false')

      await act(async () => split?.click())

      expect(unified?.getAttribute('aria-pressed')).toBe('false')
      expect(split?.getAttribute('aria-pressed')).toBe('true')
      expect(localStorage.getItem('localix.diffViewMode')).toBe('split')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      setDiffViewMode('unified')
    }
  })
})
