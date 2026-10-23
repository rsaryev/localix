import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { RegistryScope } from './useRegistryScope'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

// What this hook owns is MUTATION feedback. Loading and load failures moved to the
// capability document the lists project — keeping a second copy here was two answers to
// "is this list ready", and the wrong one could win.
describe('registry mutation feedback', () => {
  test('names the busy row and what it is busy doing, and clears both together', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { useRegistryScope } = await import('./useRegistryScope')
    let state: RegistryScope | null = null

    function Probe() {
      state = useRegistryScope()
      return null
    }

    const host = document.createElement('div')
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Probe />))
      expect(state!.busy).toBeNull()
      expect(state!.busyLabel).toBeNull()

      const setBusy = state!.setBusy
      await act(async () => setBusy('database', 'Disabling Database'))
      expect(state!.busy).toBe('database')
      expect(state!.busyLabel).toBe('Disabling Database')

      await act(async () => setBusy(null))
      expect(state!.busy).toBeNull()
      expect(state!.busyLabel).toBeNull()
      // Stable identity: a row that re-renders while another mutates must not remount
      // its handlers.
      expect(state!.setBusy).toBe(setBusy)
    } finally {
      await act(async () => root.unmount())
    }
  })

  test('a mutation error is held until the caller replaces it', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { useRegistryScope } = await import('./useRegistryScope')
    let state: RegistryScope | null = null

    function Probe() {
      state = useRegistryScope()
      return null
    }

    const host = document.createElement('div')
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Probe />))
      await act(async () => state!.setError('Could not turn this mini app on or off.'))
      expect(state!.error).toBe('Could not turn this mini app on or off.')
      await act(async () => state!.setError(null))
      expect(state!.error).toBeNull()
    } finally {
      await act(async () => root.unmount())
    }
  })
})
