import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'
import type * as StatusHostModule from './workbench-status-host'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

/**
 * The contribution rule this suite pins: the ACTIVE
 * editor of the ACTIVE group publishes its status into the ONE app status bar —
 * never two groups at once, and nothing at all when the active tab is not an
 * editor.
 */
async function renderShell(tree: (helpers: typeof StatusHostModule) => ReactElement) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const helpers = await import('./workbench-status-host')
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(tree(helpers))
  })
  return {
    host,
    outlet: () => host.querySelector('[data-slot="workbench-status-outlet"]'),
    async rerender(next: Parameters<typeof renderShell>[0]) {
      await act(async () => {
        root.render(next(helpers))
      })
    },
    async cleanup() {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('workbench status contribution', () => {
  test('the focused editor lands in the single app status bar, not under itself', async () => {
    const view = await renderShell(
      ({ WorkbenchStatusHost, WorkbenchStatusOutlet, WorkbenchStatusContribution }) => (
        <WorkbenchStatusHost>
          <main data-testid="editor-column">
            <WorkbenchStatusContribution active>
              <span data-testid="entry">Ln 21, Col 6</span>
            </WorkbenchStatusContribution>
          </main>
          <footer>
            <WorkbenchStatusOutlet />
          </footer>
        </WorkbenchStatusHost>
      ),
    )

    try {
      expect(view.outlet()?.textContent).toBe('Ln 21, Col 6')
      // The editor column itself carries no status chrome any more.
      expect(view.host.querySelector('[data-testid="editor-column"]')?.textContent).toBe('')
    } finally {
      await view.cleanup()
    }
  })

  test('a split contributes once: only the focused group, no duplicates', async () => {
    const view = await renderShell(
      ({ WorkbenchStatusHost, WorkbenchStatusOutlet, WorkbenchStatusContribution }) => (
        <WorkbenchStatusHost>
          {/* Both bodies are VISIBLE side by side; only one is focused. */}
          <WorkbenchStatusContribution active>
            <span data-entry="left">Ln 1, Col 1</span>
          </WorkbenchStatusContribution>
          <WorkbenchStatusContribution active={false}>
            <span data-entry="right">Ln 99, Col 4</span>
          </WorkbenchStatusContribution>
          <WorkbenchStatusOutlet />
        </WorkbenchStatusHost>
      ),
    )

    try {
      expect(view.outlet()?.querySelectorAll('[data-entry]').length).toBe(1)
      expect(view.outlet()?.textContent).toBe('Ln 1, Col 1')
      expect(document.querySelectorAll('[data-entry="right"]').length).toBe(0)

      // Focus moves to the other group: the bar swaps, it does not accumulate.
      await view.rerender(
        ({ WorkbenchStatusHost, WorkbenchStatusOutlet, WorkbenchStatusContribution }) => (
          <WorkbenchStatusHost>
            <WorkbenchStatusContribution active={false}>
              <span data-entry="left">Ln 1, Col 1</span>
            </WorkbenchStatusContribution>
            <WorkbenchStatusContribution active>
              <span data-entry="right">Ln 99, Col 4</span>
            </WorkbenchStatusContribution>
            <WorkbenchStatusOutlet />
          </WorkbenchStatusHost>
        ),
      )

      expect(view.outlet()?.querySelectorAll('[data-entry]').length).toBe(1)
      expect(view.outlet()?.textContent).toBe('Ln 99, Col 4')
    } finally {
      await view.cleanup()
    }
  })

  test('a non-editor tab clears the entries instead of leaving them stale', async () => {
    const view = await renderShell(
      ({ WorkbenchStatusHost, WorkbenchStatusOutlet, WorkbenchStatusContribution }) => (
        <WorkbenchStatusHost>
          <WorkbenchStatusContribution active>
            <span data-entry="file">Ln 21, Col 6</span>
          </WorkbenchStatusContribution>
          <WorkbenchStatusOutlet />
        </WorkbenchStatusHost>
      ),
    )

    try {
      expect(view.outlet()?.textContent).toBe('Ln 21, Col 6')
      // A terminal / chat tab renders no contribution at all — it unmounts.
      await view.rerender(({ WorkbenchStatusHost, WorkbenchStatusOutlet }) => (
        <WorkbenchStatusHost>
          <span>terminal</span>
          <WorkbenchStatusOutlet />
        </WorkbenchStatusHost>
      ))
      expect(view.outlet()?.textContent).toBe('')
      expect(view.outlet()).not.toBeNull()
    } finally {
      await view.cleanup()
    }
  })

  test('without a host the entries render in place rather than disappearing', async () => {
    const view = await renderShell(({ WorkbenchStatusContribution }) => (
      <WorkbenchStatusContribution active>
        <span data-testid="entry">Ln 3, Col 2</span>
      </WorkbenchStatusContribution>
    ))

    try {
      expect(view.host.textContent).toBe('Ln 3, Col 2')
    } finally {
      await view.cleanup()
    }
  })
})
