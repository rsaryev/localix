import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

// Capture the router without hitting the network (media upload). Every export is stubbed: a
// module mock outlives this file in a shared `bun test` run, and a later file that imports the
// one export left out (the composer's dropzone reads `desktopDroppedEntries`) fails to link.
const routed: Array<readonly File[]> = []
await mock.module('./fileDropRouter', () => ({
  routeDroppedFiles: (files: readonly File[]) => {
    routed.push(files)
    return Promise.resolve()
  },
  desktopDroppedEntries: () => Promise.resolve(null),
}))

let teardown: () => Promise<void>
let installFileDropGuard: () => void

beforeAll(async () => {
  teardown = registerDom()
  ;({ installFileDropGuard } = await import('./fileDropGuard'))
  installFileDropGuard()
})
afterAll(async () => {
  await teardown()
})
beforeEach(() => {
  routed.length = 0
  document.body.innerHTML = ''
})

/** Dispatch a `drop` on `target` carrying (or not) OS files, and return the event. */
function dispatchDrop(target: Element, withFiles: boolean): Event {
  const e = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'dataTransfer', {
    configurable: true,
    value: {
      types: withFiles ? ['Files'] : ['text/plain'],
      files: withFiles ? [new File(['x'], 'a.pdf', { type: 'application/pdf' })] : [],
    },
  })
  target.dispatchEvent(e)
  return e
}

describe('fileDropGuard (capture-phase OS-file drop router)', () => {
  test('a stray OS-file drop anywhere is prevented AND routed to a viewer', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)

    const e = dispatchDrop(el, true)

    // Navigation killed (the "whole UI disappears" bug) …
    expect(e.defaultPrevented).toBe(true)
    // … and the file routed into its in-app viewer.
    expect(routed.length).toBe(1)
    expect(routed[0]?.[0]?.name).toBe('a.pdf')
  })

  test('a drop inside the composer is prevented but NOT routed (composer attaches it)', () => {
    const composer = document.createElement('div')
    composer.setAttribute('data-focus-part', 'chat')
    const inner = document.createElement('span') // deep target inside the composer
    composer.appendChild(inner)
    document.body.appendChild(composer)

    const e = dispatchDrop(inner, true)

    expect(e.defaultPrevented).toBe(true) // navigation still killed
    expect(routed.length).toBe(0) // but the composer's own handler owns it
  })

  test('an internal drag (no OS files) is left completely alone', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)

    const e = dispatchDrop(el, false)

    expect(e.defaultPrevented).toBe(false) // internal DnD (tabs, @-refs) untouched
    expect(routed.length).toBe(0)
  })
})
