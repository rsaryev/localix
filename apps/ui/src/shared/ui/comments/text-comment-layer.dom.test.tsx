import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('TextCommentLayer comment forms', () => {
  test('keeps an empty shortcut open and submits valid text through the native form', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { TextCommentLayer } = await import('./text-comment-layer')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const originalRangeRect = Object.getOwnPropertyDescriptor(
      Range.prototype,
      'getBoundingClientRect',
    )
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(40, 20, 80, 18),
    })
    const added: Array<{ quote: string; note: string }> = []

    const pressPrimaryEnter = async () => {
      for (const modifier of ['ctrlKey', 'metaKey'] as const) {
        const textarea = host.querySelector('textarea')
        if (!textarea) break
        await act(async () => {
          textarea.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Enter',
              [modifier]: true,
              bubbles: true,
              cancelable: true,
            }),
          )
        })
      }
    }

    try {
      await act(async () => {
        root.render(
          <TextCommentLayer
            comments={[]}
            onAdd={(quote, note) => {
              added.push({ quote, note })
            }}
            onUpdate={() => {}}
            onRemove={() => {}}
          >
            <p>First sentence. Second sentence.</p>
          </TextCommentLayer>,
        )
      })

      const paragraph = host.querySelector('p')
      const text = paragraph?.firstChild
      expect(text).not.toBeNull()
      const range = document.createRange()
      range.setStart(text!, 0)
      range.setEnd(text!, 5)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      await act(async () => {
        paragraph?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      })

      const openComposer = Array.from(host.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Comment',
      )
      expect(openComposer).not.toBeUndefined()
      await act(async () => openComposer?.click())

      expect(host.querySelector('form')?.getAttribute('aria-label')).toBe(
        'Comment on selected text',
      )
      expect(host.querySelector('textarea')?.getAttribute('data-slot')).toBe('textarea')
      await pressPrimaryEnter()
      expect(added).toHaveLength(0)
      expect(host.querySelector('form')).not.toBeNull()

      const textarea = host.querySelector<HTMLTextAreaElement>('textarea')!
      await act(async () => {
        const setValue = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set?.bind(textarea)
        setValue?.('Ship it')
        textarea.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'Ship it' }))
      })
      await pressPrimaryEnter()
      expect(added).toEqual([{ quote: 'First sentence.', note: 'Ship it' }])
      expect(host.querySelector('form')).toBeNull()
    } finally {
      if (originalRangeRect) {
        Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRangeRect)
      } else {
        Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
      }
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('edits through the same labelled controls and guarded submit contract', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { TextCommentLayer } = await import('./text-comment-layer')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const originalClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [new DOMRect(20, 20, 100, 18)] as unknown as DOMRectList,
    })
    const updated: Array<{ id: string; note: string }> = []

    const setTextarea = async (value: string) => {
      const textarea = host.querySelector<HTMLTextAreaElement>('textarea')!
      await act(async () => {
        const setValue = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set?.bind(textarea)
        setValue?.(value)
        textarea.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }))
      })
    }
    const pressPrimaryEnter = async () => {
      for (const modifier of ['ctrlKey', 'metaKey'] as const) {
        const textarea = host.querySelector('textarea')
        if (!textarea) break
        await act(async () => {
          textarea.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Enter',
              [modifier]: true,
              bubbles: true,
              cancelable: true,
            }),
          )
        })
      }
    }

    try {
      await act(async () => {
        root.render(
          <TextCommentLayer
            comments={[{ id: 'comment-1', quote: 'First sentence.', note: 'Old note' }]}
            onAdd={() => {}}
            onUpdate={(id, note) => {
              updated.push({ id, note })
            }}
            onRemove={() => {}}
          >
            <p>First sentence. Second sentence.</p>
          </TextCommentLayer>,
        )
      })

      const marker = host.querySelector<HTMLButtonElement>(
        'button[data-slot="button"][aria-label="Show comment"]',
      )
      expect(marker).not.toBeNull()
      await act(async () => marker?.click())
      await act(async () =>
        host.querySelector<HTMLButtonElement>('button[aria-label="Edit comment"]')?.click(),
      )

      expect(host.querySelector('form')?.getAttribute('aria-label')).toBe('Edit comment')
      expect(host.querySelector('textarea')?.getAttribute('data-slot')).toBe('textarea')
      await setTextarea('')
      await pressPrimaryEnter()
      expect(updated).toHaveLength(0)
      expect(host.querySelector('form')).not.toBeNull()

      await setTextarea('Updated note')
      await pressPrimaryEnter()
      expect(updated).toEqual([{ id: 'comment-1', note: 'Updated note' }])
      expect(host.querySelector('form')).toBeNull()
    } finally {
      if (originalClientRects) {
        Object.defineProperty(Range.prototype, 'getClientRects', originalClientRects)
      } else {
        Reflect.deleteProperty(Range.prototype, 'getClientRects')
      }
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
