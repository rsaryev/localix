import { afterAll, beforeAll, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

void mock.module('../generated/home-shots', () => ({
  homeShots: {
    'workspace/hero': { src: '/shots/workspace/hero--2026-10-07.png', placeholder: false },
    'workspace/pending': { src: '/shots/workspace/hero--placeholder.png', placeholder: true },
  },
}))

beforeAll(() => {
  GlobalRegistrator.register()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  mock.restore()
  await GlobalRegistrator.unregister()
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
  expect(dialog.querySelector('img')?.getAttribute('src')).toBe(
    '/shots/workspace/hero--2026-10-07.png',
  )
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
