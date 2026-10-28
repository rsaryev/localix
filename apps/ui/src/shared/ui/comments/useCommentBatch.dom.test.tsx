import { afterAll, afterEach, beforeAll, expect, spyOn, test } from 'bun:test'
import { tap } from '@/testing/hookProbe'
import type { CommentActionContribution, CommentBatch } from '@localixai/mini-app-sdk/ui'
import { useComments, useScopeComments } from '@localixai/mini-app-sdk/ui/comments'
import { registerDom } from '@localixai/kit/testing/dom'
import { toast } from '@/shared/lib/notify'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const SCOPE = 'batch-fixture-session'

afterEach(() => useComments.getState().clearScope(SCOPE))

/** Mount the hook over the fixture scope and hand back its `runAction`. */
async function mountBatch() {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useCommentBatch } = await import('./useCommentBatch')
  const run = tap<(action: CommentActionContribution) => Promise<void>>()
  function Harness() {
    const comments = useScopeComments(SCOPE)
    const batch = useCommentBatch({
      sessionId: SCOPE,
      scope: SCOPE,
      comments,
      buildPayload: (cs) => ({
        sendText: 'unused',
        summary: cs.map((c) => c.body).join('\n'),
        files: [...new Set(cs.map((c) => c.anchor.targetId))],
      }),
      title: (files) => `Review ${files.length} file`,
    })
    run.put(batch.runAction)
    return null
  }
  const host = document.createElement('div')
  const root = createRoot(host)
  await React.act(async () => root.render(<Harness />))
  return {
    run: (action: CommentActionContribution) => React.act(async () => run.value!(action)),
    unmount: () => React.act(async () => root.unmount()),
  }
}

function seedComment(): void {
  useComments
    .getState()
    .add(SCOPE, { kind: 'file', targetId: '/repo/a.ts', label: 'Line 3' }, 'Rename this.')
}

const Icon = () => null

test('an action receives the batch, then the comments clear and its sentence is shown', async () => {
  const success = spyOn(toast, 'success').mockImplementation(() => '')
  seedComment()
  const received: CommentBatch[] = []
  const view = await mountBatch()
  try {
    await view.run({
      id: 'fixture:track',
      label: 'Track',
      Icon,
      run: async (batch) => {
        received.push(batch)
        return { message: 'Tracked' }
      },
    })
    expect(received).toEqual([
      { sessionId: SCOPE, title: 'Review 1 file', summary: 'Rename this.', files: ['/repo/a.ts'] },
    ])
    // MUTATION: drop `clearScope` after a resolved action → the comments linger, red.
    expect(useComments.getState().comments.filter((c) => c.scope === SCOPE)).toEqual([])
    expect(success).toHaveBeenCalledWith('Tracked')
  } finally {
    await view.unmount()
    success.mockRestore()
  }
})

test('a refused action keeps the comments and says why', async () => {
  const error = spyOn(toast, 'error').mockImplementation(() => '')
  seedComment()
  const view = await mountBatch()
  try {
    await view.run({
      id: 'fixture:track',
      label: 'Track',
      Icon,
      run: async () => {
        throw new Error('The tracker is offline')
      },
    })
    // MUTATION: clear the scope on click instead of on resolve → the review is lost, red.
    expect(useComments.getState().comments.filter((c) => c.scope === SCOPE)).toHaveLength(1)
    expect(error).toHaveBeenCalledWith('The tracker is offline')
  } finally {
    await view.unmount()
    error.mockRestore()
  }
})
