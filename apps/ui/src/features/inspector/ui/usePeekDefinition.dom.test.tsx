import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import { registerDom } from '@localixai/kit/testing/dom'
import type { PeekTarget, usePeekDefinition as usePeekDefinitionType } from './usePeekDefinition'

/**
 * The peek's report has to outlive the peek panel.
 *
 * `PeekDefinitionPanel` is mounted as `{peekTarget && …}`, and closing the peek is the NORMAL end of
 * the condition — so while the panel owned the report, the row it published could never be settled
 * and the Event Center kept asserting a read failure for the rest of the session. The fetch now
 * lives in the tab, which stays mounted and hands the hook `null`. This test is that contract.
 */

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('usePeekDefinition', () => {
  test('settles its report when the peek closes', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { WorkItemVisibilityProvider } = await import('@localixai/plugin-sdk/ui/visibility')
    const { usePeekDefinition } = await import('./usePeekDefinition')

    const read = spyOn(backendClient, 'getFileContent').mockRejectedValue(
      new Error('Cannot read /workspace/src/target.ts'),
    )
    let view: ReturnType<typeof usePeekDefinitionType> | null = null
    function Tab({ target }: { target: PeekTarget | null }) {
      view = usePeekDefinition('session-1', target)
      return null
    }
    const root = createRoot(document.createElement('div'))
    const render = (target: PeekTarget | null) =>
      act(async () => {
        root.render(
          <WorkItemVisibilityProvider visible>
            <Tab target={target} />
          </WorkItemVisibilityProvider>,
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

    try {
      await render({ file: '/workspace/src/target.ts', line: 4 })
      expect(view!.problem?.report.problems[0]).toMatchObject({
        message: 'The file this definition lives in could not be read.',
        detail: 'Cannot read /workspace/src/target.ts',
        // 1-indexed for the editor; the LSP target is 0-based.
        location: { path: '/workspace/src/target.ts', line: 5 },
      })

      // Closing the peek — the ordinary way it ends — must hand the hook `null`.
      await render(null)
      expect(view!.problem).toBeNull()
      expect(view!.content).toBeNull()
    } finally {
      await act(async () => root.unmount())
      read.mockRestore()
    }
  })
})
