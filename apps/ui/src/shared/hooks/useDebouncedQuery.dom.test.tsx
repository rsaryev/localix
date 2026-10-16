import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { useDebouncedQuery } from './useDebouncedQuery'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })

test('debounces, keeps the last write, goes idle without a query, and supersedes on demand', async () => {
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  const pending = new Map<string, (value: string) => void>()
  const started: string[] = []
  const events: string[] = []
  let supersede: () => void = () => {}
  function Harness({ query, unrelated }: { query: string; unrelated: number }) {
    void unrelated
    supersede = useDebouncedQuery([query], 20, {
      run: query
        ? () => {
            started.push(query)
            return new Promise<string>((resolve) => pending.set(query, resolve))
          }
        : null,
      onIdle: () => events.push('idle'),
      onStart: () => events.push(`start:${query}`),
      onResult: (value) => events.push(`result:${value}`),
      onSettled: () => events.push('settled'),
    })
    return null
  }
  const render = (query: string, unrelated = 0) =>
    act(async () => root.render(<Harness query={query} unrelated={unrelated} />))
  try {
    await render('a')
    await render('ab')
    await wait(40)
    // The debounce swallowed the first keystroke entirely.
    expect(started).toEqual(['ab'])
    // A re-render with unchanged deps neither restarts nor cancels the query.
    await render('ab', 1)
    await act(async () => pending.get('ab')!('AB'))
    expect(events).toEqual(['start:a', 'start:ab', 'result:AB', 'settled'])

    events.length = 0
    await render('abc')
    await wait(40)
    await render('abcd')
    await wait(40)
    // The older reply resolves after a newer query started: it is dropped.
    await act(async () => pending.get('abc')!('ABC'))
    await act(async () => pending.get('abcd')!('ABCD'))
    expect(events).toEqual(['start:abc', 'start:abcd', 'result:ABCD', 'settled'])

    events.length = 0
    await render('x')
    await wait(40)
    supersede()
    await act(async () => pending.get('x')!('X'))
    await render('')
    expect(events).toEqual(['start:x', 'idle'])
  } finally {
    await act(async () => root.unmount())
  }
})
