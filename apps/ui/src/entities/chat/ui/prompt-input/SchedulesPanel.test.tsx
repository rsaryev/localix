import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { LoopRunMetadata } from './SchedulesPanel'

describe('LoopRunMetadata', () => {
  it('renders target and failure as flat IDE metadata', () => {
    const html = renderToStaticMarkup(
      <LoopRunMetadata subsession runCount={3} failed title="Last run failed" />,
    )

    expect(html).toContain('lucide-git-fork')
    expect(html).toContain('lucide-circle-alert')
    expect(html).toContain('×3')
    expect(html).not.toContain('bg-surface-raised')
    expect(html).not.toContain('> !<')
  })
})
