import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

/**
 * A cold launch lands on `/`, which the launch restore redirects to the remembered project. The
 * contribution store used to treat that transient route as the GLOBAL scope: it discarded the
 * restored frame, published the global plugin set, emptied it at the redirect and only then
 * loaded the project's — the rail flickered three times.
 */
describe('the contribution scope across a home route', () => {
  test('holds on a cold home route, then follows the route; a later home visit keeps the scope', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { useSettledContribScope } = await import('./useSettledContribScope')
    const seen: Array<string | null | undefined> = []
    function Probe({ route, home }: { route: string | null; home: boolean }) {
      seen.push(useSettledContribScope(route, home))
      return null
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    const last = () => seen[seen.length - 1]
    try {
      // Cold `/`: nothing settled — no scope is prepared and no global snapshot is fetched.
      await act(async () => root.render(<Probe route={null} home />))
      expect(seen.every((scope) => scope === undefined)).toBe(true)
      // The restore lands on the remembered project.
      await act(async () => root.render(<Probe route="p1" home={false} />))
      expect(last()).toBe('p1')
      // An in-app visit home keeps p1 rather than flashing the global set before the draft lands.
      await act(async () => root.render(<Probe route={null} home />))
      expect(last()).toBe('p1')
      await act(async () => root.render(<Probe route="p2" home={false} />))
      expect(last()).toBe('p2')
      // A route that IS global (a session under `/global`) is not a home route: it is followed.
      await act(async () => root.render(<Probe route={null} home={false} />))
      expect(last()).toBeNull()
    } finally {
      await act(async () => root.unmount())
    }
  })
})
