/**
 * A click that opens a search dialog moves focus into the dialog's own field, which no snapshot
 * has named yet. A person just types; so does a `type` step with no target: it fills the field
 * that has focus. With nothing editable focused it still asks for a target.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { runCommand, installConsoleCapture, type ActuateDeps } from './index'
import { buildSnapshot, createRefRegistry } from '../snapshot/index'

describe('type without a target fills the focused field', () => {
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())

  const deps = (): ActuateDeps => ({
    reg: createRefRegistry(),
    console: installConsoleCapture(),
    prevTree: { value: '' },
    settle: async () => {},
  })

  test('a click opens a dialog that focuses its field, and the next step types into it', async () => {
    document.body.innerHTML = '<input id="where" placeholder="Where to?" readonly />'
    const opener = document.getElementById('where')!
    let typed = ''
    opener.addEventListener('click', () => {
      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      dialog.innerHTML = '<input id="search" aria-label="Where to?" />'
      document.body.append(dialog)
      const field = dialog.querySelector('input')!
      field.addEventListener('input', () => (typed = field.value))
      field.focus()
    })
    const d = deps()
    const ref = /\[ref=(e\d+)\]/.exec(buildSnapshot(d.reg).tree)![1]

    const r = await runCommand(
      {
        action: 'steps',
        steps: [
          { action: 'click', ref },
          { action: 'type', text: 'Georgia' },
        ],
      },
      d,
    )

    expect(r.ok).toBe(true)
    expect(typed).toBe('Georgia')
    expect(r.ok && r.result?.note).toContain('→ typed into')
  })

  test('with nothing editable focused, a type step still asks for a target', async () => {
    document.body.innerHTML = '<button id="go">Go</button>'
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    const d = deps()
    buildSnapshot(d.reg)

    const r = await runCommand({ action: 'type', text: 'Georgia' }, d)

    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('ref or selector')
  })
})
