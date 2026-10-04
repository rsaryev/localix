import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { composerBus, type ComposerInsert } from '@/shared/lib/composerBus'
import { useComments } from '@localixai/plugin-sdk/ui/comments'
import type { VisualFeedbackBridge } from './useVisualFeedback'

/**
 * Picking an element opens a card, the way commenting on a sentence does: the note is the
 * point of the gesture, and it is optional because the screenshot already says which element.
 * The pick used to attach itself the instant it was made, with a canned sentence for a note.
 */

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})
afterEach(() => {
  useComments.setState({ comments: [] })
})

const capture = {
  kind: 'element' as const,
  summary: 'Title',
  selector: '#title',
  domPath: 'h1',
  classes: '',
  text: 'Selected title',
  rect: { x: 0, y: 0, width: 100, height: 30 },
}

function makeBridge(overrides: Partial<VisualFeedbackBridge> = {}): VisualFeedbackBridge {
  return {
    connected: true,
    mode: 'comment',
    pending: { capture, rect: capture.rect },
    setMode() {},
    clearPending() {},
    setMarks() {},
    notifyReload() {},
    reveal() {},
    async runCommand() {
      return { ok: false }
    },
    async whenConnected() {
      return true
    },
    async captureElement() {
      return { mediaType: 'image/jpeg', data: 'YWJj', width: 10, height: 10 }
    },
    ...overrides,
  }
}

test('an element pick opens the note card and attaches only when it is submitted', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { VisualFeedbackLayer } = await import('./VisualFeedbackLayer')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let cleared = 0
  const bridge = makeBridge({
    clearPending() {
      cleared++
    },
  })
  const inserts: ComposerInsert[] = []
  const off = composerBus.subscribe((insert) => {
    inserts.push(insert)
    return true
  })
  try {
    await act(async () =>
      root.render(
        <VisualFeedbackLayer
          bridge={bridge}
          sessionId="preview-binding-test"
          url="http://localhost:5173"
        />,
      ),
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    // The card is up and nothing has been attached yet.
    const field = host.querySelector('textarea')
    expect(field).not.toBeNull()
    expect(inserts).toHaveLength(0)

    const form = host.querySelector('form')
    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    // An empty note is allowed: the screenshot rides as the binding's nested evidence.
    expect(inserts).toHaveLength(1)
    expect(inserts[0]?.text).toBeUndefined()
    expect(inserts[0]?.sessionId).toBe('preview-binding-test')
    const binding = inserts[0]?.bindings?.[0]
    expect(binding?.kind).toBe('context')
    expect(binding?.kind === 'context' ? binding.assets?.[0]?.kind : undefined).toBe('image')
    expect(cleared).toBe(1)
  } finally {
    off()
    await act(async () => root.unmount())
    host.remove()
  }
})

test('a text quick-add attaches on the spot — the words already are the comment', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { VisualFeedbackLayer } = await import('./VisualFeedbackLayer')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const quickAdd = { ...capture, kind: 'text' as const, selector: '' }
  const inserts: ComposerInsert[] = []
  const off = composerBus.subscribe((insert) => {
    inserts.push(insert)
    return true
  })
  try {
    await act(async () =>
      root.render(
        <VisualFeedbackLayer
          bridge={makeBridge({ pending: { capture: quickAdd, rect: quickAdd.rect } })}
          sessionId="preview-quick-add"
          url="http://localhost:5173"
        />,
      ),
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(host.querySelector('textarea')).toBeNull()
    expect(inserts).toHaveLength(1)
  } finally {
    off()
    await act(async () => root.unmount())
    host.remove()
  }
})
