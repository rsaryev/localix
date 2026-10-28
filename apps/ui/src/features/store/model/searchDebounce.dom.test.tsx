import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { SEARCH_DEBOUNCE_MS } from './searchDebounce'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())
afterEach(() => jest.useRealTimers())

describe('the search’s debounce', () => {
  test('settles 150 ms after the last key, and an earlier word never lands after a later one', async () => {
    jest.useFakeTimers()
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { useDebounced } = await import('@localixai/mini-app-sdk/ui/runtime-hooks')
    const seen: string[] = []
    function Probe({ value }: { value: string }) {
      seen.push(useDebounced(value, SEARCH_DEBOUNCE_MS))
      return null
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    const render = (value: string) => React.act(async () => root.render(<Probe value={value} />))
    await render('c')
    await render('ch')
    await React.act(async () => void jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1))
    await render('che')
    await React.act(async () => void jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1))
    expect(new Set(seen)).toEqual(new Set(['c']))
    await React.act(async () => void jest.advanceTimersByTime(1))
    expect(seen.at(-1)).toBe('che')
    expect(seen).not.toContain('ch')
    await React.act(async () => root.unmount())
  })
})
