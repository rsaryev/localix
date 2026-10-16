import { useEffect, useState } from 'react'
import { hostLabel } from '@/shared/lib/url'
import { snippetMessageBindingDraft } from '@localixai/plugin-sdk/ui'
import { TOOL } from '@localixai/api/tool-names'
import { publishLiveTabMessageContext } from '@/features/workspace-grid/model/liveTabMessageContext'
import { TabPanel, useTabPanelIds } from '@localixai/kit/tabs'
import { tabIdInScope } from '@/features/workspace-grid/model'
import { usePreviewStore, type PreviewEntry } from '../model/previewStore'
import { useBrowserHistory } from '../model/browserHistory'
import { addressDestination, browserEngine, isLocalBrowserUrl } from '../model/browserUrl'
import { openPreviewFromClick } from '../model/openPreview'
import { BrowserHistoryTab } from './BrowserHistoryTab'
import { BrowserNewTab } from './BrowserNewTab'
import { BrowserTabStrip, NEW_TAB_ID } from './BrowserTabStrip'
import { NativeBrowserTab } from './NativeBrowserTab'
import { PreviewTab } from './PreviewTab'

const EMPTY: PreviewEntry[] = []

/** The Browser work item: its tab strip over the selected tab's page, in that page's engine. */
export function BrowserWorkspace({
  sessionId,
  active: bodyActive = true,
}: {
  sessionId: string
  active?: boolean
}) {
  // This chat's strip only: another chat's pages belong to that chat's Browser.
  const tabs = usePreviewStore((s) => s.previewTabsBySession[sessionId]) ?? EMPTY
  const active = usePreviewStore((s) => s.previewBySession[sessionId])
  const setActivePreview = usePreviewStore((s) => s.setActivePreview)
  const openBrowserTab = usePreviewStore((s) => s.openBrowserTab)
  const openBrowserHistory = usePreviewStore((s) => s.openBrowserHistory)
  const visits = useBrowserHistory((s) => s.visits)
  // The grid id of THIS chat's Browser tab — the key its live context is read back under.
  const itemId = tabIdInScope('preview', 'preview', sessionId)
  const tabIds = useTabPanelIds('browser')
  const [newTab, setNewTab] = useState(false)

  // Where an address gets a new tab: a local one as a dev preview, resolved by the server so its
  // probe and dev-server recovery come with it; any other as a native browser page. The new-tab
  // page, the history list and every tab's address bar (for an address its engine does not
  // serve) all open through here.
  const open = (url: string) => {
    if (isLocalBrowserUrl(url)) {
      openPreviewFromClick(sessionId, url)
    } else {
      openBrowserTab(sessionId, url)
    }
    setNewTab(false)
  }
  const openHistory = () => {
    openBrowserHistory(sessionId)
    setNewTab(false)
  }

  const current =
    active && tabs.some((tab) => tab.previewId === active.previewId)
      ? active
      : tabs[tabs.length - 1]
  useEffect(() => {
    const roster = tabs.slice(0, 20).map((tab) => ({
      tab_id: tab.previewId,
      url: tab.url,
      title: tab.title ?? hostLabel(tab.url),
      active: tab.previewId === current?.previewId,
    }))
    publishLiveTabMessageContext(itemId, {
      strategy: 'replace',
      bindings: [
        snippetMessageBindingDraft({
          label: 'Browser tabs',
          language: 'json',
          content: JSON.stringify({
            active_tab_id: current?.previewId ?? null,
            tabs: roster,
            history: {
              total: visits.length,
              recent: visits.slice(0, 5).map(({ url, title }) => ({ url, title })),
              tool: `${TOOL.browser} action=history`,
            },
          }),
        }),
      ],
    })
    return () => publishLiveTabMessageContext(itemId, null)
  }, [itemId, tabs, current?.previewId, visits])

  const pageActive = bodyActive && !newTab
  const engine = current ? browserEngine(current) : null
  const page =
    current &&
    (engine === 'history' ? (
      <BrowserHistoryTab onOpen={open} />
    ) : engine === 'native' ? (
      <NativeBrowserTab
        key={current.previewId}
        sessionId={sessionId}
        tab={current}
        active={pageActive}
        onOpenElsewhere={open}
      />
    ) : (
      <PreviewTab
        key={`${current.previewId}:${current.version}`}
        previewId={current.previewId}
        viewport={current.viewport}
        active={pageActive}
        url={current.url}
        version={current.version}
        sessionId={sessionId}
        servedFile={current.servedFile}
        rootDir={current.rootDir}
        frameBlocked={current.frameBlocked}
        onNavigate={(next) => {
          if (addressDestination(current, next) === 'here') openPreviewFromClick(sessionId, next)
          else open(next)
        }}
      />
    ))

  const newTabOpen = newTab || !current
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <BrowserTabStrip
        sessionId={sessionId}
        tabs={tabs}
        activeId={current?.previewId ?? null}
        newTabOpen={newTabOpen}
        tabIds={tabIds}
        onSelect={(previewId) => {
          setNewTab(false)
          setActivePreview(sessionId, previewId)
        }}
        onNewTab={() => setNewTab(true)}
        onCloseNewTab={current ? () => setNewTab(false) : undefined}
        onOpenHistory={openHistory}
      />
      {newTabOpen ? (
        <TabPanel
          id={tabIds.panelId(NEW_TAB_ID)}
          aria-labelledby={tabIds.tabId(NEW_TAB_ID)}
          active
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          <BrowserNewTab onOpen={open} onOpenHistory={openHistory} />
        </TabPanel>
      ) : (
        <TabPanel
          id={tabIds.panelId(current.previewId)}
          data-browser-page-id={current.previewId}
          aria-labelledby={tabIds.tabId(current.previewId)}
          active
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          {page}
        </TabPanel>
      )}
    </div>
  )
}
