import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act, useRef } from 'react'
import { registerDom } from '../testing/dom'
import { runNativeEditCommand, useNativeEditTarget } from './native-editing'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('native commands follow board focus, use current actions, and leave text fields alone', async () => {
  const calls: string[] = []
  function Board({ name }: { name: string }) {
    const root = useRef<HTMLDivElement>(null)
    useNativeEditTarget(root, (command) => calls.push(`${name}:${command}`))
    return (
      <div ref={root}>
        <button>Board tool</button>
        <textarea defaultValue="Draft text" />
      </div>
    )
  }
  const host = document.createElement('div')
  document.body.append(host)
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(host)
  const outside = document.createElement('textarea')
  outside.value = 'Outside text'
  document.body.append(outside)
  try {
    await act(async () => root.render(<Board name="first" />))
    host.querySelector('button')!.focus()
    runNativeEditCommand('undo')
    runNativeEditCommand('redo')
    runNativeEditCommand('select_all')
    await act(async () => root.render(<Board name="updated" />))
    runNativeEditCommand('undo')
    expect(calls).toEqual(['first:undo', 'first:redo', 'first:select_all', 'updated:undo'])
    const field = host.querySelector('textarea')!
    field.focus()
    runNativeEditCommand('select_all')
    expect(field.selectionStart).toBe(0)
    expect(field.selectionEnd).toBe(field.value.length)
    outside.focus()
    runNativeEditCommand('select_all')
    expect(outside.selectionEnd).toBe(outside.value.length)
    expect(calls).toHaveLength(4)
    expect(runNativeEditCommand('unknown')).toBe(false)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    outside.remove()
  }
})
