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

const STEPS = ['Fastest', 'Balanced', 'Smartest'] as const

describe('Slider DOM runtime', () => {
  test('names the chosen stop, and a stop label selects it', async () => {
    const React = await import('react')
    const { act, useState } = React
    const { createRoot } = await import('react-dom/client')
    const { Slider } = await import('./slider')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    function Harness() {
      const [value, setValue] = useState(1)
      return (
        <Slider
          aria-label="Speed or quality"
          steps={STEPS}
          value={value}
          onValueChange={setValue}
        />
      )
    }

    try {
      await act(async () => root.render(<Harness />))
      const input = host.querySelector<HTMLInputElement>('input[type="range"]')!
      expect(input.getAttribute('aria-valuetext')).toBe('Balanced')
      expect(input.max).toBe('2')
      const smartest = [...host.querySelectorAll('button')].find(
        (b) => b.textContent === 'Smartest',
      )!
      await act(async () => smartest.click())
      expect(input.value).toBe('2')
      expect(input.getAttribute('aria-valuetext')).toBe('Smartest')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
