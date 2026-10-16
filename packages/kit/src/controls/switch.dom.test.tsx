import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
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

describe('Switch DOM runtime', () => {
  test('keeps native label activation and controlled state in sync', async () => {
    const React = await import('react')
    const { act, useState } = React
    const { createRoot } = await import('react-dom/client')
    const { Switch } = await import('./switch')
    const onCheckedChange = mock((_checked: boolean) => {})
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    function Harness() {
      const [checked, setChecked] = useState(false)
      return (
        <label>
          Background sync
          <Switch
            checked={checked}
            onChange={(event) => {
              onCheckedChange(event.currentTarget.checked)
              setChecked(event.currentTarget.checked)
            }}
          />
        </label>
      )
    }

    try {
      await act(async () => root.render(<Harness />))
      const input = host.querySelector<HTMLInputElement>('[role="switch"]')!

      expect(input.type).toBe('checkbox')
      expect(input.checked).toBe(false)
      expect(input.getAttribute('aria-checked')).toBe('false')

      await act(async () => host.querySelector('label')?.click())

      expect(onCheckedChange).toHaveBeenCalledWith(true)
      expect(input.checked).toBe(true)
      expect(input.getAttribute('aria-checked')).toBe('true')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('participates in native form submission and forwards the input ref', async () => {
    const React = await import('react')
    const { act, createRef } = React
    const { createRoot } = await import('react-dom/client')
    const { Switch } = await import('./switch')
    const ref = createRef<HTMLInputElement>()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <form>
            <Switch
              ref={ref}
              checked
              name="backgroundSync"
              value="enabled"
              onChange={() => {}}
              aria-label="Background sync"
            />
          </form>,
        ),
      )

      const form = host.querySelector('form')!
      expect(ref.current).toBe(host.querySelector('input'))
      expect(new FormData(form).get('backgroundSync')).toBe('enabled')

      await act(async () =>
        root.render(
          <form>
            <Switch
              ref={ref}
              checked={false}
              name="backgroundSync"
              value="enabled"
              onChange={() => {}}
              aria-label="Background sync"
            />
          </form>,
        ),
      )

      expect(new FormData(host.querySelector('form')!).has('backgroundSync')).toBe(false)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
