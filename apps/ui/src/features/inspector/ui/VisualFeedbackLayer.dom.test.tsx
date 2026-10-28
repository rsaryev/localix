import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { composerBus, type ComposerInsert } from '@/shared/lib/composerBus'
import { useComments } from '@localixai/mini-app-sdk/ui/comments'
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
    openedMark: null,
    clearOpenedMark() {},
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

/** Mount the layer with a bridge, collecting what reaches the composer. */
async function mountLayer(bridge: VisualFeedbackBridge, sessionId: string) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { VisualFeedbackLayer } = await import('./VisualFeedbackLayer')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const inserts: ComposerInsert[] = []
  const off = composerBus.subscribe((insert) => {
    inserts.push(insert)
    return true
  })
  const render = (next: VisualFeedbackBridge) =>
    act(async () =>
      root.render(
        <VisualFeedbackLayer bridge={next} sessionId={sessionId} url="http://localhost:5173" />,
      ),
    )
  await render(bridge)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return {
    host,
    inserts,
    render,
    act,
    async type(text: string) {
      const field = host.querySelector('textarea')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
          field,
          text,
        )
        field.dispatchEvent(new Event('input', { bubbles: true }))
      })
    },
    async submit() {
      await act(async () => {
        host
          .querySelector('form')
          ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
    },
    async cleanup() {
      off()
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

const scope = (sessionId: string) => `preview:${sessionId}:http://localhost:5173`

function seedComment(sessionId: string, body: string): string {
  return useComments.getState().add(
    scope(sessionId),
    {
      kind: 'element',
      targetId: '#title',
      label: 'Title',
      locator: { selector: '#title', capture, assets: [] },
    },
    body,
  )
}

test('a commented element reopens its comment, and saving refreshes the same chip', async () => {
  const id = seedComment('preview-edit', 'Too small')
  let closed = 0
  const view = await mountLayer(
    makeBridge({
      pending: null,
      openedMark: { id, rect: capture.rect },
      clearOpenedMark() {
        closed++
      },
    }),
    'preview-edit',
  )
  try {
    expect(view.host.querySelector('textarea')?.value).toBe('Too small')
    expect(view.host.textContent).toContain('#1')
    await view.type('Make it 32px')
    await view.submit()
    expect(useComments.getState().comments[0]?.body).toBe('Make it 32px')
    const token = view.inserts[0]?.bindings?.[0]
    expect(token?.kind === 'context' ? token.target.token : undefined).toBe(`@snippet:${id}`)
    expect(closed).toBe(1)
  } finally {
    await view.cleanup()
  }
})

test('deleting a reopened comment withdraws it and its chip', async () => {
  const id = seedComment('preview-delete', 'Wrong colour')
  const retracted: string[] = []
  const offRetract = composerBus.subscribeRetract((retract) => {
    retracted.push(...retract.tokens)
    return true
  })
  const view = await mountLayer(
    makeBridge({ pending: null, openedMark: { id, rect: capture.rect } }),
    'preview-delete',
  )
  try {
    const remove = view.host.querySelector<HTMLButtonElement>('[aria-label="Delete comment"]')
    await view.act(async () => remove?.click())
    expect(useComments.getState().comments).toHaveLength(0)
    expect(retracted).toEqual([`@snippet:${id}`])
  } finally {
    offRetract()
    await view.cleanup()
  }
})

test('a pick the page cannot render still attaches, and says it has no screenshot', async () => {
  const view = await mountLayer(
    makeBridge({
      async captureElement() {
        return null
      },
    }),
    'preview-no-shot',
  )
  try {
    expect(view.host.textContent).toContain('No screenshot')
    await view.submit()
    expect(view.inserts).toHaveLength(1)
  } finally {
    await view.cleanup()
  }
})

test('every comment is marked on the page with its number and note', async () => {
  const id = seedComment('preview-marks', 'Align left')
  const marks: unknown[] = []
  const view = await mountLayer(
    makeBridge({ pending: null, setMarks: (next) => marks.push(next) }),
    'preview-marks',
  )
  try {
    expect(marks.at(-1)).toEqual([{ id, selector: '#title', index: 1, note: 'Align left' }])
  } finally {
    await view.cleanup()
  }
})
