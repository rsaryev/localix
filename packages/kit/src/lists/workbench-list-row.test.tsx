import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  WorkbenchListRow,
  WorkbenchListRowActions,
  WorkbenchListRowLeading,
  WorkbenchListRowMeta,
  WorkbenchListRowText,
  WorkbenchListRowTrigger,
} from './workbench-list-row'

describe('WorkbenchListRow', () => {
  test('shares one grid cell between passive metadata and hover actions', () => {
    const html = renderToStaticMarkup(
      <WorkbenchListRowActions aria-label="Row actions" visibility="hover" fallback="Sep 29">
        <button type="button">Actions</button>
      </WorkbenchListRowActions>,
    )
    expect(html).toContain('workbench-list-row-action-fallback')
    expect(html).toContain('Sep 29')
    expect(html.match(/col-start-1 row-start-1/g)).toHaveLength(2)
    expect(html).toContain('lx-hover-actions-fallback')
    expect(html).toContain('group-has-[[data-state=open]]/workbench-actions:opacity-0')
    expect(html).toContain('group-has-[[data-state=open]]/workbench-actions:opacity-100')
    // Always-visible controls have no passive fallback to overlap them.
    const always = renderToStaticMarkup(
      <WorkbenchListRowActions aria-label="Row actions" fallback="Sep 29">
        <button type="button">Actions</button>
      </WorkbenchListRowActions>,
    )
    expect(always).not.toContain('Sep 29')
    expect(always).not.toContain('workbench-list-row-action-fallback')
  })
  test('keeps the dense row and its navigation target on the same 28px tier', () => {
    const html = renderToStaticMarkup(
      <WorkbenchListRow density="dense">
        <WorkbenchListRowTrigger>Job</WorkbenchListRowTrigger>
      </WorkbenchListRow>,
    )

    expect(html).toContain('data-density="dense"')
    expect(html.match(/min-h-\[var\(--chrome-control-md\)\]/g)).toHaveLength(2)
    expect(html).not.toContain('min-h-[var(--chrome-control-lg)]')
    expect(html).not.toContain('min-h-8')
  })

  test('keeps navigation, metadata and secondary actions as semantic siblings', () => {
    const html = renderToStaticMarkup(
      <WorkbenchListRow density="compact" active dragging>
        <WorkbenchListRowTrigger aria-current="page">
          <WorkbenchListRowLeading>V</WorkbenchListRowLeading>
          <WorkbenchListRowText title="View" description="Plugin view" />
        </WorkbenchListRowTrigger>
        <WorkbenchListRowMeta>In rail</WorkbenchListRowMeta>
        <WorkbenchListRowActions aria-label="View actions" visibility="hover">
          <button type="button">Pin</button>
        </WorkbenchListRowActions>
      </WorkbenchListRow>,
    )

    const triggerStart = html.indexOf('data-slot="workbench-list-row-trigger"')
    const triggerEnd = html.indexOf('</button>', triggerStart)
    const actionsStart = html.indexOf('data-slot="workbench-list-row-actions"')

    expect(html).toContain('data-slot="workbench-list-row"')
    expect(html).toContain('data-density="compact"')
    expect(html).toContain('data-active="true"')
    expect(html).toContain('data-dragging="true"')
    expect(html).toContain('<button type="button" data-slot="workbench-list-row-trigger"')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('data-slot="workbench-list-row-leading"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('data-slot="workbench-list-row-title"')
    expect(html).toContain('data-slot="workbench-list-row-description"')
    expect(html).toContain('data-slot="workbench-list-row-meta"')
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="View actions"')
    expect(html).toContain('data-visibility="hover"')
    expect(triggerEnd).toBeLessThan(actionsStart)
  })
})
