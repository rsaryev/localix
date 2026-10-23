import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('SegmentedRadioGroup DOM runtime', () => {
  test('commits a labelled native choice and submits only that value', async () => {
    const React = await import('react')
    const { act, useState } = React
    const { createRoot } = await import('react-dom/client')
    const { SegmentedRadioGroup } = await import('@localixai/mini-app-sdk/ui/segmented-control')
    const onValueChange = mock((_value: string) => {})
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    function Harness() {
      const [value, setValue] = useState('standard')
      return (
        <form>
          <SegmentedRadioGroup
            name="tableOrder"
            value={value}
            onValueChange={(next) => {
              onValueChange(next)
              setValue(next)
            }}
            aria-label="Table order"
            options={[
              { value: 'standard', label: 'Standard order' },
              { value: 'signal', label: 'By signal' },
            ]}
          />
        </form>
      )
    }

    try {
      await act(async () => root.render(<Harness />))
      const radios = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="radio"]'))

      expect(radios).toHaveLength(2)
      expect(radios.every((radio) => radio.name === 'tableOrder')).toBe(true)
      expect(radios[0]?.checked).toBe(true)
      expect(new FormData(host.querySelector('form')!).get('tableOrder')).toBe('standard')

      await act(async () => radios[1]?.click())

      expect(onValueChange).toHaveBeenCalledTimes(1)
      expect(onValueChange).toHaveBeenCalledWith('signal')
      expect(radios[0]?.checked).toBe(false)
      expect(radios[1]?.checked).toBe(true)
      expect(new FormData(host.querySelector('form')!).get('tableOrder')).toBe('signal')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
