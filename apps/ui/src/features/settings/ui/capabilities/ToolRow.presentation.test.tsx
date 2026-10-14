import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CapabilityToolRow } from '../../model/useCapabilityTools'
import { ToolRow } from './ToolRow'

const tool = (over: Partial<CapabilityToolRow> = {}): CapabilityToolRow => ({
  name: 'bash',
  label: 'Bash',
  description: 'Run a shell command',
  category: 'execution',
  enabled: true,
  ...over,
})

const render = (row: CapabilityToolRow) =>
  renderToStaticMarkup(<ToolRow tool={row} busy={false} onToggle={() => {}} />)

describe('a tool row', () => {
  test('shows the switch and the tool it is about', () => {
    const html = render(tool())

    expect(html).toContain('aria-label="Disable Bash"')
    expect(html).toContain('bash')
    expect(html).toContain('Run a shell command')
    expect(html).not.toContain('disabled=""')
  })

  /**
   * "Off" has two causes and only one of them is the user's to change. A rule someone wrote
   * is lifted by the switch; a tool the scope structurally does not carry is not, and a
   * switch that silently did nothing is how the screen came to disagree with the turn.
   */
  test('a rule denial keeps the switch, and says which rule', () => {
    const html = render(
      tool({
        enabled: false,
        denial: { name: 'bash', reason: 'denied by project rule', source: 'settings' },
      }),
    )

    expect(html).toContain('aria-label="Enable Bash"')
    expect(html).toContain('denied by project rule')
    expect(html).not.toContain('disabled=""')
  })

  test('a structural denial disables the switch instead of lying', () => {
    const html = render(
      tool({
        enabled: false,
        denial: { name: 'bash', reason: 'its plugin is off', source: 'capability' },
      }),
    )

    expect(html).toContain('disabled=""')
    expect(html).toContain('its plugin is off')
  })
})
