import { describe, expect, mock, test } from 'bun:test'
import type { UiSession } from '@/shared/api/contracts'

await mock.module('./AgentGroupHeader', () => ({
  AgentGroupHeader: ({ handle }: { handle: string }) => <div>{`Agent ${handle}`}</div>,
}))
await mock.module('./BranchMoreRow', () => ({ BranchMoreRow: () => null }))

const chat = (id: string, handle: string, updatedAt: number) =>
  ({
    id,
    updatedAt,
    agents: [{ handle }],
  }) as UiSession

describe('SessionRoster', () => {
  test('nests activity sections inside each agent group', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { SessionRoster } = await import('./SessionRoster')
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    const html = renderToStaticMarkup(
      <SessionRoster
        sessions={[
          chat('today-chat', 'lead', today.getTime()),
          chat('yesterday-chat', 'lead', yesterday.getTime()),
        ]}
        roster={['lead']}
        groupingMode="agent"
        renderSession={(session) => [<span key={session.id}>{session.id}</span>]}
        onNewChatWith={() => {}}
      />,
    )

    expect(html).toContain('Agent lead')
    expect(html).toContain('Today')
    expect(html).toContain('Yesterday')
    expect(html.indexOf('Today')).toBeLessThan(html.indexOf('today-chat'))
    expect(html.indexOf('Yesterday')).toBeLessThan(html.indexOf('yesterday-chat'))
  })
})
