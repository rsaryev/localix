import { expect, test } from 'bun:test'
import { useBrowserHistory } from '../model/browserHistory'
import { BROWSER_HISTORY_URL } from '../model/browserUrl'
import { usePreviewStore } from '../model/previewStore'
import { runHistoryCommand } from './useBrowserHistoryAgent'

test('agent can search, open, and remove Browser history without a website tab', () => {
  const previous = useBrowserHistory.getState().visits
  const tabs = usePreviewStore.getState()
  useBrowserHistory.setState({
    visits: [
      { url: 'https://example.com/a', title: 'Alpha', visitedAt: 2 },
      { url: 'https://other.example/', title: 'Other', visitedAt: 1 },
    ],
  })
  try {
    const search = JSON.parse(
      runHistoryCommand('history-chat', {
        action: 'history',
        historyOperation: 'search',
        historyQuery: 'alpha',
      }),
    ) as { total: number; entries: Array<{ url: string }> }
    expect(search.total).toBe(1)
    expect(search.entries[0]?.url).toBe('https://example.com/a')
    const opened = JSON.parse(
      runHistoryCommand('history-chat', { action: 'history', historyOperation: 'open' }),
    ) as { tab_id: string }
    // The History tab opens in the Browser of the chat that asked, not in a shared one.
    expect(usePreviewStore.getState().previewBySession['history-chat']?.previewId).toBe(
      opened.tab_id,
    )
    expect(usePreviewStore.getState().previewBySession['history-chat']?.url).toBe(
      BROWSER_HISTORY_URL,
    )
    const removed = JSON.parse(
      runHistoryCommand('history-chat', {
        action: 'history',
        historyOperation: 'remove',
        historyUrls: ['https://example.com/a'],
      }),
    ) as { removed: number; total: number }
    expect(removed).toEqual({ removed: 1, total: 1 })
  } finally {
    useBrowserHistory.setState({ visits: previous })
    usePreviewStore.setState({
      previewBySession: tabs.previewBySession,
      previewTabsBySession: tabs.previewTabsBySession,
    })
  }
})
