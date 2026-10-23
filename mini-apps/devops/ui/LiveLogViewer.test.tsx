import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { LiveLogViewer } from './LiveLogViewer'

test('renders virtual log chrome with a compact count and follow control', () => {
  const html = renderToStaticMarkup(
    <LiveLogViewer
      subject="web-1"
      content={'2026-07-24T12:34:56.123Z INFO server ready\nERROR database unavailable'}
      emptyLabel="No output."
      ariaLabel="Test logs"
      live
      onLiveChange={() => {}}
    />,
  )

  expect(html).toContain('role="log"')
  // Rows mount once the browser provides a scroll element; the parser/tokenizer
  // has its own deterministic tests and the server shell must stay lightweight.
  expect(html).toContain('2 lines')
  expect(html).toContain('class="relative min-w-full"')
  expect(html).not.toContain('server ready')
  expect(html).toContain('aria-label="Pause live logs"')
  expect(html).not.toContain('>Pause<')
  expect(html).not.toContain('>Live<')
  expect(html).toContain('Log actions and severity filters')
  expect(html).not.toContain('bg-surface-raised/20')
  // The canvas-level pause/follow control still owns a surface so it remains
  // readable over arbitrary log text.
  expect(html).toContain('bg-surface-raised/95')
})

test('keeps a paused snapshot quiet and centers an empty-state error', () => {
  const paused = renderToStaticMarkup(
    <LiveLogViewer
      subject="web-1"
      content=""
      error="Logs are temporarily unavailable."
      emptyLabel="No output."
      ariaLabel="Test logs"
      live={false}
      onLiveChange={() => {}}
    />,
  )

  expect(paused).toContain('Logs are temporarily unavailable.')
  expect(paused).toContain('aria-label="Resume and follow live logs"')
  expect(paused).not.toContain('>Play<')
  expect(paused).not.toContain('>Paused<')
  expect(paused).not.toContain('animate-pulse')
})
