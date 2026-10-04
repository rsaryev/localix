import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

/**
 * ONE answer to "what is wrong with this form", across every form that has one.
 *
 * All three validating forms used to end a failed submit the same way: a single sentence
 * pinned above the footer, naming fields the reader then had to go find. The `Field`
 * primitive has rendered an inline `error` — with `aria-invalid` and `aria-describedby`
 * wired to the control — since it was written, and not one form used it.
 */
const VALIDATING_FORMS = [
  './capabilities/agent-editor/AgentEditor.tsx',
  './capabilities/agent-editor/AgentIdentityFields.tsx',
  './capabilities/SkillForm.tsx',
  './capabilities/McpServerFields.tsx',
  './InstallForm.tsx',
  '../../secrets/ui/VaultItemDialog.tsx',
]

describe('a form says what is wrong beside the control it is about', () => {
  test('every validating form feeds its messages into Field', () => {
    for (const file of VALIDATING_FORMS) {
      const source = read(file)
      expect({ file, inline: /error=\{/.test(source) }).toEqual({ file, inline: true })
      // Paired with `controlId`, because focus-on-submit resolves the control by id.
      expect({ file, ids: source.includes('controlId=') }).toEqual({ file, ids: true })
    }
  })

  test('the field-level summaries they used to print are gone', () => {
    // The positive control. Each of these was one form's whole answer to a failed submit.
    const RETIRED = [
      'Name and system prompt are required.',
      'Description and content are required.',
      'A stdio server needs a command.',
      'Name must be letters, numbers, dashes or underscores.',
    ]
    // Comments may quote the retired sentence — explaining why it is gone is the point of
    // them. Only CODE is checked.
    const sources = [
      ...VALIDATING_FORMS,
      './capabilities/agent-editor/agentDraft.ts',
      '../model/mcpDraft.ts',
      '../model/useMcpServerForm.ts',
    ].map((file) =>
      read(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, ''),
    )
    for (const retired of RETIRED) {
      for (const source of sources) {
        expect({ retired, present: source.includes(retired) }).toEqual({ retired, present: false })
      }
    }
  })

  test('no validating form hand-rolls the wiring Field owns', () => {
    // Two dialogs spelled out `aria-invalid` / `aria-describedby` / an `id`-suffixed error
    // span themselves — the same three ids `Field` derives, written a third and fourth time.
    for (const file of VALIDATING_FORMS) {
      const source = read(file)
      expect({ file, handRolled: source.includes('aria-invalid=') }).toEqual({
        file,
        handRolled: false,
      })
    }
  })

  /**
   * NOT a rule against disabling a submit — a dirty gate ("nothing changed") and a
   * one-field composer ("type something to send it") explain themselves. It is about a form
   * with SEVERAL required fields or a format rule, where the dead button leaves the reader
   * asking which of them it is waiting on. The vault dialog was that; the single-field cases
   * elsewhere are deliberately left alone.
   */
  test('a required field is never gated by a silent disabled submit', () => {
    // Pressing it now names the field and takes them to it; only a save in flight disables it.
    for (const file of ['../../secrets/ui/VaultItemDialog.tsx']) {
      const source = read(file)
      for (const dead of ['disabled={!canSave}', 'disabled={!canSubmit}']) {
        expect({ file, dead, present: source.includes(dead) }).toEqual({
          file,
          dead,
          present: false,
        })
      }
    }
  })

  test('the pinned row survives for what it is for: a failed WRITE', () => {
    // Not a purity rule — a refused save has no field to sit under, and it belongs beside
    // the button that caused it.
    expect(read('./SettingsRecordChrome.tsx')).toContain('role="alert"')
    for (const file of [
      './capabilities/SkillForm.tsx',
      './capabilities/agent-editor/AgentEditor.tsx',
    ])
      expect(read(file)).toContain('error={')
  })
})
