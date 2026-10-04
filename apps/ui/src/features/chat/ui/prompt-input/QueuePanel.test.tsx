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
    expect(html).toContain('data-size="icon"')
    expect(html).toContain('data-slot="workbench-list-row-meta"')
    expect(html).not.toContain('sm:opacity-0')
  })

  test('keeps trusted wakes delete-only', () => {
    const html = render({
      id: 'wake-1',
      text: 'trusted internal continuation',
      queueKind: 'wake',
      delivery: 'next-turn',
    })

    expect(html).toContain('Next turn')
    expect(html).toContain('Delete')
    expect(html).not.toContain('Send now')
    expect(html).not.toContain('>Return<')
  })
})
