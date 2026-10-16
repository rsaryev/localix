import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkbenchBreadcrumb } from './workbench-breadcrumb'

describe('WorkbenchBreadcrumb', () => {
  test('renders a named ordered navigation path', () => {
    const html = renderToStaticMarkup(
      <WorkbenchBreadcrumb aria-label="Session path" dragRegion>
        <li>Workspace</li>
        <li aria-current="page">Session</li>
      </WorkbenchBreadcrumb>,
    )

    expect(html).toStartWith('<nav')
    expect(html).toContain('data-slot="workbench-breadcrumb"')
    expect(html).toContain('aria-label="Session path"')
    expect(html).toContain('<ol')
    expect(html).toContain('aria-current="page"')
    expect(html.match(/data-tauri-drag-region="true"/g)).toHaveLength(2)
    expect(html).not.toContain('role="navigation"')
  })

  test('uses tokenized compact geometry and an optional boundary rule', () => {
    const html = renderToStaticMarkup(
      <WorkbenchBreadcrumb aria-label="Document symbols" density="compact" bordered>
        <li>functionName</li>
      </WorkbenchBreadcrumb>,
    )

    expect(html).toContain('h-[var(--chrome-control-md)]')
    expect(html).toContain('border-b')
    expect(html).toContain('px-(--workbench-gutter)')
    expect(html).not.toContain('py-1')
    expect(html).not.toContain('pr-24')
  })
})
