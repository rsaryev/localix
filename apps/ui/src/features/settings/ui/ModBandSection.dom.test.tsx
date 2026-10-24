import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

test('Settings → Preferences turns the mods band’s rotation off and on; on by default', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { getModBandRotation } = await import('@/shared/lib/modBandRotationPref')
  const { ModBandSection } = await import('./ModBandSection')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<ModBandSection />))
  const toggle = host.querySelector<HTMLElement>('[aria-label="Rotate mod band pages"]')!
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  expect(getModBandRotation()).toBe(true)
  await act(async () => toggle.click())
  expect(getModBandRotation()).toBe(false)
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  await act(async () => toggle.click())
  expect(getModBandRotation()).toBe(true)
  await act(async () => root.unmount())
  host.remove()
})
