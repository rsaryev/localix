import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

describe('WorkspaceConnectionStatus in window chrome', () => {
  test('keeps startup and failure status in existing chrome at either breakpoint', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { WorkspaceShell } = await import('@/widgets/workspace-shell')
    const { WorkspaceConnectionStatus } = await import('./WorkspaceConnectionStatus')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const noOp = () => {}
    let retries = 0

    try {
      for (const isMobile of [false, true]) {
        let slot: Element | null = null
        for (const runtimeState of ['starting', 'ready', 'error'] as const) {
          await act(async () =>
            root.render(
              <WorkspaceShell
                isMobile={isMobile}
                statusSessionId={null}
                sidebarOpen={false}
                onOpenSidebar={noOp}
                onCloseSidebar={noOp}
                onCreateChat={noOp}
                titlebarContent={<span data-titlebar-probe />}
                headerStatus={
                  <WorkspaceConnectionStatus
                    hasHydrated={runtimeState !== 'starting'}
                    error={null}
                    runtimeState={runtimeState}
                    onRetry={() => retries++}
                  />
                }
              >
                <div data-workspace-probe />
              </WorkspaceShell>,
            ),
          )
          const indicator = host.querySelector('[data-slot="workspace-connection-status"]')
          expect(indicator).not.toBeNull()
          expect(host.querySelector('main')?.contains(indicator)).toBe(false)
          expect(host.querySelectorAll('[data-workspace-probe]')).toHaveLength(1)
          if (isMobile) expect(host.querySelector('header')?.contains(indicator)).toBe(true)
          else
            expect(
              host.querySelector('[data-titlebar-probe]')?.parentElement?.contains(indicator),
            ).toBe(true)
          if (slot) {
            expect(indicator).toBe(slot)
          }
          slot = indicator
          expect(indicator?.classList.contains('sr-only')).toBe(runtimeState === 'ready')
          if (!isMobile) {
            // The notification cluster must reach the normal bar inset, without a
            // second fixed spacer after the (possibly hidden) connection indicator.
            expect(indicator?.parentElement?.lastElementChild).toBe(indicator)
          }
          const live = indicator?.querySelector('[role="status"]')
          const retry = indicator?.querySelector<HTMLButtonElement>('button')
          if (runtimeState === 'starting') {
            expect(live?.textContent).toBe('Starting the local service')
            expect(retry).toBeNull()
          } else if (runtimeState === 'ready') {
            expect(live?.textContent).toBe('')
            expect(indicator?.querySelector('svg')).toBeNull()
            expect(retry).toBeNull()
          } else {
            expect(live?.textContent).toBe('The local service could not start.')
            expect(retry?.getAttribute('aria-label')).toContain('Restart Localix')
            await act(async () => retry?.click())
          }
        }
      }
      expect(retries).toBe(2)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
