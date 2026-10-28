import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { LspServerState } from '@/shared/api/contracts'
import { LspInstallStatusItem } from './LspInstallStatusItem'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

const installing = (progress: number) =>
  [{ serverName: 'gopls', status: 'installing', progress }] as unknown as LspServerState[]

// A download reports every percent. A screen reader hears that an install started, not each tick.
test('the percent counts up on screen but the announced text does not change with it', async () => {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<LspInstallStatusItem servers={installing(0.1)} />))
    expect(host.textContent).toContain('10%')
    const announced = () => host.querySelector('[role="status"]')?.textContent
    const first = announced()
    expect(first).toContain('Installing gopls')
    await act(async () => root.render(<LspInstallStatusItem servers={installing(0.6)} />))
    expect(host.textContent).toContain('60%')
    expect(announced()).toBe(first)
    expect(announced()).not.toContain('%')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
