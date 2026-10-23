import { lazy, Suspense, useState } from 'react'
import { useTabPanelIds } from '@localixai/kit/tabs'
import { LoadingHint } from '@localixai/kit/empty-hint'
import {
  WorkItemVisibilityProvider,
  useWorkItemVisible,
} from '@localixai/mini-app-sdk/ui/visibility'
import { DataSourceTabs, type DataSource } from '@/shared/ui/DataSourceTabs'

const LocalixStats = lazy(() =>
  import('@/features/stats/ui/LocalixStatsPanel').then((module) => ({
    default: module.LocalixStatsPanel,
  })),
)
const AgentStats = lazy(() => import('@/features/external-agents/ui/ExternalStatsPanel'))

export function StatsPanel({ onOpenSession }: { onOpenSession?: (sessionId: string) => void }) {
  const [source, setSource] = useState<DataSource>('localix')
  const [visitedAgents, setVisitedAgents] = useState(false)
  const ids = useTabPanelIds('usage-source')
  const visible = useWorkItemVisible()
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <DataSourceTabs
        value={source}
        ids={ids}
        label="Statistics source"
        onChange={(next) => {
          setSource(next)
          if (next === 'external') setVisitedAgents(true)
        }}
      />
      <div
        role="tabpanel"
        id={ids.panelId('localix')}
        aria-labelledby={ids.tabId('localix')}
        hidden={source !== 'localix'}
        className={source === 'localix' ? 'min-h-0 flex-1' : 'hidden'}
      >
        <WorkItemVisibilityProvider visible={visible && source === 'localix'}>
          <Suspense fallback={<LoadingHint>Reading usage…</LoadingHint>}>
            <LocalixStats onOpenSession={onOpenSession} />
          </Suspense>
        </WorkItemVisibilityProvider>
      </div>
      <div
        role="tabpanel"
        id={ids.panelId('external')}
        aria-labelledby={ids.tabId('external')}
        hidden={source !== 'external'}
        className={source === 'external' ? 'min-h-0 flex-1' : 'hidden'}
      >
        {visitedAgents && (
          <WorkItemVisibilityProvider visible={visible && source === 'external'}>
            <Suspense fallback={<LoadingHint>Reading agent usage…</LoadingHint>}>
              <AgentStats />
            </Suspense>
          </WorkItemVisibilityProvider>
        )}
      </div>
    </div>
  )
}
