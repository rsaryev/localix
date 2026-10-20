/**
 * Choices inside a control: an autocomplete's suggestions and a calendar's days. Read as one bare
 * `listbox` or unnamed `gridcell`s (Google Flights, 2026-10-20), a goal run clicked the container
 * instead of the suggestion and picked days blind.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { buildSnapshot, createRefRegistry } from './index'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

const snapshotOf = (html: string) => {
  document.body.innerHTML = html
  return buildSnapshot(createRefRegistry())
}

describe('choices inside a control', () => {
  it('a listbox shows each option as its own target', () => {
    const { tree, elements } = snapshotOf(
      '<ul role="listbox" aria-label="Suggestions"><li role="option">Zurich ZRH</li><li role="option">Zurich HB</li></ul>',
    )
    expect(tree).toContain('listbox "Suggestions"')
    expect(tree).toContain('option "Zurich ZRH"')
    expect(elements?.map((element) => element.name)).toContain('Zurich HB')
  })

  it('a native select stays one control with its value', () => {
    const { tree } = snapshotOf(
      '<label for="c">Cabin</label><select id="c"><option>Economy</option></select>',
    )
    expect(tree).not.toContain('option "Economy"')
  })

  it('a control with no name of its own reads its inner text, else an inner label', () => {
    const { tree } = snapshotOf(
      [
        '<div role="grid"><div role="row">',
        '<div role="gridcell" tabindex="0"><div><span>23</span></div></div>',
        '<div role="gridcell" tabindex="0"><div aria-label="Saturday, October 24"></div></div>',
        '</div></div>',
      ].join(''),
    )
    expect(tree).toContain('gridcell "23"')
    expect(tree).toContain('gridcell "Saturday, October 24"')
  })
})

describe('more controls than the list holds', () => {
  it('keeps the ones on screen, so a Done button after hundreds of days is still offered', () => {
    const days = Array.from({ length: 300 }, (_, i) => `<button>${i + 1}</button>`).join('')
    document.body.innerHTML = `${days}<button id="done">Done</button>`
    // happy-dom lays nothing out: put the last days and Done on screen by hand.
    const view = { top: 10, left: 10, bottom: 40, right: 60, width: 50, height: 30, x: 10, y: 10 }
    const off = { ...view, top: -500, bottom: -470 }
    for (const button of Array.from(document.querySelectorAll('button')))
      button.getBoundingClientRect = () =>
        (button.id === 'done' || Number(button.textContent) > 280 ? view : off) as DOMRect
    const { elements } = buildSnapshot(createRefRegistry())
    const names = elements?.map((element) => element.name) ?? []
    expect(names).toHaveLength(250)
    expect(names).toContain('Done')
    expect(names).toContain('300')
    // Tree order is kept among the ones chosen.
    expect(names.indexOf('300')).toBeLessThan(names.indexOf('Done'))
  })
})

describe('off-screen controls under the cap', () => {
  it('a lone button below the fold outranks hundreds of off-screen days', () => {
    const days = Array.from(
      { length: 300 },
      (_, i) => `<div role="gridcell" tabindex="0">${i + 1}</div>`,
    ).join('')
    document.body.innerHTML = `${days}<button>Done</button>`
    const names = buildSnapshot(createRefRegistry()).elements?.map((element) => element.name) ?? []
    expect(names).toHaveLength(250)
    expect(names.at(-1)).toBe('Done')
  })
})

describe('controls inside an open dialog', () => {
  it('are marked, so a caller can act in the dialog first', () => {
    document.body.innerHTML =
      '<button>Page</button><div role="dialog" aria-label="Departure"><button>Done</button></div>'
    const elements = buildSnapshot(createRefRegistry()).elements ?? []
    expect(elements.find((element) => element.name === 'Done')?.dialog).toBe(true)
    expect(elements.find((element) => element.name === 'Page')?.dialog).toBeUndefined()
  })
})
