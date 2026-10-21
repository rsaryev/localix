import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('useSearchProject', () => {
  test('reads the projects without re-rendering forever, and falls back to the active one', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { useChatStore } = await import('@/entities/chat/model/store')
    const { useSearchProject } = await import('./useSearchProject')
    useChatStore.setState({
      projects: [
        { id: 'p1', name: 'localix' },
        { id: 'p2', name: 'site' },
      ] as never,
      activeProjectId: 'p2',
    })
    let renders = 0
    let seen: ReturnType<typeof useSearchProject> | null = null
    function Probe() {
      renders += 1
      seen = useSearchProject(null)
      return null
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Probe />))
      expect(renders).toBeLessThan(5)
      expect(seen!.projectId).toBe('p2')
      expect(seen!.projects.map((p) => p.name)).toEqual(['localix', 'site'])
    } finally {
      await act(async () => root.unmount())
    }
  })
})
