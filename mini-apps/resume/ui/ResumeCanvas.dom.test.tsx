import { afterAll, beforeAll, expect, test } from 'bun:test'
import { IconButton } from '@localixai/kit/icon-button'
import { Eye } from 'lucide-react'
import { registerDom } from '@localixai/kit/testing'
import type { Editor } from '@tiptap/react'
import { createTemplateDocument } from '../shared/templates'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

let teardown: () => Promise<void>
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const prior = environment.IS_REACT_ACT_ENVIRONMENT
beforeAll(() => {
  teardown = registerDom()
  environment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
  if (prior === undefined) delete environment.IS_REACT_ACT_ENVIRONMENT
  else environment.IS_REACT_ACT_ENVIRONMENT = prior
})

test('pane resizing and view switching preserve the rich editor, draft and scroll', async () => {
  const { act, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ResumeCanvas } = await import('./ResumeCanvas')
  const initial = createTemplateDocument('awal', 'Resume')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const OriginalObserver = globalThis.ResizeObserver
  const priorFontSize = document.documentElement.style.fontSize
  const callbacks: ResizeObserverCallback[] = []
  let paneWidth = 500
  class Observer {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback)
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = Observer as unknown as typeof ResizeObserver
  // Read through the descriptor: the test restores this very function, which a plain method
  // reference would hand over unbound.
  const originalRect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')!
    .value as HTMLElement['getBoundingClientRect']
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { ...originalRect.call(this).toJSON(), width: paneWidth } as DOMRect
  }
  function Harness() {
    const [preview, setPreview] = useState(false)
    const [draft, setDraft] = useState(initial)
    const [section, setSection] = useState<string | null>(initial.sections[0]!.id)
    return (
      <>
        <IconButton
          aria-label="PDF preview"
          aria-pressed={preview}
          onClick={() => setPreview((value) => !value)}
        >
          <Eye />
        </IconButton>
        <ResumeCanvas
          preview={preview}
          document={draft}
          onChange={setDraft}
          sectionId={section}
          onSection={setSection}
          pending={false}
        />
      </>
    )
  }
  try {
    await act(async () => {
      root.render(<Harness />)
      await turns()
    })
    for (let attempt = 0; !host.querySelector('[role="textbox"]') && attempt < 300; attempt++)
      await act(async () => {
        await turns()
      })
    const textbox = host.querySelector('[role="textbox"]') as HTMLElement & { editor: Editor }
    expect(textbox).not.toBeNull()
    const editor = textbox.editor
    await act(async () => editor.commands.insertContent('<strong>Saved in draft</strong>'))
    const scrollArea = host.querySelector('aside > div') as HTMLElement
    scrollArea.scrollTop = 180
    const toggle = host.querySelector('button[aria-label="PDF preview"]') as HTMLButtonElement
    const previewPanel = host.querySelector('[aria-label="Document preview area"]') as HTMLElement
    const editPanel = host.querySelector('[aria-label="Resume editing area"]') as HTMLElement
    expect(host.querySelector('[aria-label="Resume workspace views"]')).toBeNull()
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(previewPanel.hidden).toBe(true)
    expect(previewPanel.style.display).toBe('none')
    expect(editPanel.hidden).toBe(false)
    expect(editPanel.style.gridRow).toBe('1')
    expect(editPanel.style.gridColumn).toBe('1')
    await act(async () => toggle.click())
    expect(previewPanel.hidden).toBe(false)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(editPanel.hidden).toBe(true)
    expect(editPanel.style.display).toBe('none')
    expect(previewPanel.textContent).toContain('Saved in draft')
    await act(async () => toggle.click())
    expect(host.querySelector('[role="textbox"]')).toBe(textbox)
    expect(textbox.editor).toBe(editor)
    expect(scrollArea.scrollTop).toBe(180)
    // Use the pane's measured width, independently of the browser viewport.
    await act(async () => {
      paneWidth = 1600
      callbacks.forEach((callback) => callback([], {} as ResizeObserver))
    })
    expect(previewPanel.hidden).toBe(true)
    expect(editPanel.hidden).toBe(false)
    await act(async () => toggle.click())
    expect(host.querySelector('[aria-label="Resume workspace views"]')).toBeNull()
    expect(previewPanel.hidden).toBe(false)
    expect(editPanel.hidden).toBe(false)
    expect(previewPanel.style.gridRow).toBe('1')
    expect(editPanel.style.gridRow).toBe('1')
    expect(previewPanel.style.gridColumn).toBe('1')
    expect(editPanel.style.gridColumn).toBe('2')
    expect(editPanel.parentElement!.style.gridTemplateRows).toBe('minmax(0, 1fr)')
    expect(editPanel.parentElement!.style.gridTemplateColumns).toBe(
      'minmax(0, 3fr) minmax(22rem, 2fr)',
    )
    await act(async () => {
      paneWidth = 900
      document.documentElement.style.fontSize = '20px'
      callbacks.forEach((callback) => callback([], {} as ResizeObserver))
    })
    expect(previewPanel.hidden).toBe(false)
    expect(editPanel.hidden).toBe(true)
    await act(async () => toggle.click())
    expect(previewPanel.hidden).toBe(true)
    expect(editPanel.hidden).toBe(false)
    await act(async () => {
      paneWidth = 320
      callbacks.forEach((callback) => callback([], {} as ResizeObserver))
    })
    expect(previewPanel.hidden).toBe(true)
    expect(editPanel.hidden).toBe(false)
    expect(textbox.editor).toBe(editor)
    expect(textbox.textContent).toContain('Saved in draft')
  } finally {
    await act(async () => root.unmount())
    globalThis.ResizeObserver = OriginalObserver
    HTMLElement.prototype.getBoundingClientRect = originalRect
    document.documentElement.style.fontSize = priorFontSize
    host.remove()
  }
})
