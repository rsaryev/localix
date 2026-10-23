import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import { bindMiniAppUiRuntime, type MiniAppUiRuntime } from '@localixai/mini-app-sdk/ui/runtime'

let teardown: () => Promise<void>
let unbindRuntime: () => void
beforeAll(() => {
  unbindRuntime = bindMiniAppUiRuntime({
    editor: {
      subscribe: () => () => {},
      predictionEnabled: () => false,
    },
    // The route is off in this suite: the host hook would offer nothing and consume no key.
    completion: {
      useTextInput: () => ({
        suggestion: '',
        accept: () => false,
        dismiss: () => false,
        request: () => false,
        handleKeyDown: () => false,
        handleCompositionStart: () => {},
        handleCompositionEnd: () => {},
      }),
    },
  } as unknown as MiniAppUiRuntime)
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
  unbindRuntime()
})

/**
 * Set a controlled textarea's value the way a user does: through the native value setter (React's
 * own descriptor would swallow the assignment) plus a bubbling `input` event, so the real onChange
 * runs. Called through the descriptor rather than held in a variable — an unbound method reference
 * is what `lint` (typescript/unbound-method) rejects.
 */
function typeInto(textarea: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(
    textarea,
    value,
  )
  textarea.dispatchEvent(new window.Event('input', { bubbles: true }))
}

describe('CommitBox submission ownership', () => {
  test('keeps the draft after a failed commit and clears it only after success', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { CommitBox } = await import('./CommitBox')
    const onCommit = mock(async () => false)
    const host = document.createElement('div')
    const root = createRoot(host)

    const render = (commit: (message: string) => Promise<boolean>) =>
      act(async () => {
        root.render(
          <CommitBox
            sessionId="s1"
            repoRoot="/workspace/a"
            contextKey="v1"
            stagedCount={1}
            headMessage={null}
            recentMessages={[]}
            onCommit={commit}
            onAmend={async () => false}
          />,
        )
      })

    await render(onCommit)
    const textarea = host.querySelector('textarea')!
    const button = host.querySelector<HTMLButtonElement>('button[title^="Commit 1 staged"]')!

    try {
      await act(async () => typeInto(textarea, 'fix: keep this draft'))
      await act(async () => button.click())

      expect(onCommit).toHaveBeenCalledWith('fix: keep this draft')
      expect(textarea.value).toBe('fix: keep this draft')

      const successfulCommit = mock(async () => true)
      await render(successfulCommit)
      await act(async () => button.click())

      expect(successfulCommit).toHaveBeenCalledWith('fix: keep this draft')
      expect(textarea.value).toBe('')
    } finally {
      await act(async () => root.unmount())
    }
  })
})
