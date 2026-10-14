import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), 'utf8')

/**
 * The editors moved into `capabilities/`, so the separation is now something the
 * FILE BOUNDARY can state: the form owns its draft failure, the tab owns the
 * list's load failure, and neither reaches into the other. Asserting it per file
 * is stricter than the old single-file scan, not looser.
 */
const registries = [
  {
    tab: 'AgentsSettings.tsx',
    form: 'capabilities/agent-editor/AgentEditor.tsx',
    // The agent form's decisions (draft, dirty, defaults, save) live in a hook beside it,
    // which is where its failure state went with them. Still the FORM's own, still not the
    // list's — the boundary this test is about is unchanged, only the file it sits in.
    state: 'capabilities/agent-editor/useAgentEditorForm.ts',
    hook: 'useAgents',
  },
  { tab: 'SkillsSettings.tsx', form: 'capabilities/SkillForm.tsx', hook: 'useSkills' },
] as const

test('registry editors keep form failures separate from background load failures', () => {
  // The shared chrome renders the one alert region, for the drawer and the profile page alike;
  // a form states its failure by HANDING it over. Asserting the markup per form would now be
  // asserting the chrome four times.
  expect(read('SettingsRecordChrome.tsx')).toContain('role="alert"')

  for (const registry of registries) {
    const { tab, form, hook } = registry
    const formSource = read(form)
    const tabSource = read(tab)
    const state = 'state' in registry ? read(registry.state) : formSource

    expect(state).toContain('const [formError, setFormError]')
    expect(formSource).toMatch(/error=\{(form\.)?formError\}/)
    // The list's own failure is reported by the tab, outside the editor. The agent editor is not
    // even on the list's screen any more — it opens as its own tab — so the tab states the load
    // failure plainly, where Skills still has to suppress it while its drawer is up.
    expect(tabSource).toMatch(/errors=\{[^}]*error/)
    expect(tabSource).not.toContain('formError')
    expect(tabSource).not.toMatch(new RegExp(`const \\{[^}]*setError[^}]*\\} = ${hook}`, 's'))
  }
})
