import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AttentionRollup } from './AttentionRollup'

describe('settings attention summary', () => {
  test('uses flat semantic status marks instead of colored pills', () => {
    const html = renderToStaticMarkup(<AttentionRollup errorCount={2} warningCount={3} />)

    expect(html).toContain('lucide-circle-alert')
    expect(html).toContain('lucide-triangle-alert')
    expect(html).toContain('2 need attention')
    expect(html).toContain('3 with warnings')
    expect(html).not.toContain('rounded-full')
    expect(html).not.toContain('bg-status')
  })
})
