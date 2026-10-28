import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'

let teardown: () => Promise<void>
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const priorActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT
beforeAll(() => {
  teardown = registerDom()
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
  if (priorActEnvironment === undefined) delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
  else actEnvironment.IS_REACT_ACT_ENVIRONMENT = priorActEnvironment
})

/**
 * `doneIds` is rebuilt from the task list on every board stream frame. If its
 * IDENTITY changed each time, it would be a changed prop on every card and would
 * silently defeat `memo(TaskCard)` for the entire board — the exact regression
 * `cards.memo.test.tsx` guards against, arriving through the back door.
 */
describe('useStableIdSet', () => {
  async function harness() {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { useStableIdSet } = await import('./useStableIdSet')

    const seen: Array<Set<string>> = []
    let setIds: (ids: string[]) => void = () => {}
    function Probe({ initial }: { initial: string[] }) {
      const [ids, set] = React.useState(initial)
      React.useEffect(() => {
        setIds = set
      }, [set])
      seen.push(useStableIdSet(ids))
      return null
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(React.createElement(Probe, { initial: ['a', 'b'] }))
    })
    return {
      seen,
      push: async (ids: string[]) => {
        await act(async () => setIds(ids))
      },
      cleanup: async () => {
        await act(async () => root.unmount())
        host.remove()
      },
    }
  }

  test('a fresh array with the same ids keeps the previous Set identity', async () => {
    const h = await harness()
    await h.push(['b', 'a'])
    await h.push(['a', 'b'])

    expect(h.seen.length).toBeGreaterThanOrEqual(3)
    expect(h.seen.at(-1)).toBe(h.seen[0]!)
    await h.cleanup()
  })

  test('a genuine content change yields a new Set', async () => {
    // The stability must come from comparing contents, not from never updating.
    const h = await harness()
    await h.push(['a', 'b', 'c'])

    expect(h.seen.at(-1)).not.toBe(h.seen[0]!)
    expect([...h.seen.at(-1)!].sort()).toEqual(['a', 'b', 'c'])
    await h.cleanup()
  })

  test('a same-size swap is still a change', async () => {
    // Size alone is not identity — ['a','b'] → ['a','c'] must not be held.
    const h = await harness()
    await h.push(['a', 'c'])

    expect(h.seen.at(-1)).not.toBe(h.seen[0]!)
    await h.cleanup()
  })
})
