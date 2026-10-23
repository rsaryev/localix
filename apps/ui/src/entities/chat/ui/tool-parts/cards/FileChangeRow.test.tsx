import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FileChange } from '@localixai/agent/agents'
import { FileChangeRow } from './FileChangeRow'

describe('FileChangeRow presentation', () => {
  test('renders an applied file as a flat change row', () => {
    const html = renderToStaticMarkup(
      <FileChangeRow
        change={
          {
            path: 'src/app.ts',
            kind: 'modify',
            diff: '@@ -1 +1 @@\n-old\n+new',
          } as FileChange
        }
      />,
    )

    expect(html).toContain('src/app.ts')
    expect(html).toContain('data-tooltip-trigger="true"')
    expect(html).not.toContain('title=')
  })

  test('keeps failure tone on the status track without a red card', () => {
    const html = renderToStaticMarkup(
      <FileChangeRow
        change={
          {
            path: 'src/missing.ts',
            kind: 'modify',
            failed: true,
            failReason: 'Context no longer matches',
          } as FileChange
        }
      />,
    )

    expect(html).toContain('border-l-status-error')
    expect(html).toContain('Context no longer matches')
    expect(html).toContain('data-tooltip-trigger="true"')
    expect(html).not.toContain('title=')
  })
})
