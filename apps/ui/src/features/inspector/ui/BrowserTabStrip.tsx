import { useEffect } from 'react'
import { Clock3, Code, Globe2, Pin, Plus } from 'lucide-react'
import { hostLabel } from '@/shared/lib/url'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { toast } from '@/shared/lib/notify'
import { IconButton } from '@localixai/kit/icon-button'
import { TabStrip, type StripTabItem, type useTabPanelIds } from '@localixai/kit/tabs'
import { usePreviewStore, type PreviewEntry } from '../model/previewStore'
import { BROWSER_HISTORY_URL, browserEngine, hostsInFrame } from '../model/browserUrl'
import { closeNativePages } from '../model/nativePages'
import {
  browserTabTransferBus,
  useBrowserTabTransferState,
} from '@/shared/lib/browserTabTransferBus'

/** The strip item that stands for a new tab while it has no page yet. */
export const NEW_TAB_ID = 'browser:new-tab'

/**
 * A person-initiated close or reload whose native half failed used to be swallowed: the strip
 * dropped the tab while its page kept running (playing audio, holding a dev server's socket), or a
 * reload simply did nothing. The person asked, so a refusal is said — once, as their own failure.
 */
const reportNative = (failure: string) => (error: unknown) =>
  void toast.error(failure, { description: errorMessage(error, '') || undefined })

export function closeBrowserTabs(ids: string[]): void {
  const closable = ids.filter((id) => !browserTabTransferBus.pending(id))
  usePreviewStore.getState().closeBrowserTabs(closable)
  closeNativePages(
    closable,
    closable.length === 1 ? 'Could not close the page' : 'Could not close the pages',
  )
}

const unpinned = (entries: readonly PreviewEntry[]) => entries.filter((entry) => !entry.pinned)

/**
 * One action of the native tab menu, chosen by the person. The menu event is app-wide and every
 * mounted Browser hears it, so each acts only on a tab of its OWN chat's strip — "close the tabs
 * to the right" must never reach into another chat's Browser.
 */
function runTabMenuAction(sessionId: string, tabId: string, action: string): void {
  const store = usePreviewStore.getState()
  const tabs = store.previewTabsBySession[sessionId] ?? []
  const index = tabs.findIndex((tab) => tab.previewId === tabId)
  if (index < 0) return
  const tab = tabs[index]!
  switch (action) {
    case 'reload':
      if (browserEngine(tab) === 'native')
        void platformCapabilities()
          .desktop.invoker()?.('browser_reload', { tabId })
          .catch(reportNative('Could not reload the page'))
      else if (browserEngine(tab) === 'frame')
        store.updateBrowserTab(sessionId, tabId, { version: tab.version + 1 })
      break
    case 'pin':
      store.updateBrowserTab(sessionId, tabId, { pinned: !tab.pinned })
      break
    case 'close':
      closeBrowserTabs([tabId])
      break
    case 'close_right':
      closeBrowserTabs(unpinned(tabs.slice(index + 1)).map((entry) => entry.previewId))
      break
    case 'close_left':
      closeBrowserTabs(unpinned(tabs.slice(0, index)).map((entry) => entry.previewId))
      break
    case 'close_all':
      closeBrowserTabs(unpinned(tabs).map((entry) => entry.previewId))
      break
  }
}

/**
 * What kind of page a tab holds, at a glance: the history list, a dev preview (a framed local
 * server, the one with Visual Feedback), or any other web page. The kind of page, not the engine:
 * outside the desktop shell every page is framed, and a site is still a site there.
 */
function tabIcon(tab: PreviewEntry) {
  if (tab.pinned) return <Pin className="size-3" aria-label="Pinned" />
  if (tab.url === BROWSER_HISTORY_URL) return <Clock3 className="size-3" aria-hidden />
  if (hostsInFrame(tab) && browserEngine(tab) === 'frame')
    return <Code className="size-3" aria-label="Dev preview" />
  return <Globe2 className="size-3" aria-hidden />
}

/**
 * The browser's tab strip: every tab, plus the two actions that belong to the browser rather than
 * to a page — its history and a new tab. An open new tab shows as a tab of its own, so the strip
 * is never an empty row, and tabs reorder by dragging.
 */
