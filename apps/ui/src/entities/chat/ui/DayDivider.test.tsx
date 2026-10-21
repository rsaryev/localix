import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { DayDivider } from './DayDivider'

describe('DayDivider', () => {
  test('carries a machine-readable date beside the label', () => {
    // Only the structure is asserted here: the component reads the clock itself, so its
    // LABEL is `dayLabel`'s to test (`shared/lib/calendarDay`) — that one takes `now`.
    const day = new Date('2026-09-11T09:00:00')
    const html = renderToStaticMarkup(<DayDivider day={day} />)
    expect(html).toContain('<time')
    expect(html.toLowerCase()).toContain(`datetime="${day.toISOString().toLowerCase()}"`)
    expect(html).toContain('role="separator"')
  })
})
