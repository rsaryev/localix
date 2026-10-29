import { afterAll, beforeAll, expect, test } from 'bun:test'
import type { ChatUsagePayload } from '@localixai/agent'
import { registerDom } from '@localixai/kit/testing/dom'
import { compileLikeTheBuild } from '@/testing/reactCompiler'

// The strip as the desktop build ships it.
compileLikeTheBuild(/prompt-input\/SpendAlertStrip\.tsx$/)

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('a budget lowered in settings warns about the spend already made', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { setSpendThreshold } = await import('@/shared/lib/spendAlert')
  const { SpendAlertStrip } = await import('./SpendAlertStrip')
  setSpendThreshold(10)
  const usage = { totalCost: 3, costSource: 'metered' } as unknown as ChatUsagePayload
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () => root.render(<SpendAlertStrip sessionId="s1" sessionUsage={usage} />))
    expect(host.textContent).not.toContain('Spend alert')
    await act(async () => setSpendThreshold(2))
    expect(host.textContent).toContain('Spend alert')
  } finally {
    await act(async () => root.unmount())
    setSpendThreshold(0)
  }
})

test('dismissed, the warning goes away until spend crosses the next step', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { setSpendThreshold } = await import('@/shared/lib/spendAlert')
  const { SpendAlertStrip } = await import('./SpendAlertStrip')
  setSpendThreshold(2)
  const usage = (totalCost: number) =>
    ({ totalCost, costSource: 'metered' }) as unknown as ChatUsagePayload
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = (cost: number) =>
    act(async () => root.render(<SpendAlertStrip sessionId="s2" sessionUsage={usage(cost)} />))
  try {
    await render(3)
    const dismiss = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss until spend crosses the next budget step"]',
    )!
    await act(async () => dismiss.click())
    expect(host.textContent).not.toContain('Spend alert')
    await render(5)
    expect(host.textContent).toContain('Spend alert')
  } finally {
    await act(async () => root.unmount())
    host.remove()
    setSpendThreshold(0)
  }
})
