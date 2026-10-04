import { afterAll, beforeAll, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

void mock.module('@/generated/docs', () => ({ docPages: [] }))
void mock.module('@/generated/shots', () => ({ screenshotAssets: {} }))

beforeAll(() => {
  GlobalRegistrator.register()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  mock.restore()
  await GlobalRegistrator.unregister()
})

test('shows and repeats clipboard failures for documentation code blocks', async () => {
  const React = await import('react')
  const { act, createElement } = React
  const { createRoot } = await import('react-dom/client')
  const { makeMdComponents } = await import('./docsNav')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let attempts = 0

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async () => {
        attempts += 1
        throw new Error('clipboard unavailable')
      },
    },
  })

  const components = makeMdComponents('docs/getting-started/installation.md', () => {})
  await act(async () => {
    root.render(
      components.pre({
        children: createElement('code', { className: 'language-bash' }, 'bun run dev\n'),
      }),
    )
  })

  const copy = host.querySelector<HTMLButtonElement>('[aria-label="Copy code"]')
  expect(copy).not.toBeNull()
  await act(async () => copy?.click())
  expect(copy?.textContent).toBe('Retry copy')
  expect(host.textContent).toContain('Attempt 1')

  await act(async () => copy?.click())
  expect(attempts).toBe(2)
  expect(host.textContent).toContain('Attempt 2')

  await act(async () => root.unmount())
  host.remove()
})

test('ignores an older clipboard result after a newer request fails', async () => {
  const React = await import('react')
  const { act, createElement } = React
  const { createRoot } = await import('react-dom/client')
  const { makeMdComponents } = await import('./docsNav')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const requests: {
    resolve: () => void
    reject: (reason: Error) => void
  }[] = []

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: () =>
        new Promise<void>((resolve, reject) => {
          requests.push({ resolve, reject })
        }),
    },
  })

  const components = makeMdComponents('docs/getting-started/installation.md', () => {})
  await act(async () => {
    root.render(
      components.pre({
        children: createElement('code', { className: 'language-bash' }, 'bun run dev\n'),
      }),
    )
  })

  const copy = host.querySelector<HTMLButtonElement>('[aria-label="Copy code"]')
  await act(async () => {
    copy?.click()
    copy?.click()
  })
  expect(requests).toHaveLength(2)

  await act(async () => requests[1].reject(new Error('clipboard unavailable')))
  expect(copy?.textContent).toBe('Retry copy')
  expect(host.textContent).toContain('Attempt 1')

  await act(async () => requests[0].resolve())
  expect(copy?.textContent).toBe('Retry copy')
  expect(host.textContent).toContain('Attempt 1')

  await act(async () => root.unmount())
  host.remove()
})
