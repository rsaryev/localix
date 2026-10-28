import { afterAll, beforeAll, expect, test } from 'bun:test'
import type { TableColumn, TableRow } from '@localixai/dataview'
import { registerDom } from '@localixai/kit/testing/dom'
import type { useRowMutations as UseRowMutations } from './useRowMutations'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('row mutation commit owns one immutable staging window', async () => {
  const React = await import('react')
  const { act, useEffect } = React
  const { createRoot } = await import('react-dom/client')
  const { useRowMutations } = await import('./useRowMutations')

  const columns: TableColumn[] = [{ id: 'name', title: 'name', type: 'text' }]
  const row: TableRow = { name: 'before' }
  const pending = deferred<boolean>()
  let calls = 0
  let submitted: unknown
  let state: ReturnType<typeof UseRowMutations> | undefined

  function Harness() {
    const value = useRowMutations(columns, {
      onCommitChanges: async (changes) => {
        calls += 1
        submitted = changes
        return pending.promise
      },
    })
    useEffect(() => {
      state = value
    })
    return null
  }

  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(<Harness />))
    await act(async () => state!.commitEdit(row, 'name', 'submitted'))

    let first!: Promise<void>
    let second!: Promise<void>
    await act(async () => {
      first = state!.commitChanges()
      second = state!.commitChanges()
      state!.commitEdit(row, 'name', 'too late')
      await Promise.resolve()
    })

    expect(calls).toBe(1)
    expect(submitted).toEqual({
      updates: [{ row, values: { name: 'submitted' } }],
      inserts: [],
      deletes: [],
    })
    expect(state?.pendingEdits.get(row)).toEqual({ name: 'submitted' })

    await act(async () => {
      pending.resolve(true)
      await Promise.all([first, second])
    })
    expect(state?.pendingEdits.size).toBe(0)
    expect(state?.committing).toBe(false)
  } finally {
    await act(async () => root.unmount())
  }
})
