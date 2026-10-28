import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { useComments } from '@localixai/mini-app-sdk/ui/comments'
import { reviewCommentBinding } from '@/shared/lib/reviewCommentBinding'
import { refFromContextBinding } from './composerBindingRefs'
import type { UseContextRefsResult } from './contextRefTypes'

/**
 * A review comment's chip IS the comment. Removing the chip by hand used to leave the comment in
 * its store, so the element it was made on stayed tinted for a comment that went nowhere.
 */

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

test('removing a review comment chip withdraws the comment', async () => {
  const { act, useEffect } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useContextRefs } = await import('./useContextRefs')
  const id = useComments
    .getState()
    .add('preview:s:http://localhost', { kind: 'element', targetId: '#a', label: 'A' }, 'Bigger')
  const kept = useComments
    .getState()
    .add('preview:s:http://localhost', { kind: 'element', targetId: '#b', label: 'B' }, 'Keep')
  let refs: UseContextRefsResult | undefined
  function Harness() {
    const current = useContextRefs('', { projectId: null, sessionId: null }, undefined)
    useEffect(() => {
      refs = current
    })
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Harness />))
    const binding = reviewCommentBinding({ token: id, label: 'Preview: A', content: 'Bigger' })
    const ref = refFromContextBinding(binding)!
    await act(async () => refs!.addPinnedRef(ref))
    await act(async () => refs!.removeRef(ref.key))
    expect(useComments.getState().comments.map((c) => c.id)).toEqual([kept])
  } finally {
    useComments.setState({ comments: [] })
    await act(async () => root.unmount())
    host.remove()
  }
})
