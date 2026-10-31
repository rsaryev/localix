/**
 * Labels, values, states and the structured element list a snapshot carries beside its tree:
 * what a caller choosing among the page's controls reads instead of parsing lines.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { buildSnapshot, createRefRegistry } from './index'
import { installConsoleCapture, runCommand } from '../actuate/index'

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

  // A booking site's From and To: a `div role=combobox` around the real input, its label id
  // pointing at nothing. The line used to be a bare `combobox`, hiding the field and its value.
  it('a combobox drawn around its text field is named, valued and typed into through that field', async () => {
    const reg = createRefRegistry()
    document.body.innerHTML =
      '<div role="combobox" aria-expanded="false" aria-labelledby="gone"><div>' +
      '<input id="from" aria-labelledby="gone" placeholder="From" value="Larnaca"></div></div>'
    const { tree } = buildSnapshot(reg)
    expect(tree).toContain('combobox "From" = "Larnaca" [collapsed] [ref=')
    const ref = /\[ref=(e\d+)\]/.exec(tree)![1]
    const typed = await runCommand(
      { action: 'type', ref, text: 'Paphos' },
      { reg, console: installConsoleCapture(), prevTree: { value: '' }, settle: async () => {} },
    )
    expect(typed.ok).toBe(true)
    expect((document.getElementById('from') as HTMLInputElement).value).toBe('Paphos')
  })

  it('a select shows its label and the selected option as its value', () => {
    const { tree } = snapshotOf(
      '<label for="c">Cabin</label><select id="c"><option>Economy</option><option selected>Business</option></select>',
    )
    expect(tree).toContain('"Cabin" = "Business"')
  })

  it('a select lists its enabled options so the choice can be made without opening it', () => {
    const { tree } = snapshotOf(
      '<label for="c">Country</label><select id="c"><option value="fr">France</option><option value="us" selected>United States</option><option value="de" disabled>Germany</option><option>Spain</option></select>',
    )
    expect(tree).toContain(
      '"Country" = "United States" options: "France" (fr), "United States" (us), "Spain" [ref=',
    )
    expect(tree).not.toContain('Germany')
  })

  it('a select with more than fifty options lists fifty and says how many are left', () => {
    const options = Array.from({ length: 60 }, (_, i) => `<option>Item ${i}</option>`).join('')
    const { tree } = snapshotOf(`<select aria-label="Big">${options}</select>`)
    expect(tree).toContain('"Item 49"')
    expect(tree).not.toContain('"Item 50"')
    expect(tree).toContain('… 10 more')
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
