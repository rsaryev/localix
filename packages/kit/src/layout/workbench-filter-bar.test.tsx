import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkbenchFilterBar } from './workbench-filter-bar'

test('filter bar owns its container and keeps scope and actions in a stable grid', () => {
  const html = renderToStaticMarkup(
    <WorkbenchFilterBar aria-label="Cluster filters" columns={4}>
      <span>Context</span>
      <span>Namespace</span>
      <span>Search</span>
      <span>Sort</span>
    </WorkbenchFilterBar>,
  )

  expect(html).toContain('data-slot="workbench-filter-bar"')
  expect(html).toContain('role="group" aria-label="Cluster filters"')
  expect(html).toContain('lx-workbench-filter-bar')
  expect(html).toContain('lx-workbench-filter-grid--four')
})
