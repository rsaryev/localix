import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import type { UiSession } from '@/shared/api/contracts'
// Static, not `await import()` inside the test: the preload holds a DOM only while a file's
// static graph evaluates. Imported later, Radix bound its layout-effect hook to the no-op it
// uses without a document, for the whole process, and the menus of later DOM suites lost
// their roles.
import { SessionRoster } from './SessionRoster'

const chat = (id: string, handle: string, updatedAt: number) =>
  ({
    id,
    updatedAt,
    agents: [{ handle }],
  }) as UiSession

describe('SessionRoster', () => {
  test('nests activity sections inside each agent group', () => {
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SessionRoster
          sessions={[
            chat('today-chat', 'lead', today.getTime()),
            chat('yesterday-chat', 'lead', yesterday.getTime()),
          ]}
          roster={['lead']}
          groupingMode="agent"
          renderSession={(session) => [<span key={session.id}>{session.id}</span>]}
          onNewChatWith={() => {}}
        />
      </MemoryRouter>,
    )

    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('Today')
    expect(html).toContain('Yesterday')
    expect(html.indexOf('Today')).toBeLessThan(html.indexOf('today-chat'))
    expect(html.indexOf('Yesterday')).toBeLessThan(html.indexOf('yesterday-chat'))
  })
})
