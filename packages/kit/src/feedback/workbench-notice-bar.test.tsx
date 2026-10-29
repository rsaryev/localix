import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CircleAlert, Info } from 'lucide-react'
import { Button } from '../controls/button'
import { WorkbenchNoticeBar } from './workbench-notice-bar'

describe('WorkbenchNoticeBar', () => {
  test('keeps event semantics caller-owned and colour on the signal glyph', () => {
    const html = renderToStaticMarkup(
      <WorkbenchNoticeBar
        role="status"
        aria-live="polite"
        tone="warning"
        icon={<CircleAlert className="size-3.5" />}
        title="Connection interrupted"
        description="Working offline"
        actionsLabel="Connection actions"
        actions={<Button size="sm">Retry</Button>}
        onDismiss={() => {}}
        dismissLabel="Dismiss connection notice"
      />,
    )

    expect(html).toContain('data-slot="workbench-notice-bar"')
    expect(html).toContain('data-tone="warning"')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('border-border-soft')
    expect(html).toContain('text-status-warning')
    expect(html).not.toContain('border-status-warning')
    expect(html).not.toContain('bg-status-warning')
    expect(html).toContain('aria-label="Connection actions"')
    expect(html).toContain('aria-label="Dismiss connection notice"')
  })

  test('a notice whose title says it all leads with the title, with no glyph before it', () => {
    const html = renderToStaticMarkup(
      <WorkbenchNoticeBar title="Tip" description="Pin a chat to keep it on top" />,
    )

    expect(html).not.toContain('aria-hidden="true"')
    expect(html.indexOf('Tip')).toBeLessThan(html.indexOf('Pin a chat'))
  })

  test('keeps detailed lifecycle copy and actions on a stable stacked grid', () => {
    const html = renderToStaticMarkup(
      <WorkbenchNoticeBar
        layout="stacked"
        icon={<Info className="size-3.5" />}
        title="Rebase in progress"
        description="Resolve conflicts, then continue or abort."
        actions={<Button size="sm">Continue</Button>}
      />,
    )

    expect(html).toContain('data-layout="stacked"')
    expect(html).toContain('grid-cols-[auto_minmax(0,1fr)_auto]')
    expect(html).toContain('col-start-2 row-start-2')
    expect(html).toContain('max-w-full')
    expect(html).toContain('w-full')
    expect(html).not.toContain('role="status"')
    expect(html).not.toContain('role="alert"')
  })
})
