import { afterAll, beforeAll, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

void mock.module('@/lib/cn', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}))
void mock.module('../lib/cn', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}))

beforeAll(() => {
  GlobalRegistrator.register()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  mock.restore()
  await GlobalRegistrator.unregister()
})

async function mountChooser() {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { DownloadChooser, resolveDownloads } = await import('./DownloadChooser')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  // The chooser only exists once a release provides an installer URL.
  const downloads = resolveDownloads({ 'mac-arm64': 'https://example.test/localix.dmg' })
  await act(async () => {
    root.render(
      <MemoryRouter>
        <DownloadChooser downloads={downloads} />
      </MemoryRouter>,
    )
  })

  const trigger = host.querySelector<HTMLButtonElement>('button[aria-controls]')
  const panel = host.querySelector<HTMLElement>('#download-alternatives')
  return { host, root, act, trigger, panel }
}

test('before a release the chooser offers a build from source, never a disabled download', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { DownloadChooser, resolveDownloads } = await import('./DownloadChooser')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  await act(async () => {
    root.render(
      <MemoryRouter>
        <DownloadChooser downloads={resolveDownloads({})} />
      </MemoryRouter>,
    )
  })

  expect(host.textContent).toContain('Build from source')
  expect(host.textContent).not.toContain('Download for')
  expect(host.textContent).not.toContain('Coming soon')
  expect(host.querySelector('button[disabled]')).toBeNull()
  expect(host.querySelector('a[href="/docs/getting-started--installation"]')).not.toBeNull()

  await act(async () => root.unmount())
  host.remove()
})

test('the other platforms open on a layer instead of pushing the page', async () => {
  const { host, root, act, trigger, panel } = await mountChooser()

  expect(trigger?.textContent).toContain('Also for')
  // Closed: the panel is in the DOM (so `aria-controls` resolves) but hidden,
  // and it is out of flow either way — expanding it must not move the hero.
  expect(panel?.hidden).toBe(true)
  expect(panel?.className).toContain('absolute')
  expect(panel?.parentElement?.className).toContain('relative')
  expect(trigger?.getAttribute('aria-expanded')).toBe('false')

  await act(async () => trigger?.click())
  expect(panel?.hidden).toBe(false)
  expect(trigger?.getAttribute('aria-expanded')).toBe('true')

  await act(async () => root.unmount())
  host.remove()
})

test('Escape closes the list and hands focus back to the trigger', async () => {
  const { host, root, act, trigger, panel } = await mountChooser()

  await act(async () => trigger?.click())
  expect(panel?.hidden).toBe(false)

  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })

  expect(panel?.hidden).toBe(true)
  expect(document.activeElement).toBe(trigger)

  await act(async () => root.unmount())
  host.remove()
})

test('a click outside dismisses the list', async () => {
  const { host, root, act, trigger, panel } = await mountChooser()

  await act(async () => trigger?.click())
  expect(panel?.hidden).toBe(false)

  await act(async () => {
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  })

  expect(panel?.hidden).toBe(true)

  await act(async () => root.unmount())
  host.remove()
})
