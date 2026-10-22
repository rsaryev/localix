import { expect, test } from 'bun:test'
import { contentFromText } from '../content/text'
import { readQuadrant, writeQuadrant, type QuadrantContent } from './quadrant'
import { spaceTypes } from './index'

const CHART = `quadrantChart
  title Q3 bets
  x-axis Low effort --> High effort
  y-axis Low impact --> High impact
  quadrant-1 Major projects
  quadrant-2 Do first
  quadrant-3 Fill-ins
  quadrant-4 Avoid
  Offline mode:::focal: [0.25, 0.85]
  Dark theme: [0.2, 0.3]
  %% a comment
  classDef focal color: #f00`

test('a quadrantChart reads into a matrix and writes back the same', () => {
  const read = readQuadrant(CHART) as QuadrantContent
  expect(read).toEqual({
    title: 'Q3 bets',
    xAxis: { low: 'Low effort', high: 'High effort' },
    yAxis: { low: 'Low impact', high: 'High impact' },
    quadrants: ['Major projects', 'Do first', 'Fill-ins', 'Avoid'],
    points: [
      { label: 'Offline mode', x: 0.25, y: 0.85, focal: true },
      { label: 'Dark theme', x: 0.2, y: 0.3 },
    ],
  })
  expect(readQuadrant(writeQuadrant(read))).toEqual(read)
})

test('what it cannot draw is refused, and a pasted chart becomes a native matrix', () => {
  expect(readQuadrant('quadrantChart\n  Big: [1.4, 0.2]')).toContain('0…1')
  expect(readQuadrant('quadrantChart\n  something else')).toMatch(/^line 2/u)
  // A point's own styling is Mermaid's to draw: refused, so the full element keeps it.
  expect(readQuadrant('quadrantChart\n  Big: [0.4, 0.2] radius: 12')).toMatch(/^line 2/u)
  expect(contentFromText(`\`\`\`mermaid\n${CHART}\n\`\`\``, spaceTypes).type).toBe('quadrant')
  expect(contentFromText(CHART, spaceTypes).type).toBe('quadrant')
})
