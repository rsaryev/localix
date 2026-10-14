import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

import { homeShots } from '../generated/home-shots'

let teardown: () => Promise<void>

const pending = Object.getOwnPropertyDescriptor(homeShots, 'workspace/pending')

beforeAll(() => {
  teardown = registerDom()
  Object.defineProperty(homeShots, 'workspace/pending', {
    configurable: true,
    value: { ...homeShots['workspace/hero']!, placeholder: true },
  })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  if (pending) Object.defineProperty(homeShots, 'workspace/pending', pending)
  else Reflect.deleteProperty(homeShots, 'workspace/pending')
  await teardown()
})

async function mount(shot = 'workspace/hero') {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ExpandableProductShot } = await import('./ExpandableProductShot')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(<ExpandableProductShot shot={shot} alt="Editor and team" title="Workspace" />),
  )
  return { host, root, act }
}

test('opens the original capture, toggles detail zoom, and restores focus after closing', async () => {
  const { host, root, act } = await mount()
  const trigger = host.querySelector<HTMLButtonElement>('button')!
  trigger.focus()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => trigger.click())
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(dialog).not.toBeNull()
  expect(dialog.querySelector('img')?.getAttribute('src')).toBe(homeShots['workspace/hero']!.src)
  const zoom = dialog.querySelector<HTMLButtonElement>('[aria-label="Zoom into screenshot"]')!
  await act(async () => zoom.click())
  expect(zoom.getAttribute('aria-pressed')).toBe('true')
  expect(zoom.getAttribute('aria-label')).toBe('Fit screenshot to window')
  await act(async () => zoom.click())
  expect(zoom.getAttribute('aria-pressed')).toBe('false')
  await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click())
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  await act(async () => root.unmount())
  host.remove()
})

test('missing captures and placeholder slots do not expose an empty viewer', async () => {
  for (const shot of ['workspace/missing', 'workspace/pending']) {
    const { host, root, act } = await mount(shot)
    expect(host.querySelector('button')).toBeNull()
    await act(async () => root.unmount())
    host.remove()
  }
})
