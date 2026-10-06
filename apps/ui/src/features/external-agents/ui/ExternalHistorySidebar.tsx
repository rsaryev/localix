import { useDeferredValue, useRef, useState } from 'react'
import { Button } from '@localixai/kit/button'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { ExternalHistoryList } from './ExternalHistoryList'
import { toast } from '@/shared/lib/notify'
import { useExternalHistory } from '../model/useExternalHistory'
import { externalHistoryGroups } from '../model/historyGroups'
import type { SessionGroupingMode } from '@/features/chat/model/sessionGrouping'
import type { SortMode } from '@/features/chat/model/useSidebarSessions'
import { useRoutedNavigation } from '@/shared/hooks/useRoutedNavigation'
import { openExternalSessionTerminal } from '../model/openSession'

export default function ExternalHistorySidebar({
  owningSessionId,
  search,
  enabled,
  scope,
  groupingMode = 'activity',
  sortMode = 'recent',
}: {
  owningSessionId: string | null
  search: string
  enabled: boolean
  scope?: { provider?: string; cwd?: string }
  groupingMode?: SessionGroupingMode
  sortMode?: SortMode
}) {
  const navigation = useRoutedNavigation()
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [opening, setOpening] = useState<string | null>(null)
  const inFlight = useRef(false)
  const query = useExternalHistory(useDeferredValue(search), enabled, scope)
  const groups = externalHistoryGroups(query.sessions)
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const open = async (source: (typeof query.sessions)[number]) => {
    if (inFlight.current) return
    inFlight.current = true
    setOpening(source.key)
    try {
      const destination = await openExternalSessionTerminal(source, owningSessionId)
      if (destination)
        navigation.goToSession(destination.sessionId, { project: destination.projectId })
    } catch (cause) {
      toast.error('Could not open this agent conversation', {
        description: errorMessage(cause, '') || undefined,
      })
    } finally {
      inFlight.current = false
      setOpening(null)
    }
  }

  return (
    <section aria-label="External agent history" className="flex h-full min-h-0 flex-col">
      {query.error && (
        <div role="alert" className="px-3 py-3 text-xs text-text-soft">
          Could not read agent history.{' '}
          <Button variant="ghost" size="sm" onClick={() => void query.refresh()}>
            Retry
          </Button>
        </div>
      )}
      {query.loading ? (
        <LoadingHint>Reading agent history…</LoadingHint>
      ) : !query.sessions.length && !query.error ? (
        <EmptyHint>
          {!query.agents.length
            ? 'No supported agent CLI is installed.'
            : search
              ? 'No sessions match this search.'
              : 'No recorded agent sessions yet.'}
        </EmptyHint>
      ) : null}
      <ExternalHistoryList
        groups={groups}
        groupingMode={groupingMode}
        sortMode={sortMode}
        agents={query.agents}
        collapsed={collapsed}
        opening={opening}
        toggle={toggle}
        open={(source) => {
          void open(source)
        }}
        hasMore={query.hasMore}
        loadingMore={query.loadingMore}
        loadMore={() => {
          void query.loadMore()
        }}
      />
    </section>
  )
}
