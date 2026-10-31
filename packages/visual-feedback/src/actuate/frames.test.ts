/**
 * Same-origin frames are part of the page: a consent banner or an embedded form written into an
 * iframe is read, clicked and typed into like the page's own controls, and a frame the agent
 * cannot enter is named instead of silently missing. happy-dom has no layout, so each test gives
 * the boxes it needs.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { runCommand, installConsoleCapture, type ActuateDeps } from './index'
import { buildSnapshot, createRefRegistry } from '../snapshot/index'
import { ownerFrame } from '../core/frames'

function makeDeps(): ActuateDeps {
  return {
    reg: createRefRegistry(),
    console: installConsoleCapture(),
    prevTree: { value: '' },
    settle: async () => {},
  }
}

function box(el: Element, left: number, top: number, width: number, height: number): void {
  el.getBoundingClientRect = () =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
    }) as DOMRect
}

/** An iframe whose document is `html`, laid out at the given box in the 1024x768 page. */
function addFrame(html: string, at: [number, number, number, number], id = 'f'): HTMLIFrameElement {
  const frame = document.createElement('iframe')
  frame.id = id
  frame.srcdoc = html
  document.body.appendChild(frame)
  box(frame, ...at)
  return frame
}

const ref = (tree: string, name: string): string => {
  const m = new RegExp(`"${name}"[^\\n]*\\[ref=(e\\d+)\\]`).exec(tree)
  if (!m) throw new Error(`no ref for ${name} in:\n${tree}`)
  return m[1]!
}