export function BrowserTabStrip({
  sessionId,
  tabs,
  activeId,
  newTabOpen,
  tabIds,
  onSelect,
  onNewTab,
  onCloseNewTab,
  onOpenHistory,
}: {
  /** The chat whose Browser this strip is. */
  sessionId: string
  tabs: readonly PreviewEntry[]
  activeId: string | null
  newTabOpen: boolean
  tabIds: ReturnType<typeof useTabPanelIds>
  onSelect: (previewId: string) => void
  onNewTab: () => void
  /** Absent while the new tab is the only one — there is nothing to fall back to. */
  onCloseNewTab?: () => void
  onOpenHistory: () => void
}) {
  const transfer = useBrowserTabTransferState()
  useEffect(() => {
    const listen = platformCapabilities().desktop.listener()
    if (!listen) return
    let disposed = false
    let off: (() => void) | undefined
    void listen('browser:tab-menu', ({ payload }) => {
      const event = payload as { tabId?: string; action?: string }
      if (event.tabId && event.action) runTabMenuAction(sessionId, event.tabId, event.action)
    }).then((unlisten) => {
      if (disposed) unlisten()
      else off = unlisten
    })
    return () => {
      disposed = true
      off?.()
    }
  }, [sessionId])

  const items: StripTabItem[] = tabs.map((tab, index) => {
    const label = browserEngine(tab) === 'history' ? 'History' : tab.title || hostLabel(tab.url)
    return {
      id: tab.previewId,
      label,
      title: tab.url,
      closeLabel: `Close ${label}`,
      icon: tabIcon(tab),
      disabled: transfer.pending.has(tab.previewId),
      onClose: (id: string) => closeBrowserTabs([id]),
      onAuxClose: (id: string) => closeBrowserTabs([id]),
      onContextMenu: (_id: string, event: React.MouseEvent) => {
        event.preventDefault()
        void platformCapabilities()
          .desktop.invoker()?.('browser_tab_menu', {
            tabId: tab.previewId,
            state: {
              pinned: !!tab.pinned,
              canCloseLeft: !!unpinned(tabs.slice(0, index)).length,
              canCloseRight: !!unpinned(tabs.slice(index + 1)).length,
              canCloseAll: !!unpinned(tabs).length,
            },
          })
          .catch((error: unknown) =>
            toast.error('Could not open the browser tab menu', {
              description: errorMessage(error, '') || undefined,
            }),
          )
      },
      ...tabIds.item(tab.previewId),
    }
  })
  if (newTabOpen) {
    items.push({
      id: NEW_TAB_ID,
      label: 'New tab',
      title: 'New tab',
      closeLabel: 'Close new tab',
      icon: <Plus className="size-3" aria-hidden />,
      onClose: onCloseNewTab ? () => onCloseNewTab() : undefined,
      onAuxClose: onCloseNewTab ? () => onCloseNewTab() : undefined,
      onContextMenu: (_id: string, event: React.MouseEvent) => event.preventDefault(),
      ...tabIds.item(NEW_TAB_ID),
    })
  }

  return (
    <TabStrip
      items={items}
      activeId={newTabOpen ? NEW_TAB_ID : activeId}
      onChange={(id) => {
        if (id !== NEW_TAB_ID) onSelect(id)
      }}
      onReorder={(fromId, toId) => {
        if (fromId === NEW_TAB_ID || toId === NEW_TAB_ID) return
        usePreviewStore.getState().moveBrowserTab(sessionId, fromId, toId)
      }}
      onDragStateChange={(dragging, id) => {
        if (dragging && id !== NEW_TAB_ID && tabs.some((tab) => tab.previewId === id && tab.url))
          browserTabTransferBus.start({ sessionId, pageId: id! })
        else browserTabTransferBus.end()
      }}
      onItemDragEnd={(id, event, cancelled) => {
        if (id !== NEW_TAB_ID && tabs.some((tab) => tab.previewId === id && tab.url))
          void browserTabTransferBus.finishOutside({ sessionId, pageId: id }, event, cancelled)
      }}
      variant="compact"
      aria-label="Browser tabs"
      edgeFade
      className="h-[var(--chrome-control-lg)]"
      tabClassName="max-w-44"
      actions={
        <div className="flex items-center gap-0.5">
          <IconButton
            size="sm"
            aria-label="Open browser history"
            tooltip="History"
            onClick={onOpenHistory}
          >
            <Clock3 className="size-3.5" />
          </IconButton>
          <IconButton size="sm" aria-label="New browser tab" tooltip="New tab" onClick={onNewTab}>
            <Plus className="size-3.5" />
          </IconButton>
        </div>
      }
    />
  )
}
