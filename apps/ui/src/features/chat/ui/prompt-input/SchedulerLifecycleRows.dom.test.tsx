import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { SessionLoopSummary } from '@/shared/api/contracts'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

describe('scheduler lifecycle rows', () => {
  test('uses compact icon actions and serializes lifecycle decisions', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { backendClient } = await import('@/shared/api/client')
    const { SchedulesPanel } = await import('./SchedulesPanel')
    const originalRun = backendClient.runSessionLoop.bind(backendClient)
    const originalCancel = backendClient.cancelSessionLoop.bind(backendClient)
    let resolveRun!: (value: boolean) => void
    const runPending = new Promise<boolean>((resolve) => {
      resolveRun = resolve
    })
    const run = mock((_loopId: string) => runPending)
    let cancelResult = false
    const cancel = mock(async (_loopId: string) => cancelResult)
    const onCancel = mock((_loopId: string) => {})
    const loop: SessionLoopSummary = {
      id: 'loop-1',
      kind: 'fixed',
      cron: '*/5 * * * *',
      prompt: 'Check deployment health',
      maintenance: false,
      nextRunAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      target: 'session',
      lastRunAt: null,
      lastStatus: null,
      runCount: 0,
    }
    backendClient.runSessionLoop = run
    backendClient.cancelSessionLoop = cancel
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(<SchedulesPanel loops={[loop]} onCancel={onCancel} />)
      })

      const runAction = host.querySelector<HTMLButtonElement>('button[aria-label^="Run loop now:"]')
      const cancelAction = host.querySelector<HTMLButtonElement>(
        'button[aria-label^="Cancel loop:"]',
      )

      for (const action of [runAction, cancelAction]) {
        expect(action?.textContent).toBe('')
        expect(action?.getAttribute('data-slot')).toBe('button')
        expect(action?.getAttribute('data-size')).toBe('icon')
        expect(action?.getAttribute('data-tooltip-trigger')).toBe('true')
        expect(action?.getAttribute('title')).toBeNull()
        expect(action?.closest('[data-slot="workbench-list-row-actions"]')).not.toBeNull()
        expect(
          action?.closest<HTMLElement>('[data-slot="workbench-list-row"]')?.dataset.density,
        ).toBe('dense')
      }

      await act(async () => runAction?.click())
      expect(run).toHaveBeenCalledWith('loop-1')
      const pendingRunAction = host.querySelector<HTMLButtonElement>(
        'button[aria-label^="Run loop now:"]',
      )
      const pendingCancelAction = host.querySelector<HTMLButtonElement>(
        'button[aria-label^="Cancel loop:"]',
      )
      expect(pendingRunAction?.disabled).toBe(true)
      expect(pendingCancelAction?.disabled).toBe(true)
      expect(
        pendingRunAction?.querySelector('.lx-activity-orb[data-state="working"]'),
      ).not.toBeNull()

      await act(async () => resolveRun(true))
      expect(
        host.querySelector<HTMLButtonElement>('button[aria-label^="Run loop now:"]')?.disabled,
      ).toBe(false)
      expect(
        host.querySelector<HTMLButtonElement>('button[aria-label^="Cancel loop:"]')?.disabled,
      ).toBe(false)

      const readyCancelAction = host.querySelector<HTMLButtonElement>(
        'button[aria-label^="Cancel loop:"]',
      )
      await act(async () => readyCancelAction?.click())
      expect(cancel).toHaveBeenCalledWith('loop-1')
      expect(onCancel).not.toHaveBeenCalled()

      cancelResult = true
      const retryCancelAction = host.querySelector<HTMLButtonElement>(
        'button[aria-label^="Cancel loop:"]',
      )
      await act(async () => retryCancelAction?.click())
      expect(cancel).toHaveBeenCalledTimes(2)
      expect(onCancel).toHaveBeenCalledWith('loop-1')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      backendClient.runSessionLoop = originalRun
      backendClient.cancelSessionLoop = originalCancel
    }
  })
})
