import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('Checkbox DOM runtime', () => {
  test('synchronizes the native indeterminate property and accessible mixed state', async () => {
    const React = await import('react')
    const { act, createRef } = React
    const { createRoot } = await import('react-dom/client')
    const { Checkbox } = await import('./checkbox')
    const ref = createRef<HTMLInputElement>()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(<Checkbox ref={ref} aria-label="Select visible rows" indeterminate />),
      )

      expect(ref.current?.indeterminate).toBe(true)
      expect(ref.current?.getAttribute('aria-checked')).toBe('mixed')

      await act(async () =>
        root.render(<Checkbox ref={ref} aria-label="Select visible rows" indeterminate={false} />),
      )

      expect(ref.current?.indeterminate).toBe(false)
      expect(ref.current?.hasAttribute('aria-checked')).toBe(false)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('keeps native label and change behavior', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { Checkbox } = await import('./checkbox')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let checked = false

    try {
      await act(async () =>
        root.render(
          <label>
            <Checkbox
              aria-label="Remember choice"
              onChange={(event) => {
                checked = event.target.checked
              }}
            />
            Remember choice
          </label>,
        ),
      )

      await act(async () => host.querySelector('label')?.click())

      expect(checked).toBe(true)
      expect(host.querySelector<HTMLInputElement>('input')?.checked).toBe(true)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
