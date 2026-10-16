import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./RequestTab.tsx', import.meta.url), 'utf8')

describe('request workbench geometry', () => {
  test('overlays the request resize target on the seam instead of allocating a blank band', () => {
    expect(source).toContain('-my-[calc(var(--sash-hit-area)/2)]')
  })

  test('uses the shared 36px workbench toolbar beside the Requests panel header', () => {
    expect(source).toContain('<WorkbenchToolbar aria-label="Request controls"')
    expect(source).not.toContain('border-b border-border-soft p-2')
  })

  test('keeps the body type in the tab row instead of a dedicated toolbar row', () => {
    // The row IS the TabBar now: it owns its height and its seam, and the body-type
    // select rides in its `trailing` slot. The wrapper this used to look for existed
    // only to redraw a seam the strip had been told to suppress.
    const tabRowStart = source.indexOf('<TabBar<RequestTabId>')
    const contentStart = source.indexOf("'min-h-0 flex-1'", tabRowStart)
    expect(tabRowStart).toBeGreaterThan(-1)
    expect(contentStart).toBeGreaterThan(tabRowStart)
    const tabRow = source.slice(tabRowStart, contentStart)
    expect(tabRow).toContain('trailing={')
    expect(tabRow).toContain('aria-label="Body type"')
    expect(source).not.toContain('className="flex h-10 shrink-0 items-center border-b')
    // No second seam: the tab row no longer sits in a border-drawing wrapper.
    expect(source).not.toContain('items-stretch border-b border-border-soft')
  })

  test('Settings and Auth share one form row, and neither caps its column', () => {
    // Each tab wrote its own row (10rem vs 8.5rem labels, a dead spacer span) inside a
    // `max-w-3xl` / `max-w-2xl` box that stopped the fields short of the URL bar above them.
    const auth = readFileSync(new URL('./ui/AuthEditor.tsx', import.meta.url), 'utf8')
    const settings = readFileSync(new URL('./ui/RequestSettings.tsx', import.meta.url), 'utf8')
    expect(source).toContain("from './ui/RequestSettings'")
    expect(settings).toContain("from './FormRow'")
    expect(auth).toContain("from './FormRow'")
    for (const file of [source, settings, auth]) expect(file).not.toMatch(/max-w-(?:sm|2xl|3xl)/)
    expect(settings).not.toContain('<span />')
  })
})
