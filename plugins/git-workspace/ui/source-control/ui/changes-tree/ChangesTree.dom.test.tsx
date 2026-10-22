import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import type { RepoFileChange } from '../../../../backend/source-control/contracts'
import type { ChangeActions } from '../../model/changeActions'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const change = (path: string): RepoFileChange => ({
  path,
  status: 'modified',
  staged: false,
  unstaged: true,
  insertions: 1,
  deletions: 0,
})

const FILES = Array.from({ length: 5_000 }, (_, i) =>
  change(`file-${String(i).padStart(4, '0')}.ts`),
)

const actions: ChangeActions = {
  onStage: mock(() => {}),
  onUnstage: mock(() => {}),
  onDiscard: mock(() => {}),
}

const VIEWPORT = 280
const ROW = 28

async function renderTree() {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { ChangesScrollArea } = await import('./ChangesScrollArea')
  const { ChangesTree } = await import('./ChangesTree')
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  // happy-dom lays nothing out, and the virtualizer sizes its viewport by `clientHeight` and a
  // row by `offsetHeight`: the scroll root must report a viewport from its FIRST measurement,
  // and a row its real 28px tier — a 0px row would make all 5,000 "fit" the viewport and loop
  // the measurer.
  const keys = ['offsetHeight', 'clientHeight'] as const
  const originals = keys.map((key) =>
    Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, key),
  )
  keys.forEach((key, index) =>
    Object.defineProperty(window.HTMLElement.prototype, key, {
      configurable: true,
      get(this: HTMLElement) {
        if (this.hasAttribute('data-changes-scroll-root')) return VIEWPORT
        if (this.hasAttribute('data-row-index')) return ROW
        return originals[index]?.get?.call(this) ?? 0
      },
    }),
  )
  await act(async () => {
    root.render(
      <ChangesScrollArea className="overflow-y-auto">
        <ChangesTree
          files={FILES}
          group="unstaged"
          selectedPath={null}
          actions={actions}
          onOpen={() => {}}
        />
      </ChangesScrollArea>,
    )
  })
  const cleanup = async () => {
    keys.forEach((key, index) => {
      const original = originals[index]
      if (original) Object.defineProperty(window.HTMLElement.prototype, key, original)
    })
    await act(async () => root.unmount())
    // An unmounted Radix menu hands focus back in a `setTimeout(0)`; let it fire here, not inside
    // the next test, where it pulled focus off the row that test had just focused.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    host.remove()
  }
  return { host, act, cleanup }
}

describe('virtualized ChangesTree', () => {
  test('5,000 changed files mount only a window of rows and no per-row menu roots', async () => {
    const { host, cleanup } = await renderTree()
    try {
      const mounted = host.querySelectorAll('[role="treeitem"]').length
      // The viewport's rows plus overscan — not a stub that rendered nothing.
      expect(mounted).toBeGreaterThan(VIEWPORT / ROW + 5)
      expect(mounted).toBeLessThan(80)
      // One context-menu trigger for the whole tree, not one per row.
      expect(host.querySelectorAll('[data-row-index]').length).toBe(mounted)
      expect(host.querySelectorAll('[role="tree"]').length).toBe(1)
    } finally {
      await cleanup()
    }
  })

  test('the one delegated menu acts on the row that was right-clicked', async () => {
    const { host, act, cleanup } = await renderTree()
    try {
      const row = host.querySelector<HTMLElement>('[data-tree-path="file-0003.ts"]')!
      await act(async () => {
        row.dispatchEvent(
          new window.MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }),
        )
      })
      const stage = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
        (item) => item.textContent === 'Stage',
      )
      expect(stage).toBeDefined()
      await act(async () => {
        stage!.click()
      })
      expect(actions.onStage).toHaveBeenCalledWith(['file-0003.ts'])
    } finally {
      await cleanup()
    }
  })

  test('End reaches the last file even though it was never mounted', async () => {
    const { host, act, cleanup } = await renderTree()
    try {
      const first = host.querySelector<HTMLElement>('[role="treeitem"]')!
      expect(first.tabIndex).toBe(0)
      expect(host.querySelector('[data-tree-path="file-4999.ts"]')).toBeNull()
      await act(async () => {
        first.focus()
        first.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }))
      })
      // The jump scrolls first and focuses on a later frame, once the row is mounted; the
      // virtualizer may take several frames to settle, so wait on the focus, not on a clock.
      await act(async () => {
        const focused = () =>
          (document.activeElement as HTMLElement | null)?.dataset?.treePath === 'file-4999.ts'
        for (let frame = 0; frame < 30 && !focused(); frame++) {
          await new Promise((resolve) => requestAnimationFrame(resolve))
        }
      })
      const last = host.querySelector<HTMLElement>('[data-tree-path="file-4999.ts"]')
      expect(last).not.toBeNull()
      expect(document.activeElement).toBe(last)
      // Exactly one Tab stop, and it moved with focus.
      expect(host.querySelectorAll('[role="treeitem"][tabindex="0"]').length).toBe(1)
      expect(last!.tabIndex).toBe(0)
    } finally {
      await cleanup()
    }
  })
})
