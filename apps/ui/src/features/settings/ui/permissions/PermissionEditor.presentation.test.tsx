import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PermissionEditor, PermissionLegend } from './PermissionEditor'
import type { RuleGrammar } from '@/shared/api/contracts'
import { effectOptions } from './permissionActionColors'

/** A grammar the way the server sends one — the editor and legend name none of it themselves. */
const GRAMMAR: RuleGrammar = {
  kinds: [{ prefix: 'tool:', label: 'Tool', hint: 'A model-facing tool' }],
  effects: [
    { value: 'allow', hint: 'Runs without asking' },
    { value: 'ask', hint: 'Prompts you each time' },
    { value: 'deny', hint: 'Refused' },
  ],
  classes: [
    { value: '*', hint: 'Everything this permission selects', appliesTo: ['tool'] },
    { value: 'dangerous', hint: 'A destructive shell command', appliesTo: ['tool'] },
  ],
  examples: [
    {
      action: 'tool:Bash',
      resource: 'dangerous',
      effect: 'ask',
      note: 'Confirm destructive shell',
    },
  ],
}

describe('Permission editor presentation', () => {
  test('renders rules and examples as flat native rows', () => {
    const html = renderToStaticMarkup(
      <>
        <PermissionEditor
          rules={[{ action: 'tool:shell', resource: 'git *', effect: 'ask' }]}
          actionNames={['tool:shell', 'tool:Read', 'skill:deploy', 'mcp:github/create_pr']}
          grammar={GRAMMAR}
          onChange={() => {}}
        />
        <PermissionLegend grammar={GRAMMAR} />
      </>,
    )

    expect(html).toContain('divide-y')
    expect(html).toContain('role="group"')
    // The editor draws no boundary of its own: `SettingsSurface` already wraps it in one, and
    // two stacked read as a double rule with a band of padding trapped between them.
    expect(html.slice(0, html.indexOf('role="group"'))).not.toContain('border-y')
    expect(html).toContain('aria-label="Permission rule 1"')
    expect(html).toContain('aria-label="Rule 1 pattern"')
    expect(html).toContain('aria-label="Remove permission rule 1"')
    // Order is the semantics inside a scope, so it has to be editable in place — by the grip,
    // and by a keyboard, which native drag alone never reaches.
    expect(html).toContain('data-slot="drag-handle"')
    expect(html).toContain('aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"')
    expect(html).toContain('aria-posinset="1"')
    expect(html).toContain('aria-setsize="1"')
    // Every kind is one keystroke away, not just tools.
    expect(html).toContain('value="skill:deploy"')
    expect(html).toContain('value="mcp:github/create_pr"')
    expect(html).toContain('data-slot="button"')
    expect(html).toContain('data-slot="input"')
    const classTokens = html.split(/[\s"]/)
    expect(classTokens).not.toContain('bg-muted/5')
    expect(classTokens).not.toContain('bg-muted/30')
  })

  test('the legend no longer restates the effects — each is its own option line', () => {
    // An effect's meaning sat in a legend paragraph below the rules, away from the Effect field
    // where it is chosen. It is the option's `description` now; the legend keeps what no single
    // field can say: prefixes, classes, examples and that the last match decides.
    const legend = renderToStaticMarkup(<PermissionLegend grammar={GRAMMAR} />)
    expect(legend).not.toContain('Runs without asking')
    expect(legend).toContain('A model-facing tool')
    expect(legend).toContain('A destructive shell command')
    expect(legend).toContain('LAST matching rule decides')
    expect(effectOptions(GRAMMAR.effects)).toContainEqual({
      value: 'allow',
      label: 'allow',
      description: 'Runs without asking',
    })
  })
})
