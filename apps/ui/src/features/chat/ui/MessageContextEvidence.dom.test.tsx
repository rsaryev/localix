import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { previewFeedbackBinding } from '@/features/inspector/model/previewFeedbackBinding'
import { resolveSendRefs, refFromContextBinding } from '../model/sendRefs'
import type { MessageContextBinding } from '@/shared/api/contracts'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

function capture(): MessageContextBinding {
  const draft = previewFeedbackBinding({
    id: 'uuid-hidden',
    note: 'Increase spacing\nKeep the label',
    capture: {
      selector: '#save',
      summary: 'Save button',
      domPath: 'form > button',
      classes: '',
      kind: 'element',
      rect: { x: 0, y: 0, width: 10, height: 10 },
    },
    url: 'http://localhost:5050/',
    viewport: { width: 390, height: 844 },
    assets: [{ kind: 'image', mediaType: 'image/png', data: 'YWJj', name: 'Screenshot', size: 3 }],
  })
  return resolveSendRefs({
    pinnedRefs: [refFromContextBinding(draft)],
    textRefs: [],
    knownTextChars: 0,
    contextTokens: undefined,
  })![0]!
}

function context(
  id: string,
  label: string,
  source: 'user' | 'system' = 'user',
): MessageContextBinding {
  return {
    kind: 'context',
    id,
    source: source as MessageContextBinding['source'],
    target: { kind: 'snippet', token: `@snippet:${id}`, label, attributes: { content: label } },
    resolution: { status: 'resolved', contributions: [] },
  }
}

async function mount(bindings: MessageContextBinding[]) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { MessageContextEvidence } = await import('./MessageContextEvidence')
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const render = (next: MessageContextBinding[]) =>
    act(async () =>
      root.render(
        <MemoryRouter>
          <MessageContextEvidence bindings={next} sessionId="session-a" />
        </MemoryRouter>,
      ),
    )
  await render(bindings)
  const summary = () =>
    host.querySelector<HTMLButtonElement>('[data-slot="message-context-summary"]')!
  return {
    host,
    act,
    summary,
    rerender: render,
    openInspector: async () => {
      await act(async () => {
        summary().dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }))
        summary().click()
        await settle()
      })
    },
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('MessageContextEvidence', () => {
  test('feedback stays visible; the conversation carries no JSON and no native disclosure', async () => {
    const ui = await mount([capture()])
    try {
      const card = ui.host.firstElementChild!.firstElementChild!
      expect(card.textContent).toContain('Preview: Save button')
      expect(card.textContent).toContain('Increase spacing\nKeep the label')
      expect(card.textContent).not.toContain('@snippet:')
      expect(ui.host.querySelector('details')).toBeNull()
      expect(ui.host.querySelector('pre')).toBeNull()
      await ui.rerender([])
      expect(ui.host.textContent).toBe('')
    } finally {
      await ui.unmount()
    }
  })

  test('one summary names the first attachment and counts the rest; host context is not one', async () => {
    const ui = await mount([
      context('a', 'Browser tabs'),
      context('w', 'Working tree status', 'system'),
      context('b', 'Git — plugin context'),
      context('c', 'terminal 5693f564'),
    ])
    try {
      expect(ui.host.querySelectorAll('[data-slot="message-context-summary"]')).toHaveLength(1)
      expect(ui.summary().textContent).toBe('Browser tabs+2')
      expect(ui.summary().textContent).not.toContain('Working tree')
      await ui.openInspector()
      const text = document.body.textContent!
      expect(text).toContain('From the workspace')
      expect(text.indexOf('terminal 5693f564')).toBeLessThan(text.indexOf('From the workspace'))
      expect(text.indexOf('From the workspace')).toBeLessThan(text.indexOf('Working tree status'))
    } finally {
      await ui.unmount()
    }
    const onlyHost = await mount([context('w', 'Working tree status', 'system')])
    try {
      expect(onlyHost.summary().textContent).toBe('Workspace context')
    } finally {
      await onlyHost.unmount()
    }
  })

  test('the record of kept workspace slots is never listed, warned about, or resolved as a ref', async () => {
    // Regression: it reached the model empty by design, so it drew the "not included" triangle,
    // and opening the inspector asked the `@`-ref registry for its kind — "unknown context-ref
    // kind: system-context-selection" — which took the whole message down.
    const { systemContextSelectionBinding } = await import('@localixai/agent')
    const selection = systemContextSelectionBinding('session-a', [
      'session:permission-mode',
    ]) as MessageContextBinding
    const ui = await mount([context('w', 'Working tree status', 'system'), selection])
    try {
      expect(ui.summary().getAttribute('aria-label')).toBe('Context sent with this message: 1')
      expect(ui.summary().querySelector('.text-status-warning')).toBeNull()
      await ui.openInspector()
      expect(document.body.textContent).toContain('Working tree status')
      expect(document.body.textContent).not.toContain('System context selection')
    } finally {
      await ui.unmount()
    }
    const onlySelection = await mount([selection])
    try {
      expect(onlySelection.host.textContent).toBe('')
    } finally {
      await onlySelection.unmount()
    }
  })

  test('a closed inspector mounts no store subscription, however long the transcript', async () => {
    const { useChatStore } = await import('@/features/chat/model/store')
    const original = useChatStore.subscribe
    let subscriptions = 0
    useChatStore.subscribe = ((...args: Parameters<typeof original>) => {
      subscriptions += 1
      return original(...args)
    }) as typeof original
    const ui = await mount(Array.from({ length: 50 }, (_, i) => context(`m${i}`, `ctx ${i}`)))
    try {
      expect(subscriptions).toBe(0)
    } finally {
      useChatStore.subscribe = original
      await ui.unmount()
    }
  })

  test.each([
    ['resolved', 'Included', false],
    ['pending', 'Resolving…', false],
    ['denied', 'Denied', true],
    ['error', 'Failed', true],
  ] as const)(
    'the inspector says %s in words and warns only when it did not reach the model',
    async (state, word, warns) => {
      const binding = capture()
      binding.resolution.status = state
      const ui = await mount([binding])
      try {
        expect(ui.summary().querySelector('.lucide-triangle-alert') !== null).toBe(warns)
        await ui.openInspector()
        const row = document.querySelector('li')!
        expect(row.textContent).toContain(word)
        // The raw payload is one click further, never printed by default.
        expect(document.querySelector('li pre')).toBeNull()
        await ui.act(async () => {
          row.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click()
          await settle()
        })
        const payload = document.querySelector('li pre')!.textContent!
        expect(payload).toContain('#save')
        expect(payload).toContain('Screenshot')
      } finally {
        await ui.unmount()
      }
    },
  )
})
