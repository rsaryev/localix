import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { turns } from '@/testing/settle'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('UI-first startup', () => {
  test('renders the routed shell while the backend profile is unavailable', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { MemoryRouter, Route, Routes } = await import('react-router')
    const { backendClient } = await import('@/shared/api/client')
    const { RootLayout } = await import('./RootLayout')
    const { useSettingsStore } = await import('@/shared/lib/user-settings/settingsStore')

    const getProfile = spyOn(backendClient, 'getUserProfile').mockRejectedValue(
      new Error('backend unavailable'),
    )
    // The root owns the notification sync, which subscribes to the realtime socket and so opens
    // it. There is no server here, and a real socket dialling nowhere errors after teardown.
    const { eventSocket } = await import('@/shared/api/eventSocket')
    const onFrame = spyOn(eventSocket, 'onFrame').mockReturnValue(() => {})
    const onSessionEvent = spyOn(eventSocket, 'onSessionEvent').mockReturnValue(() => {})
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    useSettingsStore.setState({ synced: false, syncError: null })

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<RootLayout />}>
              <Route index element={<main data-testid="workspace-shell">Localix</main>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      )
      await turns()
    })

    // Profile synchronization is background work, not a render gate.
    //
    // Called, not called-exactly-once: `spyOn` replaces the method PROCESS-wide and
    // `bun test` runs every file in one process, so another suite's still-pending
    // settings retry lands on this spy too and the count went 1 → 2 under
    // `--randomize`. What this test is actually about — the shell renders without
    // waiting for the profile, and the failure is recorded — is asserted below.
    expect(getProfile).toHaveBeenCalled()
    expect(host.querySelector('[data-testid="workspace-shell"]')?.textContent).toBe('Localix')
    expect(useSettingsStore.getState().synced).toBe(false)
    expect(useSettingsStore.getState().syncError).toBe('backend unavailable')

    // Unmount before the first 100 ms retry; RootLayout cleanup must cancel it.
    await act(async () => root.unmount())
    host.remove()
    getProfile.mockRestore()
    onFrame.mockRestore()
    onSessionEvent.mockRestore()
    warn.mockRestore()
  })
})
