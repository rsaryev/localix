import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ListTree, X } from 'lucide-react'
import { IconButton } from '../controls/icon-button'
import { PanelHeader } from './panel-header'
import { WorkbenchSash } from '../controls/button'
import { WorkbenchToolbar, WorkbenchToolbarSection } from './workbench-toolbar'

describe('workbench chrome groups', () => {
  test('names the native Tab-order group and uses the pane-header measure', () => {
    const html = renderToStaticMarkup(
      <WorkbenchToolbar aria-label="Editor actions">
        <button type="button">Run</button>
      </WorkbenchToolbar>,
    )

    expect(html).toContain('data-slot="workbench-toolbar"')
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="Editor actions"')
    expect(html).toContain('h-[var(--panel-header-height)]')
  })

  test('supports compact and wrapping bars without inventing local heights', () => {
    const compact = renderToStaticMarkup(
      <WorkbenchToolbar density="compact" aria-label="Preview controls" />,
    )
    const slimCaption = renderToStaticMarkup(
      <WorkbenchToolbar as="figcaption" density="slim" aria-label="Code block controls" />,
    )
    const wrapping = renderToStaticMarkup(<WorkbenchToolbar wrap aria-label="Manifest actions" />)

    expect(compact).toContain('h-[var(--chrome-control-lg)]')
    expect(slimCaption).toStartWith('<figcaption')
    expect(slimCaption).toContain('h-[var(--chrome-control-md)]')
    expect(slimCaption).toContain('aria-label="Code block controls"')
    expect(wrapping).toContain('min-h-[var(--panel-header-height)]')
    expect(wrapping).toContain('flex-wrap')
  })

  // Plugins draw their headers with this toolbar and rely on its bottom seam instead of adding
  // their own (one plugin's chart chrome did, until that became the toolbar's job alone).
  test('draws the default bottom seam itself', () => {
    const html = renderToStaticMarkup(<WorkbenchToolbar aria-label="Chart controls" />)

    expect(html).toContain('border-b')
    expect(html).toContain('border-border-soft')
  })

  test('uses the sidebar seam token without changing toolbar semantics', () => {
    const html = renderToStaticMarkup(
      <WorkbenchToolbar tone="sidebar" aria-label="Explorer filters" />,
    )

    expect(html).toContain('border-sidebar-border')
    expect(html).not.toContain('border-border-soft')
    expect(html).toContain('role="group"')
  })

  test('supports semantic stacked search/filter headers without toolbar keyboard claims', () => {
    const html = renderToStaticMarkup(
      <WorkbenchToolbar as="header" layout="stacked" aria-label="Search controls">
        <input aria-label="Search" />
        <div>Scopes</div>
      </WorkbenchToolbar>,
    )

    expect(html).toStartWith('<header')
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="Search controls"')
    expect(html).toContain('flex-col')
    expect(html).toContain('items-stretch')
    expect(html).not.toContain('role="toolbar"')
  })

  test('separates compact trailing actions from flexible primary content', () => {
    const html = renderToStaticMarkup(
      <WorkbenchToolbar aria-label="Preview controls" wrap>
        <span>http://localhost:3000</span>
        <WorkbenchToolbarSection align="end" spacing="compact" wrap aria-label="Preview actions">
          <button type="button">Reload</button>
          <button type="button">Close</button>
        </WorkbenchToolbarSection>
      </WorkbenchToolbar>,
    )

    expect(html).toContain('data-slot="workbench-toolbar-section"')
    expect(html).toContain('data-align="end"')
    expect(html).toContain('ml-auto')
    expect(html).toContain('gap-0.5')
    expect(html).toContain('flex-wrap')
    expect(html).toContain('justify-end')
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="Preview actions"')
  })

  test('keeps an unlabeled status section semantically transparent', () => {
    const html = renderToStaticMarkup(
      <WorkbenchToolbarSection align="end">Applying changes</WorkbenchToolbarSection>,
    )

    expect(html).not.toContain('role="group"')
    expect(html).not.toContain('aria-label=')
    expect(html).toContain('gap-1.5')
  })

  test('panel headers expose decorative icons and a named trailing action group', () => {
    const html = renderToStaticMarkup(
      <PanelHeader
        title="Outline"
        icon={<ListTree />}
        summary={<span>12 symbols</span>}
        actions={
          <IconButton size="sm" aria-label="Hide outline">
            <X />
          </IconButton>
        }
      />,
    )

    expect(html).toStartWith('<header')
    expect(html).toContain('data-slot="panel-header"')
    expect(html).toContain('data-slot="panel-header-title"')
    expect(html).toContain('data-slot="panel-header-trailing"')
    expect(html).toContain('data-slot="panel-header-summary"')
    expect(html).toContain('12 symbols')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="Outline actions"')
    expect(html).toContain('aria-label="Hide outline"')
    expect(html.match(/role="group"/g)).toHaveLength(1)
    expect(html.indexOf('panel-header-summary')).toBeLessThan(html.indexOf('panel-header-actions'))
  })

  test('keeps a passive panel summary out of interactive group semantics', () => {
    const html = renderToStaticMarkup(
      <PanelHeader title="Review" summary={<span>4 pending</span>} />,
    )

    expect(html).toContain('data-slot="panel-header-summary"')
    expect(html).toContain('4 pending')
    expect(html).not.toContain('role="group"')
    expect(html).not.toContain('aria-label="Review actions"')
  })

  test('sash keeps one described range separator without a geometry wrapper', () => {
    const html = renderToStaticMarkup(
      <WorkbenchSash
        label="Resize sidebar"
        orientation="vertical"
        resetLabel="reset sidebar width"
        valueMin={180}
        valueMax={440}
        valueNow={268}
        valueText="268 pixels"
      />,
    )

    expect(html).toContain('data-slot="workbench-sash"')
    expect(html).toContain('role="separator"')
    expect(html).toContain('aria-description="Drag to resize · Use arrow keys to adjust')
    expect(html).toContain('aria-orientation="vertical"')
    expect(html).toContain('aria-valuenow="268"')
    expect(html).toContain('aria-valuetext="268 pixels"')
    expect(html).toContain('aria-keyshortcuts="ArrowLeft ArrowRight Home End Enter Space"')
    expect(html).toContain('tabindex="0"')
    expect(html).not.toContain('title=')
  })
})
