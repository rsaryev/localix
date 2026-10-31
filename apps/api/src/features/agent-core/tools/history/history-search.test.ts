import { describe, it, expect } from 'bun:test'
import type { HistorySearchRepo } from './history-search'
import { createGlobalSearchTool } from '../global-search/global-search'
import { toFtsMatchQuery, extractMessageText } from './history-search-format'

/** The history modes now live in `GlobalSearch`; these tests drive them through it. */
const createHistorySearchTool = (repo: HistorySearchRepo, userId: string) =>
  createGlobalSearchTool({ history: repo, userId, sessionId: 'session-test', projectId: null })

describe('extractMessageText', () => {
  it('returns a non-empty string content directly', () => {
    expect(extractMessageText('{"content":"hello world"}')).toBe('hello world')
  })
  it('joins the text items when content is absent', () => {
    expect(
      extractMessageText(
        '{"items":[{"type":"text","text":"one"},{"type":"tool_call"},{"type":"text","text":"two"}]}',
      ),
    ).toBe('one two')
  })
  it('returns "" for empty content, no items, or invalid JSON', () => {
    expect(extractMessageText('{"content":""}')).toBe('')
    expect(extractMessageText('{}')).toBe('')
    expect(extractMessageText('{not json')).toBe('')
  })
})

describe('toFtsMatchQuery', () => {
  it('wraps each word as a quoted (implicitly ANDed) term', () => {
    expect(toFtsMatchQuery('4096 game react')).toBe('"4096" "game" "react"')
  })

  it('neutralizes FTS5 metacharacters that would otherwise raise a syntax error', () => {
    // An input of the shape that crashed in the v2 run: `# Implementation Plan: 4096 Game`
    expect(toFtsMatchQuery('# Implementation Plan: 4096 Game')).toBe(
      '"Implementation" "Plan:" "4096" "Game"',
    )
    // Bare metacharacters must never reach MATCH unquoted.
    expect(toFtsMatchQuery('foo AND bar OR -baz')).toBe('"foo" "AND" "bar" "OR" "-baz"')
  })

  it('strips embedded double quotes so the phrase stays well-formed', () => {
    expect(toFtsMatchQuery('"4096 Game" plan')).toBe('"4096" "Game" "plan"')
  })

  it('returns an empty string when nothing is searchable', () => {
    expect(toFtsMatchQuery('   ')).toBe('')
    expect(toFtsMatchQuery('# : ^ ( ) -')).toBe('')
  })

  it('keeps unicode words', () => {
    expect(toFtsMatchQuery('παιχνίδι 4096')).toBe('"παιχνίδι" "4096"')
  })
})

/**
 * Provenance published by the tool itself.
 *
 * `history_search` was the one source producer with no assertion on its sources at all, found by
 * counting `sources` mentions across the producers' test files. Its two modes make a distinction
 * that is easy to erase in a refactor and impossible to see in the output: DISCOVERY returns which
 * sessions matched — a match is not a read — while SCROLL returns the messages themselves, so that
 * session's content really is in the evidence the model saw.
 */
describe('GlobalSearch history provenance', () => {
  const row = (id: string, sessionId: string) => ({
    id,
    sessionId,
    role: 'assistant',
    payloadJson: JSON.stringify({ content: 'hello' }),
    sequence: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
  })

  function makeRepo(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      searchHistoryDetailed: async () => [
        {
          sessionId: 's-1',
          messageId: 'm-1',
          snippet: 'hit',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
        {
          sessionId: 's-2',
          messageId: 'm-2',
          snippet: 'hit',
          createdAt: '2026-07-02T00:00:00.000Z',
        },
      ],
      getSessionMetaByIds: async () => [
        {
          id: 's-1',
          title: 'Indexing rewrite',
          createdAt: '2026-07-01T00:00:00.000Z',
          lastMessageAt: '2026-07-01T00:00:00.000Z',
        },
      ],
      getHistoryMessageWindow: async (_u: string, sessionId: string) => [row('m-1', sessionId)],
      getSessionBookends: async () => ({ first: [], last: [] }),
      ...overrides,
    } as unknown as Parameters<typeof createHistorySearchTool>[0]
  }

  it('discovery publishes every matched session as DISCOVERED, never consulted', async () => {
    const tool = createHistorySearchTool(makeRepo(), 'u1')
    const result = await tool.execute('c1', { query: 'indexing' }, new AbortController().signal)

    expect(result.sources?.map((s) => [s.kind, s.role, s.title])).toEqual([
      ['session', 'discovered', 'Indexing rewrite'],
      // No metadata row for s-2, so the id stands in — a row with a blank label would be worse.
      ['session', 'discovered', 's-2'],
    ])
    expect(result.sources?.[0]?.uri).toBe('localix://ui/work-item/chat?session=s-1')
  })

  it('scroll publishes the one session it actually read, as CONSULTED', async () => {
    const tool = createHistorySearchTool(makeRepo(), 'u1')
    const result = await tool.execute('c1', { session_id: 's-9' }, new AbortController().signal)

    expect(result.sources).toHaveLength(1)
    expect(result.sources?.[0]?.role).toBe('consulted')
    expect(result.sources?.[0]?.uri).toBe('localix://ui/work-item/chat?session=s-9')
  })

  it('a scroll that found nothing publishes nothing', async () => {
    // The session exists but the anchor matched no messages: nothing informed the answer, so a
    // source row here would claim provenance the tool never had.
    const tool = createHistorySearchTool(
      makeRepo({ getHistoryMessageWindow: async () => [] }),
      'u1',
    )
    const result = await tool.execute('c1', { session_id: 's-9' }, new AbortController().signal)

    expect(result.sources).toBeUndefined()
  })
})
