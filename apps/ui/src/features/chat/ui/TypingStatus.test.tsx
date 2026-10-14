import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TypingStatus } from './TypingStatus'

describe('TypingStatus', () => {
  test('renders one width-stable activity cue', () => {
    const html = renderToStaticMarkup(<TypingStatus label="Working…" />)

    expect(html).toContain('lx-activity-orb')
    expect(html).toContain('data-state="working"')
    expect(html).toContain('>Working</span>')
    expect(html).not.toContain('rounded-full')
    expect(html).not.toContain('Working…')
  })
})
