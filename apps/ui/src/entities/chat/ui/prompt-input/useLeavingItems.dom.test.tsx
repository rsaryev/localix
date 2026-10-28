import { afterAll, afterEach, beforeAll, expect, jest, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())
afterEach(() => jest.useRealTimers())

test('a removed entry stays in its place for the exit beat, then goes', async () => {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { useLeavingItems } = await import('./useLeavingItems')
  let seen: { id: string; leaving: boolean }[] = []
  function Probe({ items }: { items: { id: string }[] }) {
    const entries = useLeavingItems(items, 20)
    React.useEffect(() => {
      seen = entries.map((entry) => ({ id: entry.item.id, leaving: entry.leaving }))
    })
    return null
  }
  jest.useFakeTimers()
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Probe items={[{ id: 'a' }, { id: 'b' }, { id: 'c' }]} />))
  await act(async () => root.render(<Probe items={[{ id: 'a' }, { id: 'c' }]} />))
  expect(seen).toEqual([
    { id: 'a', leaving: false },
    { id: 'b', leaving: true },
    { id: 'c', leaving: false },
  ])
  await act(async () => {
    jest.advanceTimersByTime(20)
  })
  expect(seen).toEqual([
    { id: 'a', leaving: false },
    { id: 'c', leaving: false },
  ])
  await act(async () => root.unmount())
})
