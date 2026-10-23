import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

// The defect: a mini app suite on the real host runtime asserted on the host's problem line, whose
// lazy module had not loaded on a cold cache — the line was absent and the suite failed only after
// a fresh install. Once preloaded, a lent component renders in the same act that mounts it.
describe('lent mini app UI components', () => {
  test('after the preload, the problem line renders in the act that mounts it', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { miniAppUiComponents, preloadMiniAppUiComponents } =
      await import('./miniAppUiComponents')
    await preloadMiniAppUiComponents()

    const { ProblemLine } = miniAppUiComponents
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () =>
        root.render(
          <ProblemLine
            report={{
              subject: { label: 'Table' },
              problems: [{ message: 'permission denied for table users' }],
            }}
          />,
        ),
      )
      expect(host.textContent).toContain('permission denied for table users')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('the preload covers every lent component', async () => {
    const { miniAppUiComponents, preloadMiniAppUiComponents } =
      await import('./miniAppUiComponents')
    const modules = (await preloadMiniAppUiComponents()) as unknown[]
    expect(modules).toHaveLength(Object.keys(miniAppUiComponents).length)
  })
})
