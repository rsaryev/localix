import { describe, expect, test } from 'bun:test'
import { Box, Container } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { OverviewRegistryRow } from './overview-registry-row'

describe('OverviewRegistryRow presentation', () => {
  test('renders mini app navigation as a flat metric registry row', () => {
    const html = renderToStaticMarkup(
      <OverviewRegistryRow
        title="Container engine"
        description="Inspect local workloads."
        icon={Container}
        metrics={[{ label: 'Running', value: '3/5', icon: Box }]}
        onOpen={() => {}}
      />,
    )

    expect(html).toContain('data-slot="overview-registry-row"')
    expect(html).toContain('Container engine')
    expect(html).toContain('Running')
    expect(html).not.toContain('rounded-xl')
    expect(html).not.toContain('bg-surface-raised')
    expect(html).not.toContain('bg-background/70')
  })
})
