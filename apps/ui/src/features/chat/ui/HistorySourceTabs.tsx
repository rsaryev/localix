import type { ReactNode } from 'react'
import { TabBar, TabPanel, useTabPanelIds } from '@localixai/kit/tabs'
import type { useExternalHistory } from '@/features/external-agents/model/useExternalHistory'
import type { HistorySource } from './useHistorySource'

/**
 * Localix / External tabs over the one history list.
 *
 * Both tabs control the same panel: the list, search and view menu are shared, only the rows
 * change. Without the External tab there is nothing to switch, so the panel renders bare.
 */
export function HistorySourceTabs({
  source,
  onChange,
  externalAvailable,
  children,
}: {
  source: HistorySource
  onChange: (source: HistorySource) => void
  externalAvailable: boolean
  children: ReactNode
}) {
  const ids = useTabPanelIds('chat-history')
  if (!externalAvailable) return <>{children}</>
  const panelId = ids.panelId('history')
  return (
    <>
      <TabBar
        aria-label="History source"
        stretch
        active={source}
        onChange={onChange}
        items={[
          { id: 'localix', label: 'Localix', tabId: ids.tabId('localix'), panelId },
          { id: 'external', label: 'External', tabId: ids.tabId('external'), panelId },
        ]}
      />
      <TabPanel
        id={panelId}
        aria-labelledby={ids.tabId(source)}
        active
        className="flex flex-1 flex-col"
      >
        {children}
      </TabPanel>
    </>
  )
}

/** The External tab's blank state: says what will appear here, not that something failed. */
export function ExternalHistoryEmpty({
  history,
  search,
}: {
  history: ReturnType<typeof useExternalHistory>
  search: boolean
}) {
  if (history.loading || history.error) return null
  const hasAgents = history.agents.length > 0
  return (
    <div className="flex min-h-0 flex-1 select-none items-center justify-center px-4 text-center text-xs text-sidebar-foreground/40">
      {search
        ? 'No matching agent sessions in this workspace.'
        : hasAgents
          ? 'Sessions recorded by coding-agent CLIs in this project appear here.'
          : 'History from installed coding-agent CLIs, such as Claude Code or Codex, appears here.'}
    </div>
  )
}
