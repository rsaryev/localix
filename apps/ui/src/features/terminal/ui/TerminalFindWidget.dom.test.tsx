import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { FindState } from './TerminalFindWidget'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const setInputValue = (input: HTMLInputElement, value: string): void => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
}

describe('TerminalFindWidget', () => {
  test('uses the shared search landmark and disables impossible navigation', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { TerminalFindWidget } = await import('./TerminalFindWidget')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <TerminalFindWidget
            find={{ open: true, term: '', caseSensitive: false, count: 0, index: 0 }}
            inputRef={{ current: null }}
            setFind={() => {}}
            runSearch={() => {}}
            onClose={() => {}}
          />,
        )
      })

      const surface = host.querySelector<HTMLElement>('[data-slot="find-widget"][role="search"]')!
      expect(surface.getAttribute('aria-label')).toBe('Find in terminal')
      expect(surface.querySelector('[data-slot="find-widget-input"]')).not.toBeNull()
      expect(
        surface.querySelector('[data-slot="find-widget-count"]')?.getAttribute('data-state'),
      ).toBe('empty')
      expect(
        surface.querySelector<HTMLButtonElement>('button[aria-label="Previous match"]')?.disabled,
      ).toBe(true)
      expect(
        surface.querySelector<HTMLButtonElement>('button[aria-label="Next match"]')?.disabled,
      ).toBe(true)
      expect(surface.querySelector<HTMLButtonElement>('[aria-label="Close find"]')?.disabled).toBe(
        false,
      )
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('keeps query, toggle, direction, and Escape behavior consumer-owned', async () => {
    const React = await import('react')
    const { act, useRef, useState } = React
    const { createRoot } = await import('react-dom/client')
    const { TerminalFindWidget } = await import('./TerminalFindWidget')
    const runSearch = mock(() => {})
    const onClose = mock(() => {})
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    function Harness() {
      const [find, setFind] = useState<FindState>({
        open: true,
        term: 'needle',
        caseSensitive: false,
        count: 3,
        index: 1,
      })
      const inputRef = useRef<HTMLInputElement>(null)
      return (
        <TerminalFindWidget
          find={find}
          inputRef={inputRef}
          setFind={setFind}
          runSearch={runSearch}
          onClose={onClose}
        />
      )
    }

    try {
      await act(async () => root.render(<Harness />))
      const input = host.querySelector<HTMLInputElement>('[data-slot="find-widget-input"]')!
      const count = host.querySelector<HTMLOutputElement>('[data-slot="find-widget-count"]')!
      const matchCase = host.querySelector<HTMLButtonElement>('[aria-label="Match case"]')!
      const previous = host.querySelector<HTMLButtonElement>('[aria-label="Previous match"]')!
      const next = host.querySelector<HTMLButtonElement>('[aria-label="Next match"]')!
      const close = host.querySelector<HTMLButtonElement>('[aria-label="Close find"]')!

      expect(input.value).toBe('needle')
      expect(count.textContent).toBe('2/3')
      expect(count.getAttribute('aria-label')).toBe('2 of 3 matches')
      expect(previous.disabled).toBe(false)
      expect(next.disabled).toBe(false)
      expect(matchCase.getAttribute('aria-pressed')).toBe('false')

      await act(async () => matchCase.click())
      expect(matchCase.getAttribute('aria-pressed')).toBe('true')
      expect(runSearch).toHaveBeenLastCalledWith('needle', {
        caseSensitive: true,
        forward: true,
      })

      await act(async () => previous.click())
      expect(runSearch).toHaveBeenLastCalledWith('needle', {
        caseSensitive: true,
        forward: false,
      })

      await act(async () => next.click())
      expect(runSearch).toHaveBeenLastCalledWith('needle', {
        caseSensitive: true,
        forward: true,
      })

      await act(async () => setInputValue(input, 'other'))
      expect(input.value).toBe('other')
      expect(runSearch).toHaveBeenLastCalledWith('other', {
        caseSensitive: true,
        forward: true,
      })

      await act(async () => {
        input.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          }),
        )
      })
      expect(runSearch).toHaveBeenLastCalledWith('other', {
        caseSensitive: true,
        forward: false,
      })

      await act(async () => {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        )
      })
      expect(onClose).toHaveBeenCalledTimes(1)

      await act(async () => close.click())
      expect(onClose).toHaveBeenCalledTimes(2)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
