import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import type { Editor } from '@tiptap/react'
import { isPrimaryModifier } from '@localixai/kit/keybindings'
import { registerDom } from '@localixai/kit/testing'
import { bindMiniAppUiTransport } from '@localixai/mini-app-sdk/ui/transport'
import type { PublishedMessageContext } from '@localixai/mini-app-sdk/ui'
import { createResumeRoutes } from '../backend/routes'
import { createResumeService } from '../backend/service'
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

test('workspace publishes saved section, labels rich drafts and clears inactive/unmounted context', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Workspace } = await import('./Workspace')
  const folder = await mkdtemp(join(tmpdir(), 'resume-bindings-'))
  const service = createResumeService(folder)
  const created = await service.create('user', createTemplateDocument('awal', 'CV'))
  const section = created.document.sections.find((item) => item.type === 'summary')!
  const app = new Hono().route('/rpc/resume', createResumeRoutes(createResumeService))
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) =>
      app.request(`http://localhost${path}`, init, {
        userId: 'user',
        sessionId: 'session',
        projectId: '',
        cwd: folder,
      }),
  })
  const publications: Array<PublishedMessageContext | null> = []
  const publish = (context: PublishedMessageContext | null) => {
    publications.push(context)
  }
  // Read through the descriptor: the test restores this very function, which a plain method
  // reference would hand over unbound.
  const originalRect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')!
    .value as HTMLElement['getBoundingClientRect']
  const originalObserver = globalThis.ResizeObserver
  const callbacks: ResizeObserverCallback[] = []
  let paneWidth = 1600
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { ...originalRect.call(this).toJSON(), width: paneWidth } as DOMRect
  }
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback)
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = (active: boolean) => (
    <Workspace
      active={active}
      sessionId="session"
      initialId={created.id}
      initialSectionId={section.id}
      publishMessageContext={publish}
    />
  )
  try {
    await act(async () => {
      root.render(render(true))
      await turns()
    })
    // The editor and its toolbar load separately: wait for what is asserted, not its neighbour.
    const toggle = () => host.querySelector<HTMLButtonElement>('button[aria-label="PDF preview"]')
    for (
      let attempt = 0;
      (!host.querySelector('[role="textbox"]') || !toggle()) && attempt < 300;
      attempt++
    )
      await act(async () => {
        await turns()
      })
    const previewToggle = toggle()!
    expect(previewToggle.getAttribute('aria-pressed')).toBe('true')
    await act(async () => {
      paneWidth = 320
      callbacks.forEach((callback) => callback([], {} as ResizeObserver))
    })
    expect(previewToggle.getAttribute('aria-pressed')).toBe('false')
    await act(async () => previewToggle.click())
    expect(previewToggle.getAttribute('aria-pressed')).toBe('true')
    await act(async () => {
      paneWidth = 1600
      callbacks.forEach((callback) => callback([], {} as ResizeObserver))
    })
    expect(previewToggle.getAttribute('aria-pressed')).toBe('true')
    await act(async () => previewToggle.click())
    await act(async () => {
      paneWidth = 320
      callbacks.forEach((callback) => callback([], {} as ResizeObserver))
      paneWidth = 1600
      callbacks.forEach((callback) => callback([], {} as ResizeObserver))
    })
    expect(previewToggle.getAttribute('aria-pressed')).toBe('false')
    expect(JSON.stringify(publications.at(-1))).toContain(
      `/resume/${created.id}/section/${section.id}`,
    )
    expect(JSON.stringify(publications.at(-1))).not.toContain('UNSAVED')
    const textbox = host.querySelector('[role="textbox"]') as HTMLElement & { editor: Editor }
    expect(textbox).not.toBeNull()
    await act(async () => {
      textbox.editor.commands.insertContent('<strong>Draft achievement</strong>')
    })
    expect(JSON.stringify(publications.at(-1))).toContain('UNSAVED editor draft')
    expect(JSON.stringify(publications.at(-1))).toContain('Draft achievement')
    expect((await service.get('user', created.id)).revision).toBe(created.revision)
    await act(async () => root.render(render(false)))
    expect(publications.at(-1)).toBeNull()
    await act(async () => root.render(render(true)))
    expect(JSON.stringify(publications.at(-1))).toContain('Draft achievement')
    expect(host.querySelector('[role="textbox"] strong')?.textContent).toBe('Draft achievement')

    // The undo chord, pressed on the workspace itself rather than in a field, steps the draft back.
    const group = host.querySelector('[aria-label="Resume workspace"]')!
    const chord = (key: string, target: Element = group) =>
      act(async () => {
        const primary = isPrimaryModifier({ metaKey: true, ctrlKey: false })
          ? { metaKey: true }
          : { ctrlKey: true }
        target.dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...primary }),
        )
      })
    await chord('x')
    expect(JSON.stringify(publications.at(-1))).toContain('Draft achievement')
    await chord('z')
    expect(JSON.stringify(publications.at(-1))).not.toContain('Draft achievement')
  } finally {
    await act(async () => root.unmount())
    HTMLElement.prototype.getBoundingClientRect = originalRect
    globalThis.ResizeObserver = originalObserver
    unbind()
    host.remove()
    localStorage.clear()
    await rm(folder, { recursive: true, force: true })
  }
  expect(publications.at(-1)).toBeNull()
})
