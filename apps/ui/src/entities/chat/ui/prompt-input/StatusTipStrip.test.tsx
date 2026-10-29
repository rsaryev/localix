import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { StatusTipStrip } from './StatusTipStrip'

describe('StatusTipStrip', () => {
  test('does not duplicate stream activity when there is no tip', () => {
    const html = renderToStaticMarkup(<StatusTipStrip />)

    expect(html).toBe('')
  })

  test('shows only the contextual tip above the composer', () => {
    const html = renderToStaticMarkup(
      <StatusTipStrip
        tip={{
          id: 't1',
          text: 'Press Esc to interrupt',
          actions: [{ kind: 'insert', label: '/help', text: '/help' }],
        }}
        onDismissTip={() => {}}
      />,
    )

    expect(html).toContain('>Tip<')
    expect(html).toContain('Press Esc to interrupt')
    expect(html).toContain('/help')
    expect(html).toContain('data-slot="workbench-notice-bar"')
    expect(html).toContain('data-slot="composer-command-button"')
    // The title and the command's own type say what they are; the only picture is the dismiss.
    expect(html.match(/<svg/g)).toHaveLength(1)
    expect(html).toContain('lucide-x')
    expect(html).toContain('border-border-soft')
    expect(html).not.toContain('lx-activity-orb')
    expect(html).not.toContain('role="status"')
  })
})
