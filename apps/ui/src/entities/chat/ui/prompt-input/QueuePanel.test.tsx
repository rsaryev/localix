import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueuePanel, type QueuePanelItem } from './QueuePanel'

const render = (item: QueuePanelItem): string =>
  renderToStaticMarkup(
    <QueuePanel queue={[item]} onRemove={() => {}} onSendNow={() => {}} onClear={() => {}} />,
  )

describe('QueuePanel server semantics', () => {
  test('surfaces next-tool steering instead of presenting it as an ordinary queued turn', () => {
    const html = render({
      id: 'steer-1',
      text: 'Use the smaller fixture',
      queueKind: 'user',
      delivery: 'next-tool',
    })

    expect(html).toContain('Next tool')
    expect(html).toContain('Send now')
    expect(html).toContain('Return')
    expect(html).toContain('data-slot="workbench-list-row"')
    expect(html).toContain('role="listitem"')
    expect(html).toContain('aria-label="Queued item 1 actions"')
    expect(html).toContain('data-size="icon-sm"')
    expect(html).toContain('data-slot="workbench-list-row-action-fallback"')
    expect(html).not.toContain('sm:opacity-0')
  })

  test('keeps trusted wakes delete-only', () => {
    const html = render({
      id: 'wake-1',
      text: 'trusted internal continuation',
      queueKind: 'wake',
      delivery: 'next-turn',
    })

    // Waiting its turn is what every row does: only steering earns a word.
    expect(html).not.toContain('Next turn')
    expect(html).toContain('Delete')
    expect(html).not.toContain('Send now')
    expect(html).not.toContain('>Return<')
  })

  test('shows a delivery that failed every retry as failed, with retry and remove', () => {
    const html = render({
      id: 'wake-2',
      text: 'monitor burst',
      queueKind: 'wake',
      delivery: 'failed',
      failure: 'binding cannot be read',
    })

    expect(html).toContain('Failed to send')
    expect(html).toContain('binding cannot be read')
    // A failed wake is retried, never sent as the person's message.
    expect(html).toContain('Retry queued item 1')
    expect(html).not.toContain('Send now')
    expect(html).toContain('Delete')
  })
})
