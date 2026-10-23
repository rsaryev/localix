import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'
import type { RichTextDocument } from '@localixai/mini-app-sdk/rich-text'
import type { Editor } from '@tiptap/react'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

test('rich editor labels its textbox, applies external revisions and respects Field read-only', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { RichTextEditor } = await import('./rich-text-editor')
  const { Field } = await import('./field')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const changes: RichTextDocument[] = []
  const render = (value: string, readOnly = false) => (
    <Field label="Description" error="Check description" readOnly={readOnly}>
      <RichTextEditor value={value} onChange={(next) => changes.push(next)} />
    </Field>
  )
  try {
    await act(async () => {
      root.render(render('Original'))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const textbox = host.querySelector('[role="textbox"]')!
    expect(textbox.textContent).toBe('Original')
    expect(textbox.getAttribute('aria-multiline')).toBe('true')
    expect(textbox.getAttribute('aria-invalid')).toBe('true')
    expect(
      host.querySelector(`[id="${textbox.getAttribute('aria-labelledby')}"]`)?.textContent,
    ).toBe('Description')
    expect(
      host
        .querySelector(`[id="${textbox.getAttribute('aria-describedby')}"]`)
        ?.getAttribute('role'),
    ).toBe('alert')
    await act(async () => root.render(render('Agent edit', true)))
    expect(textbox.textContent).toBe('Agent edit')
    expect(textbox.getAttribute('contenteditable')).toBe('false')
    expect(host.querySelector('button[aria-label="Bold"]')?.hasAttribute('disabled')).toBe(true)
    expect(changes).toEqual([])
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

test('rich viewer renders marks, list numbering and literal user HTML', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { RichTextView } = await import('../content/rich-text-view')
  const host = document.createElement('div')
  const root = createRoot(host)
  const value: RichTextDocument = {
    type: 'doc',
    content: [
      {
        type: 'orderedList',
        attrs: { start: 3 },
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: '<img onerror=evil>',
                    marks: [
                      { type: 'bold' },
                      { type: 'italic' },
                      { type: 'link', attrs: { href: 'https://example.com', rel: 'opener' } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
  try {
    await act(async () => root.render(<RichTextView value={value} />))
    expect(host.querySelector('ol')?.start).toBe(3)
    expect(host.querySelector('a em strong')?.textContent).toBe('<img onerror=evil>')
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('a')?.rel).toBe('noopener noreferrer')
  } finally {
    await act(async () => root.unmount())
  }
})

test('formatting edits emit structured content, limit guards retain content and pasted HTML stays restricted', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { RichTextEditor } = await import('./rich-text-editor')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const changes: RichTextDocument[] = []
  try {
    await act(async () =>
      root.render(
        <RichTextEditor
          aria-label="Prose"
          value="Hello"
          maxLength={20}
          onChange={(value) => changes.push(value)}
        />,
      ),
    )
    const textbox = host.querySelector('[role="textbox"]') as HTMLElement & { editor: Editor }
    const editor = textbox.editor
    await act(async () => {
      editor.commands.setTextSelection({ from: 1, to: 6 })
      ;(host.querySelector('button[aria-label="Bold"]') as HTMLButtonElement).click()
    })
    expect(changes.at(-1)?.content[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Hello', marks: [{ type: 'bold' }] }],
    })
    const before = editor.getJSON()
    await act(async () => {
      editor.commands.insertContent('This text would exceed the limit')
    })
    expect(editor.getJSON()).toEqual(before)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('20 characters')
    expect(changes).toHaveLength(1)
    await act(async () => {
      editor.commands.selectAll()
      editor.commands.insertContent('<h1>Title</h1><p><a href="javascript:evil()">safe</a></p>')
    })
    expect(textbox.querySelector('h1')).toBeNull()
    expect(textbox.querySelector('a')).toBeNull()
    expect(textbox.textContent).toBe('Titlesafe')
    await act(async () =>
      root.render(
        <RichTextEditor
          aria-label="Prose"
          value="Remote"
          maxLength={20}
          onChange={(value) => changes.push(value)}
        />,
      ),
    )
    await act(async () => {
      editor.commands.undo()
    })
    expect(textbox.textContent).toBe('Remote')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
