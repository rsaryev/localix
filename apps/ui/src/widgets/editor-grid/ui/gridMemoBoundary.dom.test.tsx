import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

/**
 * Dragging a split sash writes the grid store on EVERY mousemove, so GridView
 * re-renders 60–120×/s — and before these boundaries existed that dragged every
 * mounted group and every mounted body (chat, terminal, editor, preview) along with
 * it. A drag should write sizes to the DOM and never re-create the views
 * mid-drag; these memos enforce that.
 *
 * A memo that cannot bail is pure overhead, so the tests below PROVE the bail with a
 * counting getter on a prop the component reads while rendering, rather than
 * asserting that `memo(` appears somewhere.
 */
describe('editor grid memo boundaries', () => {
  test('a leaf keeps its identity across a resize — the precondition for the bail', async () => {
    const { makeLeaf, resizeAdjacentLeaves, leaves } =
      await import('@/entities/workspace-grid/model/tree')

    const a = makeLeaf('g1')
    const b = makeLeaf('g2')
    const root = {
      type: 'branch' as const,
      id: 'branch:g1:g2',
      orientation: 'h' as const,
      children: [a, b],
      sizes: [0.5, 0.5],
    }

    let next = resizeAdjacentLeaves(root, 'g1', 'g2', 0.62)
    expect(next).not.toBe(root) // the BRANCH is cloned…
    expect(leaves(next)[0]).toBe(a) // …but the leaves are the very same objects.
    expect(leaves(next)[1]).toBe(b)

    // Ten more mousemoves' worth: still the same leaf objects.
    for (const ratio of [0.6, 0.58, 0.56, 0.54, 0.52, 0.5, 0.48, 0.46, 0.44, 0.42]) {
      next = resizeAdjacentLeaves(next, 'g1', 'g2', ratio)
    }
    expect(leaves(next)[0]).toBe(a)
    expect(leaves(next)[1]).toBe(b)
  })

  test('GroupView does not re-read its leaf when the grid re-renders around it', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { GroupView } = await import('./GroupView')

    // Counting getter: GroupView reads `leaf.tabs` while rendering (through
    // groupViewModel), so a read means the memo did NOT bail.
    let reads = 0
    const leaf = {
      type: 'leaf' as const,
      id: 'g1',
      get tabs() {
        reads += 1
        return [] as string[]
      },
      activeTab: null,
    }

    // Stands in for GridView: re-renders on every mousemove of a sash drag, handing
    // the group the exact props it already had (the leaf object survives the resize).
    function Grid({ ratio }: { ratio: number }) {
      return (
        <div style={{ width: `${ratio}%` }}>
          <GroupView leaf={leaf} resolvedTheme="dark" />
        </div>
      )
    }

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Grid ratio={50} />))
      const afterMount = reads
      expect(afterMount).toBeGreaterThan(0)
      expect(host.querySelector('[role="group"]')).not.toBeNull()

      // A drag's worth of grid re-renders.
      for (const ratio of [51, 52, 53, 54, 55, 56, 57, 58]) {
        await act(async () => root.render(<Grid ratio={ratio} />))
      }
      expect((host.firstElementChild as HTMLElement).style.width).toBe('58%')
      expect(reads).toBe(afterMount) // bailed on all eight

      // A genuinely different leaf still renders.
      await act(async () =>
        root.render(
          <GroupView
            leaf={{ type: 'leaf', id: 'g2', tabs: [], activeTab: null }}
            resolvedTheme="dark"
          />,
        ),
      )
      expect(host.querySelector('[role="group"]')).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('WorkItemBody does not re-read its item when its group re-renders', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { WorkItemBody } = await import('./registry')
    const { setEnabledMiniAppNames } = await import('@/shared/contrib/miniAppActivation')
    // Settle mini app activation, so an unknown kind is "unsupported" (a cheap, real
    // body) instead of the "restoring workspace" placeholder.
    setEnabledMiniAppNames(new Set())

    // Counting getter: the body switch reads `item.kind` while rendering.
    let reads = 0
    const item = {
      id: 'probe:1',
      title: 'Probe',
      get kind() {
        reads += 1
        return 'probe-unsupported-kind'
      },
    }

    // Stands in for GroupView: re-renders for tab-strip reasons (hover, drag
    // highlight) that the mounted bodies take no part in.
    function Group({ hover }: { hover: boolean }) {
      return (
        <div data-hover={hover || undefined}>
          <WorkItemBody item={item} visible focused resolvedTheme="dark" />
        </div>
      )
    }

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Group hover={false} />))
      const afterMount = reads
      expect(afterMount).toBeGreaterThan(0)
      expect(host.textContent).toContain('Unsupported: probe-unsupported-kind')

      for (const hover of [true, false, true, false, true]) {
        await act(async () => root.render(<Group hover={hover} />))
      }
      expect(reads).toBe(afterMount) // bailed on all five

      // A genuine prop change still renders.
      await act(async () =>
        root.render(
          <WorkItemBody
            item={{ id: 'probe:2', title: 'Other', kind: 'another-unsupported-kind' }}
            visible
            focused
            resolvedTheme="dark"
          />,
        ),
      )
      expect(host.textContent).toContain('Unsupported: another-unsupported-kind')
    } finally {
      setEnabledMiniAppNames(null)
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
