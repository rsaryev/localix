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

test('a lazy named export loads on first render and draws that export with its props', async () => {
  const { act, Suspense } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { lazyNamed } = await import('./lazyNamed')
  let loads = 0
  const Panel = lazyNamed(async () => {
    loads++
    return {
      Panel: ({ title }: { title: string }) => <h2>{title}</h2>,
      Other: () => <p>other</p>,
    }
  }, 'Panel')
  expect(loads).toBe(0)

  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <Suspense fallback={<span>loading</span>}>
        <Panel title="Files" />
      </Suspense>,
    ),
  )
  expect(host.innerHTML).toBe('<h2>Files</h2>')
  expect(loads).toBe(1)
  await act(async () => root.unmount())
})
