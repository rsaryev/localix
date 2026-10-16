import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await teardown()
})

async function mountChooser(platform: string, architecture?: string, released = true) {
  Object.defineProperty(navigator, 'platform', { configurable: true, value: platform })
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: '' })
  Object.defineProperty(navigator, 'userAgentData', {
    configurable: true,
    value: architecture
      ? { platform, getHighEntropyValues: async () => ({ architecture }) }
      : undefined,
  })
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { DownloadChooser, resolveDownloads } = await import('./DownloadChooser')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const downloads = resolveDownloads(
    released
      ? {
          'mac-arm64': 'https://example.test/localix.dmg',
        }
      : {},
  )
  await act(async () => {
    root.render(
      <MemoryRouter>
        <DownloadChooser downloads={downloads} />
      </MemoryRouter>,
    )
  })

  return {
    host,
    cleanup: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

test('a recognized Mac shows only its own installer without an alternative picker', async () => {
  const { host, cleanup } = await mountChooser('macOS', 'arm')
  try {
    expect(host.textContent).toContain('Download for Mac')
    expect(host.textContent).not.toContain('Also for')
    expect(host.textContent).not.toContain('View on GitHub')
    expect(host.querySelector('button[aria-controls]')).toBeNull()
    expect(host.querySelectorAll('#downloads a')).toHaveLength(1)
  } finally {
    await cleanup()
  }
})

test('Apple silicon detection selects the Mac installer after client hints resolve', async () => {
  const { host, cleanup } = await mountChooser('macOS', 'arm')
  try {
    expect(host.querySelector('a[href="https://example.test/localix.dmg"]')).not.toBeNull()
    expect(host.textContent).not.toContain('Download for Linux')
  } finally {
    await cleanup()
  }
})

test('an Intel Mac and Linux are sent to the source build', async () => {
  for (const [platform, architecture] of [
    ['macOS', 'x86'],
    ['Linux x86_64', undefined],
    ['Linux aarch64', undefined],
  ] as const) {
    const { host, cleanup } = await mountChooser(platform, architecture)
    try {
      expect(host.textContent).toContain('Build from source')
      expect(host.textContent).not.toContain('Download for')
    } finally {
      await cleanup()
    }
  }
})

test('unreleased installers remain honestly disabled and marked coming soon', async () => {
  const { host, cleanup } = await mountChooser('macOS', 'arm', false)
  try {
    expect(host.textContent).toContain('Download for Mac')
    expect(host.textContent).toContain('Coming soon')
    expect(host.querySelector('button[disabled]')).not.toBeNull()
    expect(host.querySelector('a[href*="localix.dmg"]')).toBeNull()
  } finally {
    await cleanup()
  }
})

test('unknown and unsupported platforms offer the source build as the sole platform action', async () => {
  for (const platform of ['', 'Win32', 'MacIntel']) {
    const { host, cleanup } = await mountChooser(platform)
    try {
      expect(host.textContent).toContain('Build from source')
      expect(host.textContent).not.toContain('Download for')
      expect(
        host.querySelector('a[href="/docs/getting-started--installation#how-it-works"]'),
      ).not.toBeNull()
    } finally {
      await cleanup()
    }
  }
})

test('static HTML uses the safe source-build fallback before browser detection', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { MemoryRouter } = await import('react-router')
  const { DownloadChooser } = await import('./DownloadChooser')
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <DownloadChooser />
    </MemoryRouter>,
  )
  expect(html).toContain('Build from source')
  expect(html).not.toContain('Download for')
})
