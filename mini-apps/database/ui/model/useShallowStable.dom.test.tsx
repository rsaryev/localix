import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing'
import { useShallowStable } from './useShallowStable'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

test('the same object survives re-renders until a field actually changes', async () => {
  const seen: object[] = []
  const handler = () => {}
  function Probe({ sql }: { sql: string }) {
    // A fresh literal every render — what `useSqlConsole` returns.
    seen.push(useShallowStable({ sql, run: handler }))
    return null
  }
  // Loaded here, not at the top: react-dom must initialize after `registerDom()`.
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Probe sql="SELECT 1" />))
  await act(async () => root.render(<Probe sql="SELECT 1" />))
  await act(async () => root.render(<Probe sql="SELECT 2" />))
  expect(seen[1]).toBe(seen[0])
  expect(seen[2]).not.toBe(seen[1])
  expect(seen[2]).toEqual({ sql: 'SELECT 2', run: handler })
  // One render per update: no second "adjust state" pass.
  expect(seen).toHaveLength(3)
  await act(async () => root.unmount())
})
