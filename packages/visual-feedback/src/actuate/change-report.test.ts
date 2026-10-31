/**
 * The change report after an action: an ordered line diff with the unchanged line above each
 * change for context and `…` over gaps, so duplicated lines are told apart by place; the page
 * whole when the changes are many or would read longer than the page.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { changeReport, diffTrees, captureState, stateForDiff } from './diff'
import { postAction } from './post-action'
import { createRefRegistry } from '../snapshot/index'
import { installConsoleCapture, type ActuateDeps } from './index'

const page = (...lines: string[]) => lines.map((l) => `- ${l}`).join('\n')

describe('diffTrees', () => {
  test('tells which of several equal lines changed by the line above it', () => {
    const before = page('text "Score"', 'text "0"', 'text "Best"', 'text "0"')
    const after = page('text "Score"', 'text "0"', 'text "Best"', 'text "7"')
    expect(diffTrees(before, after)).toBe(['  text "Best"', '- text "0"', '+ text "7"'].join('\n'))
  })

  test('notices one of two identical lines going away', () => {
    const before = page('button "Add"', 'button "Add"', 'link "Home"')
    const after = page('button "Add"', 'link "Home"')
    expect(diffTrees(before, after)).toBe(['  button "Add"', '- button "Add"'].join('\n'))
  })

  test('marks a gap between changes that are apart', () => {
    const rows = Array.from({ length: 12 }, (_, i) => `text "row ${i}"`)
    const before = page(...rows)
    const after = page(...rows.map((r, i) => (i === 1 || i === 10 ? r.replace(/"$/, ' b"') : r)))
    const told = diffTrees(before, after)!.split('\n')
    expect(told).toEqual([
      '  text "row 0"',
      '- text "row 1"',
      '+ text "row 1 b"',
      '  …',
      '  text "row 9"',
      '- text "row 10"',
      '+ text "row 10 b"',
    ])
  })

  test('says so when nothing changed', () => {
    expect(diffTrees(page('button "A"'), page('button "A"'))).toBe('(no visible change)')
  })

  test('has nothing to say without a baseline', () => {
    expect(diffTrees('', page('button "A"'))).toBeUndefined()
  })

  test('keeps the document-state hint', () => {
    const told = diffTrees(
      page('body data-theme="dark"', 'button "A"', 'button "B"', 'button "C"'),
      page('body data-theme="light"', 'button "A"', 'button "B"', 'button "C"'),
    )
    expect(told).toContain('attribute changed but computed colors did not')
  })
})

describe('changeReport', () => {
  test('reads the page whole when more than 30 lines changed', () => {
    const before = page(...Array.from({ length: 40 }, (_, i) => `text "a${i}"`))
    const after = page(...Array.from({ length: 40 }, (_, i) => `text "b${i}"`))
    const report = changeReport(before, { text: after, refs: [] })
    expect(report?.kind).toBe('whole')
  })

  test('reads the page whole when the changes would be longer than the page', () => {
    const rows = Array.from({ length: 12 }, (_, i) => `text "r${i}"`)
    const before = page(...rows.map((r, i) => (i % 3 === 0 ? `text "${'x'.repeat(30)}${i}"` : r)))
    const after = page(...rows.map((r, i) => (i % 3 === 0 ? `text "y${i}"` : r)))
    expect(changeReport(before, { text: after, refs: [] })?.kind).toBe('whole')
  })

  test('reads the page whole past the comparison budget', () => {
    const big = (tag: string) =>
      page(...Array.from({ length: 2100 }, (_, i) => `text "${tag}${i}"`))
    expect(changeReport(big('a'), { text: big('b'), refs: [] })?.kind).toBe('whole')
  })

  test('a small change in a long page stays a diff', () => {
    const rows = Array.from({ length: 50 }, (_, i) => `text "row ${i}"`)
    const after = page(...rows.map((r, i) => (i === 25 ? 'text "changed"' : r)))
    const report = changeReport(page(...rows), { text: after, refs: [] })
    expect(report).toEqual({
      kind: 'diff',
      text: ['  text "row 24"', '- text "row 25"', '+ text "changed"'].join('\n'),
    })
  })
})

describe('refs in the report', () => {
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())

  const depsFor = (): ActuateDeps => ({
    reg: createRefRegistry(),
    console: installConsoleCapture(),
    prevTree: { value: '' },
    settle: async () => {},
  })

  test('a button that appeared carries a ref that resolves to it', async () => {
    document.body.innerHTML = '<button id="a">Open</button>'
    const deps = depsFor()
    try {
      deps.reg.put(document.getElementById('a')!) // a snapshot has run
      deps.prevTree.value = stateForDiff()
      document.body.insertAdjacentHTML('beforeend', '<button id="b">Save</button>')
      const { diff } = await postAction(deps)
      const ref = /\+ button "Save" \[ref=(e\d+)\]/.exec(diff!)?.[1]
      expect(ref).toBeDefined()
      expect(deps.reg.get(ref!)).toBe(document.getElementById('b')!)
    } finally {
      deps.console.uninstall()
    }
  })

  test('a ref the report minted still resolves after the page re-renders that control', async () => {
    document.body.innerHTML = '<button id="a">Open</button>'
    const deps = depsFor()
    try {
      deps.reg.put(document.getElementById('a')!)
      deps.prevTree.value = stateForDiff()
      document.body.insertAdjacentHTML('beforeend', '<button id="b">Save</button>')
      const { diff } = await postAction(deps)
      const ref = /\+ button "Save" \[ref=(e\d+)\]/.exec(diff!)![1]!
      // A re-render mounts a new node in place of the one the ref named.
      document.getElementById('b')!.replaceWith(
        Object.assign(document.createElement('button'), {
          id: 'b',
          textContent: 'Save',
        }),
      )
      expect(deps.reg.get(ref)).toBe(document.getElementById('b')!)
      expect(deps.reg.identityOf(ref)).toMatchObject({ role: 'button', name: 'Save' })
    } finally {
      deps.console.uninstall()
    }
  })

  test('a button already known keeps the ref the model has', async () => {
    document.body.innerHTML = '<button id="a">Open</button><div>1</div>'
    const deps = depsFor()
    try {
      const known = deps.reg.put(document.getElementById('a')!)
      deps.prevTree.value = stateForDiff()
      document.getElementById('a')!.textContent = 'Close'
      const { diff } = await postAction(deps)
      expect(diff).toContain(`+ button "Close" [ref=${known}]`)
    } finally {
      deps.console.uninstall()
    }
  })

  test('without a snapshot yet, no dead ref is printed', async () => {
    document.body.innerHTML = '<button id="a">Open</button>'
    const deps = depsFor()
    try {
      deps.prevTree.value = stateForDiff()
      document.getElementById('a')!.textContent = 'Close'
      const { diff } = await postAction(deps)
      expect(diff).not.toContain('e0')
    } finally {
      deps.console.uninstall()
    }
  })

  test('a page that changed beyond the cap comes back as the whole snapshot', async () => {
    document.body.innerHTML = Array.from({ length: 40 }, (_, i) => `<button>A${i}</button>`).join(
      '',
    )
    const deps = depsFor()
    try {
      deps.prevTree.value = stateForDiff()
      document.body.innerHTML = Array.from({ length: 40 }, (_, i) => `<button>B${i}</button>`).join(
        '',
      )
      const result = await postAction(deps)
      expect(result.diff).toBeUndefined()
      expect(result.snapshot?.tree).toContain('button "B39"')
    } finally {
      deps.console.uninstall()
    }
  })

  test('captureState lines up each element line with its element', () => {
    {
      document.body.innerHTML = '<button>One</button>'
      const state = captureState()
      expect(state.refs.length).toBe(state.text.split('\n').length)
      expect(state.refs.filter(Boolean).length).toBeGreaterThan(0)
    }
  })
})
