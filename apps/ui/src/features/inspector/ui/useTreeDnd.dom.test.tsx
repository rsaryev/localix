import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { useTreeDnd } from './useTreeDnd'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('tree drops omit illegal parents, refuse recursive moves, and clear cues on blur', async () => {
  const calls: unknown[][] = []
  let dnd: ReturnType<typeof useTreeDnd>
  function Harness() {
    dnd = useTreeDnd(new Set(['/src', '/src/a.ts', '/other.ts']), (...args) => {
      calls.push(args)
    })
    return <div data-over={dnd.dragOverKey ?? ''} />
  }
  const host = document.createElement('div')
  document.body.append(host)
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(host)
  const values = new Map<string, string>()
  const event = {
    dataTransfer: {
      get types() {
        return [...values.keys()]
      },
      setData: (key: string, value: string) => values.set(key, value),
      getData: (key: string) => values.get(key) ?? '',
    },
    altKey: false,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as React.DragEvent
  try {
    await act(async () => root.render(<Harness />))
    await act(async () => dnd!.beginDrag(event, '/src', '/src/'))
    await act(async () => dnd!.dropTarget('folder', '/src/nested').onDragOver(event))
    expect(host.firstElementChild?.getAttribute('data-over')).toBe('folder')
    await act(async () => dnd!.dropTarget('folder', '/src/nested').onDrop(event))
    expect(calls).toEqual([[['/other.ts'], '/src/nested', false]])

    values.set('application/x-localix-tree-path', '/src')
    await act(async () => dnd!.dropTarget('folder', '/src/nested').onDrop(event))
    expect(calls).toHaveLength(1)
    await act(async () => dnd!.beginDrag(event, '/src', '/src/'))
    await act(async () => dnd!.dropTarget('folder', '/target').onDragOver(event))
    expect(host.firstElementChild?.getAttribute('data-over')).toBe('folder')
    await act(async () => window.dispatchEvent(new Event('blur')))
    expect(host.firstElementChild?.getAttribute('data-over')).toBe('')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
