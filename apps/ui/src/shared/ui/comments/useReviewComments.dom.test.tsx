import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { composerBus, type ComposerInsert, type ComposerRetract } from '@/shared/lib/composerBus'
import { useComments } from '@localixai/mini-app-sdk/ui/comments'
import { useReviewComments, type ReviewComments } from './useReviewComments'

/**
 * A review comment is one artifact: stored where the surface can highlight it, staged where the
 * person can see what the message will carry. The claim worth pinning is that the two move
 * TOGETHER — the plan's comments used to reach the model only through one button, and the
 * preview's could be dropped from the composer while its own list still showed them.
 */

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})
// The comment store is process-wide and other suites in this run write to it, so each case
// starts from an empty one rather than asserting on whatever is left over.
beforeEach(() => {
  useComments.setState({ comments: [] })
})
afterEach(() => {
  useComments.setState({ comments: [] })
})

async function mountHook(scope: string, sessionId: string | null = 'session-1') {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  let api: ReviewComments | null = null
  function Harness() {
    api = useReviewComments(scope, sessionId)
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Harness />))
  return {
    get api() {
      return api!
    },
    act,
    unmount: () => act(async () => root.unmount()),
  }
}

test('adding stages one context binding for the session, without taking focus', async () => {
  const inserts: ComposerInsert[] = []
  const off = composerBus.subscribe((req) => {
    inserts.push(req)
    return true
  })
  const h = await mountHook('preview:session-1')
  try {
    let id = ''
    await h.act(async () => {
      id = h.api.add({
        label: 'Preview: Ship it',
        body: 'do X instead',
        content: '> the ship button\n\nMy feedback: do X instead',
        anchor: { kind: 'element', targetId: 'button', label: 'Ship it', context: 'button' },
      })
    })

    expect(useComments.getState().comments).toHaveLength(1)
    expect(inserts).toHaveLength(1)
    expect(inserts[0]?.sessionId).toBe('session-1')
    // Reading the thing you commented on must not lose the caret to the composer.
    expect(inserts[0]?.focus).toBe(false)
    const binding = inserts[0]?.bindings?.[0]
    expect(binding?.kind).toBe('context')
    expect(binding?.kind === 'context' ? binding.target.token : '').toBe(`@snippet:${id}`)
  } finally {
    off()
    await h.unmount()
  }
})

test('a surface with no chat stages nothing — no composer is guessed for it', async () => {
  const inserts: ComposerInsert[] = []
  const retractions: ComposerRetract[] = []
  const offInsert = composerBus.subscribe((req) => {
    inserts.push(req)
    return true
  })
  const offRetract = composerBus.subscribeRetract((req) => {
    retractions.push(req)
    return true
  })
  const h = await mountHook('preview:none', null)
  try {
    let id = ''
    await h.act(async () => {
      id = h.api.add({
        label: 'Preview: A',
        body: 'one',
        content: 'one',
        anchor: { kind: 'element', targetId: 'a', label: 'A' },
      })
    })
    await h.act(async () => h.api.remove(id))

    expect(inserts).toEqual([])
    expect(retractions).toEqual([])
  } finally {
    offInsert()
    offRetract()
    await h.unmount()
  }
})

test('removing a comment takes its context back out of the composer', async () => {
  const retractions: ComposerRetract[] = []
  const offInsert = composerBus.subscribe(() => true)
  const offRetract = composerBus.subscribeRetract((req) => {
    retractions.push(req)
    return true
  })
  const h = await mountHook('preview:session-1:http://localhost:8000')
  try {
    let id = ''
    await h.act(async () => {
      id = h.api.add({
        label: 'Preview: Title',
        body: 'too small',
        content: 'Preview note',
        anchor: { kind: 'element', targetId: '#title', label: 'Title' },
      })
    })
    await h.act(async () => h.api.remove(id))

    expect(useComments.getState().comments).toHaveLength(0)
    expect(retractions).toEqual([{ sessionId: 'session-1', tokens: [`@snippet:${id}`] }])
  } finally {
    offInsert()
    offRetract()
    await h.unmount()
  }
})

test('clearing the batch retracts every one of its bindings', async () => {
  const retractions: ComposerRetract[] = []
  const offInsert = composerBus.subscribe(() => true)
  const offRetract = composerBus.subscribeRetract((req) => {
    retractions.push(req)
    return true
  })
  const h = await mountHook('preview:session-1')
  try {
    await h.act(async () => {
      h.api.add({
        label: 'Preview: A',
        body: 'one',
        content: 'one',
        anchor: { kind: 'element', targetId: 'a', label: 'A' },
      })
      h.api.add({
        label: 'Preview: B',
        body: 'two',
        content: 'two',
        anchor: { kind: 'element', targetId: 'b', label: 'B' },
      })
    })
    await h.act(async () => h.api.clear())

    expect(useComments.getState().comments).toHaveLength(0)
    expect(retractions.at(-1)?.tokens).toHaveLength(2)
  } finally {
    offInsert()
    offRetract()
    await h.unmount()
  }
})
