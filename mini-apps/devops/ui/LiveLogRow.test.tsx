import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { LiveLogRow } from './LiveLogRow'
import { parseLogLines } from './model/logLines'

test('renders timestamp, severity treatment, and matching text without changing the source line', () => {
  const [line] = parseLogLines('2026-07-28T10:11:12.345Z ERROR database unavailable')
  if (!line) throw new Error('Expected a parsed log line')

  const html = renderToStaticMarkup(
    <LiveLogRow index={0} line={line} measureElement={() => {}} query="database" start={18} wrap />,
  )

  expect(html).toContain('dateTime="2026-07-28T10:11:12.345Z"')
  expect(html).toContain('10:11:12.345')
  expect(html).toContain('border-l-status-error')
  expect(html).toContain('<mark')
  expect(html).toContain('>database</mark>')
  expect(html).toContain('translateY(22px)')
})

test('uses parsed console tokens when no text filter is active', () => {
  const [line] = parseLogLines('INFO GET /health 200')
  if (!line) throw new Error('Expected a parsed log line')

  const html = renderToStaticMarkup(
    <LiveLogRow index={0} line={line} measureElement={() => {}} query="" start={0} wrap={false} />,
  )

  expect(html).toContain('font-medium text-status-info')
  expect(html).toContain('font-medium text-accent')
  expect(html).toContain('text-status-success')
  expect(html).toContain('whitespace-pre')
})
