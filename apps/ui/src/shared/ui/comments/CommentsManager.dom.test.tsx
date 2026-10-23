import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import type { CommentActionContribution } from '@localixai/mini-app-sdk/ui'
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const ACTION_OWNER = 'comment-action-fixture'

describe('CommentsManager actions', () => {
  test('keeps batch decisions named and immediately actionable around the scroll body', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { CommentsManager } = await import('./CommentsManager')
    const { registerCommentAction, removeCommentActionsOf } =
      await import('@/shared/contrib/commentActions')
    const { setEnabledMiniAppNames } = await import('@/shared/contrib/miniAppActivation')
    const onClear = mock(() => {})
    const onSubmit = mock(() => {})
    const onAction = mock((_action: CommentActionContribution) => {})
    const onRemove = mock((_id: string) => {})
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    // A contributed action is what earns a button beside Send; the host names none of its own.
    const action: CommentActionContribution = {
      id: `${ACTION_OWNER}:track`,
      label: 'Track',
      Icon: () => null,
      miniAppName: ACTION_OWNER,
      run: async () => {},
    }
    setEnabledMiniAppNames(new Set([ACTION_OWNER]))
    registerCommentAction(action)

    try {
      await act(async () =>
        root.render(
          <CommentsManager
            comments={[
              {
                id: 'comment-1',
                scope: 'session-1',
                anchor: {
                  kind: 'file',
                  targetId: '/repo/src/a.ts',
                  label: 'Line 12',
                  groupLabel: 'src/a.ts',
                  context: 'const value = 1',
                },
                body: 'Use the shared helper.',
              },
            ]}
            submitLabel="Add to message"
            onClear={onClear}
            onSubmit={onSubmit}
            onAction={onAction}
            onRemove={onRemove}
          />,
        ),
      )

      await act(async () => {
        host.querySelector<HTMLButtonElement>('[aria-label="Review 1 comment"]')!.click()
        await settle()
      })

      const content = document.body.querySelector<HTMLElement>('[data-slot="popover-content"]')!
      const actionGroup = content.querySelector<HTMLElement>(
        '[role="group"][aria-label="Comment batch actions"]',
      )
      expect(actionGroup).not.toBeNull()
      expect(content.querySelector('[data-slot="popover-header"]')).not.toBeNull()
      expect(content.querySelector('[data-slot="popover-body"]')).not.toBeNull()
      expect(content.querySelector('h2')?.textContent).toBe('1 comment')

      const byText = (label: string) =>
        Array.from(content.querySelectorAll<HTMLButtonElement>('button')).find(
          (button) => button.textContent?.trim() === label,
        )!

      await act(async () => byText('Clear').click())
      await act(async () => byText('Track').click())
      await act(async () => byText('Add to message').click())
      await act(async () =>
        content.querySelector<HTMLButtonElement>('[aria-label="Remove comment"]')!.click(),
      )

      expect(onClear).toHaveBeenCalledTimes(1)
      expect(onAction).toHaveBeenCalledWith(action)
      expect(onSubmit).toHaveBeenCalledTimes(1)
      expect(onRemove).toHaveBeenCalledWith('comment-1')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      removeCommentActionsOf(ACTION_OWNER)
      setEnabledMiniAppNames(null)
    }
  })
})
