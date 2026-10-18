import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { createPicker, type PickEvent } from './fsm'

/**
 * The gesture that had no answer: sweeping the window to comment on the SCREEN.
 *
 * Any drag that crossed prose was read as a text selection, because that check ran first — so
 * "select everything" produced a quote of whatever words were in the way, and the layout as a
 * whole was the one thing you could not point at.
 */

let picks: PickEvent[]
let dispatch: (type: string, x: number, y: number) => void
let cleanup: () => void

const GLOBAL_KEYS = ['window', 'document', 'Element', 'Node'] as const

beforeEach(() => {
  const window = new Window({ width: 1000, height: 800 })
  const document = window.document
  document.body.innerHTML = '<p id="prose">Some words that a sweep will cross</p>'
  // The picker resolves what is under the pointer; happy-dom has no layout, so the page is
  // one element as far as hit testing is concerned.
  document.elementFromPoint = () => document.body as unknown as never

  const globals = globalThis as unknown as Record<string, unknown>
  for (const key of GLOBAL_KEYS) globals[key] = (window as unknown as Record<string, unknown>)[key]

  picks = []
  const picker = createPicker({
    onHover() {},
    onMarquee() {},
    onPick(event) {
      picks.push(event)
    },
  })
  picker.setEnabled(true)

  dispatch = (type, x, y) => {
    // Dispatched on the element, with happy-dom's own `composedPath` left alone: the picker
    // reads it to skip its own overlay, and so does happy-dom to build the propagation path.
    const event = new window.Event(type, { bubbles: true, cancelable: true }) as unknown as {
      clientX: number
      clientY: number
      button: number
    }
    event.clientX = x
    event.clientY = y
    event.button = 0
    document.body.dispatchEvent(event as never)
  }

  cleanup = () => {
    picker.destroy()
    // Deleted, not blanked: a leftover key changes what every later test file sees.
    for (const key of GLOBAL_KEYS) delete globals[key]
  }
})

afterEach(() => cleanup())

describe('a sweep across the window', () => {
  test('is a comment on the whole page, even when it crosses text', () => {
    const selection = globalThis.window.getSelection()
    selection?.selectAllChildren(globalThis.document.getElementById('prose')!)

    dispatch('pointerdown', 20, 20)
    dispatch('pointermove', 500, 400)
    dispatch('pointermove', 980, 780)
    dispatch('pointerup', 980, 780)

    expect(picks).toHaveLength(1)
    expect(picks[0]?.kind).toBe('area')
    expect(picks[0]?.page).toBe(true)
    // The rect is the window, not the pixels the pointer happened to reach.
    expect(picks[0]?.rect).toEqual({ x: 0, y: 0, width: 1000, height: 800 })
    // The stray selection does not travel with it.
    expect(globalThis.window.getSelection()?.toString()).toBe('')
  })

  test('a smaller drag stays a region, not the page', () => {
    dispatch('pointerdown', 100, 100)
    dispatch('pointermove', 400, 300)
    dispatch('pointerup', 400, 300)

    expect(picks).toHaveLength(1)
    expect(picks[0]?.kind).toBe('area')
    expect(picks[0]?.page).toBeUndefined()
    expect(picks[0]?.rect).toEqual({ x: 100, y: 100, width: 300, height: 200 })
  })
})

describe('pressing while commenting', () => {
  test('a click on a commented element opens its comment instead of a new pick', () => {
    const opened: Element[] = []
    const picker = createPicker({
      onHover() {},
      onMarquee() {},
      onPick(event) {
        picks.push(event)
      },
      onPickMarked(el) {
        opened.push(el)
        return true
      },
    })
    picker.setEnabled(true)
    picks = []
    dispatch('pointerdown', 50, 50)
    dispatch('pointerup', 50, 50)
    picker.destroy()
    expect(opened).toHaveLength(1)
    // The picker from beforeEach still takes the press; this one declined to start a pick.
    expect(picks.every((pick) => pick.kind === 'element')).toBe(true)
  })

  test('the page hears none of the press under the picker', () => {
    let heard = 0
    const target = document.getElementById('prose')!
    target.addEventListener('mousedown', () => (heard += 1))
    target.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    expect(heard).toBe(0)
  })
})
