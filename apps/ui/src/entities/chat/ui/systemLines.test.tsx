import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CommandOutputLine } from './CommandOutputLine'
import { SystemNoticeLine } from './SystemNoticeLine'

describe('system transcript lines', () => {
  test('renders an in-flight plugin install with the shared tool activity signal', () => {
    const html = renderToStaticMarkup(
      <CommandOutputLine
        output={{
          command: '/plugin',
          tone: 'neutral',
          text: 'Installing plugin',
          activity: {
            kind: 'plugin',
            action: 'install',
            state: 'running',
            label: 'Installing plugin',
            subject: 'owner/review',
          },
        }}
      />,
    )

    expect(html).toContain('data-command-activity="install"')
    expect(html).toContain('Installing plugin')
    expect(html).toContain('owner/review')
    expect(html).toContain('data-state="working"')
    expect(html).toContain('lx-activity-orb')
    expect(html).not.toContain('bg-surface')
  })

  test('renders a plugin result with a structured status icon and no emoji', () => {
    const html = renderToStaticMarkup(
      <CommandOutputLine
        output={{ command: '/plugin', tone: 'success', text: 'Installed `review`.' }}
      />,
    )

    expect(html).toContain('lucide-circle-check')
    expect(html).toContain('Completed')
    expect(html).toContain('Installed')
    expect(html).not.toContain('bg-surface')
  })

  test('uses distinct IDE glyphs for compact system events', () => {
    const cases = [
      ['model_change', 'lucide-cpu'],
      ['reasoning_change', 'lucide-brain'],
      ['connection_change', 'lucide-plug'],
      ['terminal_activity', 'lucide-square-terminal'],
    ] as const

    for (const [kind, iconClass] of cases) {
      const html = renderToStaticMarkup(
        <SystemNoticeLine notice={{ kind, tone: 'neutral', text: `${kind} happened` }} />,
      )

      expect(html).toContain(iconClass)
      expect(html).not.toContain('lucide-info')
      expect(html).not.toContain('bg-surface')
    }
  })
})
