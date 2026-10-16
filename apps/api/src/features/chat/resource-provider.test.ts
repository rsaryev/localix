import { describe, expect, test } from 'bun:test'
import {
  CHAT_NAV_MAX_MESSAGES,
  chatMessagePreview,
  createChatResourceProvider,
  type ChatNavDeps,
  type ChatNavMessage,
} from './resource-provider'

function fakeDeps(over: Partial<ChatNavDeps> = {}): ChatNavDeps {
  return {
    listProjects: async () => [{ id: 'p1', name: 'Localix' }],
    listProjectSessions: async () => [
      {
        id: 's1',
        title: 'Fix the parser',
        runtimeStatus: 'idle',
        updatedAt: '2026-07-01T00:00:00Z',
      },
    ],
    listSessionMessages: async () => [
      { id: 'm1', role: 'user', preview: 'hello there' },
      { id: 'm2', role: 'assistant', preview: 'general kenobi' },
    ],
    listRecentSessionMessages: async () => ({
      messages: [
        { id: 'm1', role: 'user', preview: 'hello there' },
        { id: 'm2', role: 'assistant', preview: 'general kenobi' },
      ],
      hasMore: false,
    }),
    loadProjectDigest: async (_u, id) => (id === 'p1' ? 'Project "Localix"' : null),
    loadSessionDigest: async (_u, id) => (id === 's1' ? 'Session digest' : null),
    loadMessageDigest: async (_u, sid, mid) =>
      sid === 's1' && mid === 'm1' ? 'Message digest' : null,
    ...over,
  }
}

describe('chat resource provider', () => {
  test('drills projects → sessions → messages with native-kind icons', async () => {
    const p = createChatResourceProvider(fakeDeps())
    const roots = await p.listChildren('u', null)
    expect(roots.map((n) => [n.uri, n.icon])).toEqual([
      ['localix://resource/chat/project/p1', 'project'],
    ])
    const sessions = await p.listChildren('u', 'localix://resource/chat/project/p1')
    expect(sessions.map((n) => [n.uri, n.icon])).toEqual([
      ['localix://resource/chat/session/s1', 'session'],
    ])
    const messages = await p.listChildren('u', 'localix://resource/chat/session/s1')
    expect(messages.map((n) => n.uri)).toEqual([
      'localix://resource/chat/message/s1/m1',
      'localix://resource/chat/message/s1/m2',
    ])
    expect(messages.every((n) => !n.hasChildren && n.icon === 'message')).toBe(true)
  })

  test('a typed query searches messages PAST the cap (filter first, then cap)', async () => {
    // The needle sits beyond CHAT_NAV_MAX_MESSAGES in the (newest-first) list.
    const many: ChatNavMessage[] = [
      ...Array.from({ length: CHAT_NAV_MAX_MESSAGES + 10 }, (_, i) => ({
        id: `m${i}`,
        role: 'user',
        preview: `message number ${i}`,
      })),
      { id: 'needle', role: 'assistant', preview: 'the flux capacitor answer' },
    ]
    const p = createChatResourceProvider(
      fakeDeps({
        listRecentSessionMessages: async () => ({
          messages: many.slice(0, CHAT_NAV_MAX_MESSAGES),
          hasMore: true,
        }),
        listSessionMessages: async () => many,
      }),
    )
    const page = await p.listChildren('u', 'localix://resource/chat/session/s1')
    // The capped page states its truncation in-band: 40 message rows + 1 notice.
    const messageRows = page.filter((n) => !n.notice)
    expect(messageRows).toHaveLength(CHAT_NAV_MAX_MESSAGES)
    expect(messageRows.some((n) => n.uri.endsWith('/needle'))).toBe(false)
    const notice = page.find((n) => n.notice)
    expect(notice?.label).toContain(`Showing newest ${CHAT_NAV_MAX_MESSAGES} messages`)
    const hits = await p.listChildren('u', 'localix://resource/chat/session/s1', 'flux')
    expect(hits.map((n) => n.uri)).toEqual(['localix://resource/chat/message/s1/needle'])
  })

  test('uses the bounded recent page unless a typed query needs the complete preview set', async () => {
    let recentReads = 0
    let completeReads = 0
    const p = createChatResourceProvider(
      fakeDeps({
        listRecentSessionMessages: async (_userId, _sessionId, limit) => {
          recentReads += 1
          expect(limit).toBe(CHAT_NAV_MAX_MESSAGES)
          return {
            messages: [{ id: 'recent', role: 'assistant', preview: 'recent answer' }],
            hasMore: false,
          }
        },
        listSessionMessages: async () => {
          completeReads += 1
          return [{ id: 'older', role: 'assistant', preview: 'older needle' }]
        },
      }),
    )

    expect(
      (await p.listChildren('u', 'localix://resource/chat/session/s1')).map((n) => n.label),
    ).toEqual(['recent answer'])
    expect(recentReads).toBe(1)
    expect(completeReads).toBe(0)

    expect(
      (await p.listChildren('u', 'localix://resource/chat/session/s1', 'needle')).map(
        (n) => n.label,
      ),
    ).toEqual(['older needle'])
    expect(recentReads).toBe(1)
    expect(completeReads).toBe(1)
  })

  test('expand delegates to the native digest loaders; unknown node soft-fails', async () => {
    const p = createChatResourceProvider(fakeDeps())
    expect(await p.expand('u', 'localix://resource/chat/project/p1')).toEqual({
      ok: true,
      content: 'Project "Localix"',
    })
    expect(await p.expand('u', 'localix://resource/chat/message/s1/m1')).toEqual({
      ok: true,
      content: 'Message digest',
    })
    const miss = await p.expand('u', 'localix://resource/chat/message/s1/ghost')
    expect(miss.ok).toBe(false)
  })

  test('chatMessagePreview flattens whitespace and falls back to the role', () => {
    expect(chatMessagePreview('user', '  hello\n\n world ')).toBe('hello world')
    expect(chatMessagePreview('assistant', '')).toBe('(assistant)')
  })
})
