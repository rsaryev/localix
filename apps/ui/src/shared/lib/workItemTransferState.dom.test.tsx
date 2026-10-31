import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { useWorkItemTransferPending, workItemTransferState } from './workItemTransferState'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

test('the pending set follows begin and finish, and keeps its identity in between', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const seen: ReadonlySet<string>[] = []
  function Probe({ tick }: { tick: number }) {
    seen.push(useWorkItemTransferPending())
    return <span>{tick}</span>
  }
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(<Probe tick={0} />))
    await act(async () => void workItemTransferState.begin('a'))
    expect([...seen.at(-1)!]).toEqual(['a'])

    const before = seen.at(-1)
    await act(async () => root.render(<Probe tick={1} />))
    await act(async () => workItemTransferState.finish('b'))
    expect(seen.at(-1)).toBe(before)

    await act(async () => workItemTransferState.finish('a'))
    expect([...seen.at(-1)!]).toEqual([])
  } finally {
    await act(async () => root.unmount())
  }
})
