import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { act } from 'react'
import type { RosterRow } from '@localixai/api/external-agent-contracts'
import * as history from '@/features/external-agents/model/useExternalHistory'
import { HISTORY_SOURCE_KEY, useHistorySource } from './useHistorySource'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

const row = (id: string, title: string, cwd: string): RosterRow => ({
  key: `codex:${id}`,
  provider: 'codex',
  nativeSessionId: id,
  title,
  cwd,
  updatedAt: Date.now(),
  sourcePath: `/history/${id}.jsonl`,
  state: 'idle',
  authority: 'none',
})

/**
 * The server answers a search over title, folder and id (`roster.ts` `matchesText`). The sidebar
 * used to filter those answers again by title alone, so a search for the folder a session ran in
 * found it on the server and then hid it.
 */
test('a session the server found by its folder or id stays listed', async () => {
  localStorage.setItem(HISTORY_SOURCE_KEY, 'external')
  const matches = [
    row('s1', 'Parser review', '/work/app/billing-service'),
    row('0197aa00-1111', 'Untitled', '/work/app'),
  ]
  const query = spyOn(history, 'useExternalHistory').mockReturnValue({
    agents: [],
    sessions: matches,
    loading: false,
    loadingMore: false,
    error: undefined,
    total: matches.length,
    hasMore: false,
    loadMore: async () => [],
    refresh: async () => {},
  })
  const seen: string[][] = []
  function Probe({ search }: { search: string }) {
    const source = useHistorySource({
      allSessions: [],
      scopeSessions: [],
      activeProject: { id: 'p', workingDir: '/work/app' },
      search,
      sortMode: 'recent',
    })
    seen.push(source.visibleSessions.map((session) => session.title))
    return null
  }
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Probe search="billing" />))
    expect(seen.at(-1)).toEqual(['Parser review', 'Untitled'])
    expect(query).toHaveBeenLastCalledWith('billing', true, { cwd: '/work/app' })
    await act(async () => root.render(<Probe search="0197aa00" />))
    expect(seen.at(-1)).toEqual(['Parser review', 'Untitled'])
  } finally {
    await act(async () => root.unmount())
    query.mockRestore()
    localStorage.clear()
  }
})
