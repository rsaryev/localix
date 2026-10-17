import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

/**
 * A workspace window restored on a recreated database reopened `/project/PRJ-11/…` while the
 * new database held only `PRJ-1`. The route was never checked, so the window kept minting chats
 * and publishing its UI catalog for the dead id, each refusal a new Event Center row.
 */
describe('a project route the database no longer has', () => {
  test('forgets the window record and lands home once the roster answers; a live one stays', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { useChatStore } = await import('@/features/chat/model/store')
    const { loadLastWorkspace, rememberLastWorkspace } =
      await import('@/features/chat/model/persistence')
    const { useDeadProjectRoute } = await import('./useDeadProjectRoute')
    const redirects: string[] = []
    const goReplace = (path: string) => redirects.push(path)
    function Probe({ route }: { route: string }) {
      useDeadProjectRoute(route, true, goReplace)
      return null
    }
    rememberLastWorkspace('PRJ-11', 'LOCALIX-337')
    useChatStore.setState({ projects: [], projectsLoaded: false })
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Probe route="PRJ-11" />))
      // Unconfirmed: the roster has not answered, so nothing is judged.
      expect(redirects).toEqual([])
      await act(async () => {
        useChatStore.setState({
          projects: [{ id: 'PRJ-1', isDefault: true }] as never,
          projectsLoaded: true,
        })
      })
      expect(redirects).toEqual(['/'])
      expect(loadLastWorkspace()).toBeNull()

      await act(async () => root.render(<Probe route="PRJ-1" />))
      expect(redirects).toEqual(['/'])
    } finally {
      await act(async () => root.unmount())
    }
  })
})
