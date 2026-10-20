/**
 * Labels, values, states and the structured element list a snapshot carries beside its tree:
 * what a caller choosing among the page's controls reads instead of parsing lines.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { buildSnapshot, createRefRegistry } from './index'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

function snapshotOf(html: string, fill?: (doc: Document) => void) {
  document.body.innerHTML = html
  fill?.(document)
  return buildSnapshot(createRefRegistry())
}

describe('field labels', () => {
  it('reads aria-labelledby, label[for] and a wrapping label before the placeholder', () => {
    const { tree } = snapshotOf(
      [
        '<span id="to">Where to?</span><input aria-labelledby="to" placeholder="City">',
        '<label for="d">Departure</label><input id="d" placeholder="Date">',
        '<label>Adults <input type="number"></label>',
      ].join(''),
    )
    expect(tree).toContain('textbox "Where to?" [ref=')
    expect(tree).toContain('"Departure"')
    expect(tree).toContain('"Adults"')
    expect(tree).not.toContain('"City"')
  })

  it('a select shows its label and the selected option as its value', () => {
    const { tree } = snapshotOf(
      '<label for="c">Cabin</label><select id="c"><option>Economy</option><option selected>Business</option></select>',
    )
    expect(tree).toContain('"Cabin" = "Business"')
  })

  it('a checkbox keeps its state instead of a value', () => {
    const { tree } = snapshotOf('<label>Direct only <input type="checkbox" checked></label>')
    expect(tree).toContain('checkbox "Direct only" [checked] [ref=')
    expect(tree).not.toContain(' = ')
  })
})

describe('states', () => {
  it('adds expanded/collapsed, selected, required and readonly after disabled/checked', () => {
    const { tree } = snapshotOf(
      [
        '<button aria-expanded="true">Menu</button>',
        '<button aria-expanded="false">More</button>',
        '<div role="tab" aria-selected="true">Flights</div>',
        '<input aria-label="From" required readonly>',
      ].join(''),
    )
    expect(tree).toContain('button "Menu" [expanded]')
    expect(tree).toContain('button "More" [collapsed]')
    expect(tree).toContain('tab "Flights" [selected]')
    expect(tree).toContain('"From" [required, readonly]')
  })
})

describe('elements beside the tree', () => {
  it('lists the interactive nodes in tree order with value, states and editable', () => {
    const snapshot = snapshotOf(
      '<h1>Search</h1><label for="q">Query</label><input id="q"><button disabled>Go</button>',
      (doc) => {
        doc.querySelector('input')!.value = 'cats'
      },
    )
    expect(snapshot.elements).toEqual([
      { ref: 'e3', role: 'textbox', name: 'Query', value: 'cats', editable: true },
      { ref: 'e4', role: 'button', name: 'Go', states: ['disabled'] },
    ])
  })

  it('a checkbox or a button is not editable; a contenteditable region is', () => {
    const { elements } = snapshotOf(
      '<input type="checkbox" aria-label="Agree"><div contenteditable="true" aria-label="Note">hi</div>',
    )
    expect(elements?.map((element) => [element.name, element.editable ?? false])).toEqual([
      ['Agree', false],
      ['Note', true],
    ])
  })

  it('keeps at most 250 elements while the tree keeps its own cap', () => {
    const snapshot = snapshotOf('<button>b</button>'.repeat(300))
    expect(snapshot.elements).toHaveLength(250)
    expect(snapshot.stats.interactive).toBe(300)
  })

  it('a page without controls carries no elements', () => {
    expect(snapshotOf('<p>Just text</p>').elements).toBeUndefined()
  })
})
