import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueueDockPill } from './QueueDockPill'

test('one pill: faces for agents, one glyph per other kind, and the total', () => {
  const html = renderToStaticMarkup(
    <QueueDockPill
      queue={[
        { id: 't1', text: 'x', queueKind: 'wake', agent: { name: 'riddler' } },
        { id: 't2', text: 'x', queueKind: 'wake', agent: { name: 'sleuth' } },
        { id: 'u1', text: 'Use the smaller fixture', queueKind: 'user' },
        { id: 'u2', text: 'And rerun it', queueKind: 'user' },
        { id: 'w1', text: 'Nightly check', queueKind: 'wake', wakeSource: 'loop' },
      ]}
    />,
  )
  expect(html).toContain('aria-label="Queue, 5 waiting"')
  expect(html.match(/data-slot="monogram-avatar"/g)).toHaveLength(2)
  // Two messages share one glyph; the loop has its own.
  expect(html.match(/lucide-message-square-text/g)).toHaveLength(1)
  expect(html).toContain('>5<')
  expect(html).not.toContain('Use the smaller fixture')
})
