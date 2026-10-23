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

test('renders Shell fences with Bash highlighting and copies the original source', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Markdown } = await import('@localixai/markdown/react')
  const { makeMdComponents } = await import('./docsNav')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const copied: string[] = []
  const source = 'sudo apt-get update\necho "$HOME"'
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => void copied.push(text) },
  })

  await act(async () => {
    root.render(
      <Markdown components={makeMdComponents('docs/getting-started/installation.md', () => {})}>
        {`\`\`\`shell\n${source}\n\`\`\``}
      </Markdown>,
    )
  })
  expect(host.querySelector('.docs-code-toolbar span')?.textContent).toBe('Shell')
  expect(host.querySelector('code .hljs-built_in')?.textContent).toBe('sudo')
  expect(host.querySelector('code .hljs-variable')?.textContent).toBe('$HOME')
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Copy code"]')?.click())
  expect(copied).toEqual([source])

  await act(async () => root.unmount())
  host.remove()
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
