import { afterAll, beforeAll, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

let delayLoads = false
let resolveDelayed: ((content: string) => void) | undefined

const pages = [
  {
    slug: 'guide--first',
    section: 'guide',
    sectionTitle: 'Guide',
    title: 'First page',
    summary: 'First summary',
    order: 0,
    sourcePath: 'docs/first.md',
  },
  {
    slug: 'guide--second',
    section: 'guide',
    sectionTitle: 'Guide',
    title: 'Second page',
    summary: 'Second summary',
    order: 1,
    sourcePath: 'docs/second.md',
  },
]

void mock.module('../generated/docs', () => ({
  docPages: pages,
  loadAllDocContent: async () => new Map(),
  loadDocContent: async (slug: string) => {
    if (delayLoads)
      return new Promise<string>((resolve) => {
        resolveDelayed = resolve
      })
    return slug === 'guide--first' ? '# First documentation page' : '# Second documentation page'
  },
}))
void mock.module('../generated/shots', () => ({ screenshotAssets: {} }))
void mock.module('../lib/cn', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}))
void mock.module('@localixai/kit/empty-hint', () => ({
  LoadingHint: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

let scrollCalls = 0

beforeAll(() => {
  GlobalRegistrator.register()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(window, 'scrollTo', {
    configurable: true,
    value: () => {
      scrollCalls += 1
    },
  })
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    },
  })
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: () => {},
  })
})

afterAll(async () => {
  mock.restore()
  await GlobalRegistrator.unregister()
})

test('Previous and Next navigation opens the loaded document at the top', async () => {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter, Route, Routes } = await import('react-router')
  const { DocsPage } = await import('./DocsPage')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/docs/guide--first']}>
        <Routes>
          <Route path="/docs/:slug" element={<DocsPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  document.documentElement.scrollTop = 720
  document.body.scrollTop = 720
  scrollCalls = 0

  const next = Array.from(host.querySelectorAll<HTMLAnchorElement>('a')).find((link) =>
    link.textContent?.includes('Next'),
  )
  expect(next).toBeDefined()

  await act(async () => {
    next?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  expect(host.textContent).toContain('Second documentation page')
  expect(document.documentElement.scrollTop).toBe(0)
  expect(document.body.scrollTop).toBe(0)
  expect(scrollCalls).toBeGreaterThanOrEqual(2)
  expect(document.activeElement).toBe(host.querySelector('#doc-content'))

  await act(async () => root.unmount())
  host.remove()
})

test('a slow document keeps navigation visible and reserves the article until its source arrives', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter, Route, Routes } = await import('react-router')
  const { DocsPage } = await import('./DocsPage')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  delayLoads = true
  try {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/docs/guide--second']}>
          <Routes>
            <Route path="/docs/:slug" element={<DocsPage />} />
          </Routes>
        </MemoryRouter>,
      )
    })
    expect(host.querySelector('[aria-label="Documentation"]')).not.toBeNull()
    expect(host.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(5)
    expect(host.querySelector('#doc-body')?.getAttribute('aria-busy')).toBe('true')
    expect(host.querySelector('h1')).toBeNull()
    await act(async () => {
      resolveDelayed?.('# Second documentation page')
    })
    expect(host.querySelector('h1')?.textContent).toBe('Second documentation page')
    expect(host.querySelector('#doc-body')?.hasAttribute('aria-busy')).toBe(false)
    expect(host.querySelector('[data-slot="skeleton"]')).toBeNull()
  } finally {
    delayLoads = false
    await act(async () => root.unmount())
    host.remove()
  }
})
