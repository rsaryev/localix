import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), 'utf8')
const source = read('InstallForm.tsx')
const editor = read('SettingsRecordEditor.tsx')
/** The status row and the decision pair the drawer shares with the agent profile's page. */
const chrome = read('SettingsRecordChrome.tsx')

/**
 * WHY THIS IS READ AND NOT RENDERED.
 *
 * It used to be a `renderToStaticMarkup` of the form, back when the form was an inline panel.
 * It opens in the shared record editor now — a vaul drawer — and vaul decides at MODULE LOAD
 * whether it is in a browser. bun evaluates every test file's graph before any hook runs, so
 * in a process where any earlier file has pulled vaul in without a DOM, a drawer mounted here
 * portals nothing and every assertion reads an empty body: green alone, red in the suite, for
 * a reason that has nothing to do with this form. (Same hazard the `react-dom/client` rule in
 * `check-architecture.mjs` describes, one package over.)
 *
 * So the split is: the drawer's own regions, scroll contract and material are pinned in
 * `shared/ui/modal-surface.test.tsx`, the field/label wiring in `shared/ui/field`'s tests, and
 * what is left for this file is the only thing it ever really owned — that the form composes
 * those and states nothing twice.
 */
describe('InstallForm composition', () => {
  test('opens in the shared record editor rather than an inline panel', () => {
    expect(source).toContain('<SettingsRecordEditor')
    // The panel's own chrome — surface, footer, busy row, error line — is the editor's now.
    expect(source).not.toContain('border-y')
    expect(source).not.toContain('role="alert"')
    expect(source).not.toContain('<Button')
  })

  test('hands its failure and its activity to the editor, which announces both', () => {
    expect(source).toContain('error={form.error}')
    expect(source).toContain('busy={form.busy}')
    // The source rides the busy label because an install is the slow action on this screen.
    expect(source).toContain('busyLabel={activityLabel}')
    expect(chrome).toContain('role="alert"')
    expect(chrome).toContain('role="status"')
    expect(editor).toContain('aria-busy={busy || undefined}')
  })

  test('uses the shared accessible field and control primitives', () => {
    expect(source).toContain('<Field')
    expect(source).toContain('<Input')
    expect(source).toContain('<Checkbox')
    expect(source).not.toContain("from './formStyles'")
    expect(source).not.toContain('<input')
    expect(source).not.toContain('<button')
  })
})
