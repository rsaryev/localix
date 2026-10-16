import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { VirtualDiff } from './VirtualDiff'
import { setDiffViewMode } from './diffViewMode'
import { diffDocumentFromPatch } from './document/parsePatchText'

const TWO_HUNKS = ['@@ -1 +1 @@', '-before', '+after', '@@ -10 +10 @@', '-old', '+new'].join('\n')

const rowsIn = (html: string) => (html.match(/data-run=/g) ?? []).length

test('a 20,000-line diff mounts one window of rows, not one row per line', () => {
  const body = Array.from({ length: 20_000 }, (_, i) => `+line ${i}`)
  const doc = diffDocumentFromPatch([`@@ -0,0 +1,${body.length} @@`, ...body].join('\n'))
  const html = renderToStaticMarkup(<VirtualDiff doc={doc} />)
  const mounted = rowsIn(html)
  expect(mounted).toBeGreaterThan(10)
  expect(mounted).toBeLessThan(120)
  // The canvas still spans the whole document, so the scrollbar is honest.
  // One 24px hunk header + 20,000 20px lines.
  expect(html).toContain('height:400024px')
})

test('change navigation exposes its position through passive managed metadata', () => {
  const html = renderToStaticMarkup(<VirtualDiff doc={diffDocumentFromPatch(TWO_HUNKS)} />)
  const position = html.match(/<span[^>]*aria-label="Change 1 of 2"[^>]*>/)?.[0]
  expect(position).toContain('data-tooltip-trigger="true"')
  expect(position).toContain('role="status"')
  expect(html).not.toContain('title=')
  expect(html).toContain('data-slot="workbench-toolbar"')
})

test('split rows keep long source lines on one line and draw a real centre divider', () => {
  setDiffViewMode('split')
  try {
    const html = renderToStaticMarkup(<VirtualDiff doc={diffDocumentFromPatch(TWO_HUNKS)} />)
    expect(html).toContain('data-layout="split"')
    expect(html).toContain('whitespace-pre ')
    expect(html).not.toContain('whitespace-pre-wrap')
    expect(html).toContain('border-r-border-soft')
    expect(html).not.toContain('divide-x')
  } finally {
    setDiffViewMode('unified')
  }
})

test('split sides stay half the viewport however long one line is', () => {
  // One 5,000-column line used to size BOTH halves, parking the new side off-screen.
  const long = 'x'.repeat(5_000)
  const doc = diffDocumentFromPatch(['@@ -1 +1 @@', `-${long}`, `+${long}y`].join('\n'))
  setDiffViewMode('split')
  try {
    const html = renderToStaticMarkup(<VirtualDiff doc={doc} />)
    expect(html).toMatch(/data-layout="split"[^>]*style="height:\d+px;width:100%"/)
    expect(html).toContain('var(--diff-x,0px)')
  } finally {
    setDiffViewMode('unified')
  }
})
