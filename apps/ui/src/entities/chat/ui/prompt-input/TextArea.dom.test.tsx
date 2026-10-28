import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { autogrowHeight, autogrowMirrorText } from './TextArea'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const LINE = 25
const MAX_HEIGHT = 176

/** Stand in for layout: the mirror's height is one line per rendered line. */
function stubMirrorLayout(mirror: HTMLElement): void {
  Object.defineProperty(mirror, 'scrollHeight', {
    configurable: true,
    get: () => (mirror.textContent ?? '').split('\n').length * LINE,
  })
}

/**
 * Records every write to `style.height` so a redundant write is visible. happy-dom's `style` is a
 * Proxy that refuses `defineProperty` and routes `style.height = x` through `setProperty`, so the
 * writes are recorded there.
 */
function recordHeightWrites(el: HTMLElement): string[] {
  const writes: string[] = []
  const setProperty = el.style.setProperty.bind(el.style)
  el.style.setProperty = (name: string, value: string | null, priority?: string) => {
    if (name === 'height') writes.push(value ?? '')
    setProperty(name, value, priority)
  }
  return writes
}

describe('composer autogrow', () => {
  test('grows from the mirror, clamps at the cap, and never writes height:auto', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { TextArea } = await import('./TextArea')

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    let setValue: ((next: string) => void) | undefined
    function Harness() {
      const [value, set] = React.useState('')
      React.useEffect(() => {
        setValue = set
      }, [set])
      return (
        <TextArea
          value={value}
          onChange={set}
          onFocus={() => {}}
          onBlur={() => {}}
          onSubmit={() => {}}
          placeholder="Ask"
          disabled={false}
        />
      )
    }

    try {
      await act(async () => root.render(<Harness />))
      const textarea = host.querySelector('textarea') as HTMLTextAreaElement
      const mirror = host.querySelector('[data-autogrow-mirror]') as HTMLElement
      expect(mirror).toBeTruthy()
      stubMirrorLayout(mirror)
      // The live textarea must never be measured: leave it at 0 so any read of
      // it would collapse the composer instead of quietly agreeing.
      Object.defineProperty(textarea, 'scrollHeight', { configurable: true, get: () => 0 })
      const writes = recordHeightWrites(textarea)

      await act(async () => setValue?.('one'))
      expect(textarea.style.height).toBe(`${LINE}px`)

      await act(async () => setValue?.('one\ntwo\nthree'))
      expect(textarea.style.height).toBe(`${3 * LINE}px`)

      // Same line count → same height → no DOM write at all.
      const beforeSameHeight = writes.length
      await act(async () => setValue?.('one\ntwo\nthreee'))
      expect(writes.length).toBe(beforeSameHeight)
      expect(textarea.style.height).toBe(`${3 * LINE}px`)

      // Paste of a large block: one write, clamped, scrollbar left to the
      // textarea's own `max-h-44` overflow.
      const beforePaste = writes.length
      await act(async () => setValue?.(Array.from({ length: 60 }, (_, i) => `l${i}`).join('\n')))
      expect(writes.length).toBe(beforePaste + 1)
      expect(textarea.style.height).toBe(`${MAX_HEIGHT}px`)

      // Shrinking back down is still possible (an `inset-0` mirror could never
      // report less than the current height).
      await act(async () => setValue?.('one'))
      expect(textarea.style.height).toBe(`${LINE}px`)

      expect(writes).not.toContain('auto')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})

describe('autogrow measurement', () => {
  test('mirror text keeps a trailing newline and an empty draft measurable', () => {
    // `white-space: pre-wrap` drops a single trailing newline; a textarea does not.
    expect(autogrowMirrorText('a\n')).toBe('a\n ')
    expect(autogrowMirrorText('')).toBe(' ')
    expect(autogrowMirrorText('a')).toBe('a')
    expect(autogrowMirrorText('a\nb')).toBe('a\nb')
  })

  test('clamps at the cap and skips unchanged or unmeasurable heights', () => {
    expect(autogrowHeight(25, -1)).toBe(25)
    expect(autogrowHeight(4_000, -1)).toBe(MAX_HEIGHT)
    expect(autogrowHeight(25, 25)).toBeNull()
    // Already clamped: further growth writes nothing.
    expect(autogrowHeight(4_000, MAX_HEIGHT)).toBeNull()
    // A composer in a hidden pane measures 0 — never write that.
    expect(autogrowHeight(0, 25)).toBeNull()
  })
})
