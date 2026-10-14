import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { saveActiveEditor, useActiveEditorSave } from './activeEditorBus'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('native Save retains the focused editor after typing and reads its latest buffer', async () => {
  const writes: string[] = []
  function Editor({ name, text }: { name: string; text: string }) {
    const onFocus = useActiveEditorSave(() => writes.push(`${name}:${text}`))
    return <textarea aria-label={name} onFocus={onFocus} value={text} readOnly />
  }
  const host = document.createElement('div')
  document.body.append(host)
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <>
          <Editor name="first" text="old" />
          <Editor name="second" text="other" />
        </>,
      ),
    )
    await act(async () => host.querySelector<HTMLTextAreaElement>('[aria-label="first"]')!.focus())
    await act(async () =>
      root.render(
        <>
          <Editor name="first" text="new buffer" />
          <Editor name="second" text="other" />
        </>,
      ),
    )
    saveActiveEditor()
    expect(writes).toEqual(['first:new buffer'])
    await act(async () => host.querySelector<HTMLTextAreaElement>('[aria-label="second"]')!.focus())
    await act(async () =>
      root.render(
        <>
          <Editor name="first" text="background edit" />
          <Editor name="second" text="latest second" />
        </>,
      ),
    )
    saveActiveEditor()
    expect(writes).toEqual(['first:new buffer', 'second:latest second'])
    await act(async () => root.unmount())
    saveActiveEditor()
    expect(writes).toHaveLength(2)
  } finally {
    host.remove()
  }
})