describe('same-origin frames', () => {
  let realPointAt: typeof document.elementFromPoint
  beforeAll(() => {
    GlobalRegistrator.register()
    realPointAt = document.elementFromPoint.bind(document)
  })
  afterAll(() => GlobalRegistrator.unregister())
  afterEach(() => {
    document.elementFromPoint = realPointAt
    document.body.innerHTML = ''
  })

  test('the snapshot offers the controls of a visible frame, under a line naming it', () => {
    document.body.innerHTML = '<button>Outside</button>'
    const frame = addFrame('<button>Accept all</button>', [0, 100, 600, 400])
    frame.title = 'Consent'
    box(frame.contentDocument!.querySelector('button')!, 10, 20, 100, 30)
    const tree = buildSnapshot(createRefRegistry()).tree
    expect(tree).toMatch(/button "Outside"/)
    expect(tree).toMatch(/frame "Consent"/)
    expect(tree).toMatch(/button "Accept all" \[ref=e\d+\]/)
  })

  test('a small frame (an ad slot) is not entered', () => {
    addFrame('<button>Buy now</button>', [0, 0, 100, 100])
    expect(buildSnapshot(createRefRegistry()).tree).not.toMatch(/Buy now/)
  })

  test('a frame far below the viewport is not entered', () => {
    addFrame('<button>Way down</button>', [0, 5000, 600, 400])
    expect(buildSnapshot(createRefRegistry()).tree).not.toMatch(/Way down/)
  })

  test('a visible frame the page cannot read is named as unreachable', () => {
    const frame = addFrame('', [0, 100, 600, 400])
    frame.title = 'Pay'
    Object.defineProperty(frame, 'contentDocument', { get: () => null })
    expect(buildSnapshot(createRefRegistry()).tree).toMatch(
      /frame "Pay".*cross-origin frame, not reachable/,
    )
  })

  test('a fixed frame covering the page marks its controls as a dialog', () => {
    const frame = addFrame('<button>Reject</button>', [0, 0, 1024, 768])
    frame.style.position = 'fixed'
    document.elementFromPoint = () => frame
    box(frame.contentDocument!.querySelector('button')!, 10, 20, 100, 30)
    const snap = buildSnapshot(createRefRegistry())
    expect(snap.elements?.find((e) => e.name === 'Reject')?.dialog).toBe(true)
  })

  test('a frame in the flow is not a dialog', () => {
    addFrame('<button>Share</button>', [0, 100, 600, 400])
    const snap = buildSnapshot(createRefRegistry())
    expect(snap.elements?.find((e) => e.name === 'Share')?.dialog).toBeUndefined()
  })

  test('a click on a ref in a frame lands on the control inside it', async () => {
    const frame = addFrame('<button>Accept all</button>', [50, 60, 600, 400])
    const doc = frame.contentDocument!
    const button = doc.querySelector('button')!
    box(button, 10, 20, 100, 30)
    const clicked: Array<{ x: number; y: number }> = []
    button.addEventListener('click', (e) => {
      clicked.push({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY })
    })
    const deps = makeDeps()
    const tree = buildSnapshot(deps.reg).tree
    const result = await runCommand({ action: 'click', ref: ref(tree, 'Accept all') }, deps)
    expect(result.ok).toBe(true)
    // The point is the control's own centre, in the frame's coordinates.
    expect(clicked).toEqual([{ x: 60, y: 35 }])
  })

  test('a click is refused when something on the page covers the frame there', async () => {
    const frame = addFrame('<button>Accept all</button>', [50, 60, 600, 400])
    box(frame.contentDocument!.querySelector('button')!, 10, 20, 100, 30)
    const cover = document.createElement('div')
    cover.setAttribute('role', 'dialog')
    cover.textContent = 'Sign in'
    document.body.appendChild(cover)
    const asked: Array<[number, number]> = []
    document.elementFromPoint = (x, y) => (asked.push([x, y]), cover)
    const deps = makeDeps()
    const tree = buildSnapshot(deps.reg).tree
    const result = await runCommand({ action: 'click', ref: ref(tree, 'Accept all') }, deps)
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('intercepted')
    // The page was asked about the point in ITS coordinates: the frame's origin plus the centre.
    expect(asked).toContainEqual([110, 95])
  })

  test('typing into a field in a frame sets it and tells the frame', async () => {
    const frame = addFrame('<input aria-label="Email">', [0, 100, 600, 400])
    const input = frame.contentDocument!.querySelector('input')!
    box(input, 10, 20, 200, 30)
    const seen: string[] = []
    input.addEventListener('input', () => seen.push(input.value))
    const deps = makeDeps()
    const tree = buildSnapshot(deps.reg).tree
    const result = await runCommand(
      { action: 'type', ref: ref(tree, 'Email'), text: 'a@b.co' },
      deps,
    )
    expect(result.ok).toBe(true)
    expect(input.value).toBe('a@b.co')
    expect(seen).toEqual(['a@b.co'])
  })

  test('a ref in a frame is never healed onto a same-looking control of the page', async () => {
    document.body.innerHTML = '<button id="go">Go</button>'
    const frame = addFrame('<button id="go">Go</button>', [0, 100, 600, 400])
    const inner = frame.contentDocument!.querySelector('button')!
    box(inner, 10, 20, 100, 30)
    const deps = makeDeps()
    const tree = buildSnapshot(deps.reg).tree
    const framed = [...tree.matchAll(/button "Go" \[ref=(e\d+)\]/g)].map((m) => m[1]!)[1]!
    expect(framed).toBeDefined()
    let outer = 0
    document.getElementById('go')!.addEventListener('click', () => outer++)
    inner.remove()
    const result = await runCommand({ action: 'click', ref: framed }, deps)
    expect(outer).toBe(0)
    expect(result.ok).toBe(false)
  })

  test('a modal frame over a control is named with its close control', async () => {
    document.body.innerHTML = '<button id="pay">Pay</button>'
    const pay = document.getElementById('pay')!
    box(pay, 100, 100, 100, 30)
    const overlay = addFrame('<button aria-label="Close banner">x</button>', [0, 0, 1024, 768])
    overlay.style.position = 'fixed'
    box(overlay.contentDocument!.querySelector('button')!, 10, 10, 30, 30)
    document.elementFromPoint = () => overlay
    const deps = makeDeps()
    const tree = buildSnapshot(deps.reg).tree
    const result = await runCommand({ action: 'click', ref: ref(tree, 'Pay') }, deps)
    expect(result.errorCode).toBe('intercepted')
    expect(result.error).toMatch(/Close banner/)
  })

  test('a cross-origin frame over a control is named as not reachable', async () => {
    document.body.innerHTML = '<button id="pay">Pay</button>'
    box(document.getElementById('pay')!, 100, 100, 100, 30)
    const overlay = addFrame('', [0, 0, 1024, 768])
    Object.defineProperty(overlay, 'contentDocument', { get: () => null })
    document.elementFromPoint = () => overlay
    const deps = makeDeps()
    const tree = buildSnapshot(deps.reg).tree
    const result = await runCommand({ action: 'click', ref: ref(tree, 'Pay') }, deps)
    expect(result.errorCode).toBe('intercepted')
    expect(result.error).toMatch(/cross-origin frame, not reachable/)
  })

  test('a probe running inside a same-origin embedder owns its window: its page is not a frame', () => {
    // The probe in a srcdoc/blob iframe: its own document is the page it drives, so the host
    // iframe that holds it must not add an offset to its points.
    document.body.innerHTML = '<button id="b">Go</button>'
    const host = document.createElement('iframe')
    Object.defineProperty(window, 'frameElement', { value: host, configurable: true })
    try {
      expect(ownerFrame(document.getElementById('b')!)).toBeNull()
    } finally {
      delete (window as { frameElement?: unknown }).frameElement
    }
  })
})
