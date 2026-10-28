import { useEffect, useMemo, useRef, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { IconButton } from '@localixai/kit/icon-button'
import { PanelHeader } from '@localixai/kit/panel-header'
import { runMiniAppAction } from '@localixai/mini-app-sdk/ui'
import { useGridStore } from '@/entities/workspace-grid/model'
import { modsApi, type ModPaneRef } from '@/shared/api/modsApi'
import { modPaneTabPayload, openPluginPage } from '../model/paneTabs'
import { closeModPane, useModPane, useModsOverview } from '../model/useMods'
import { ModClientScope, type ModClientScopeValue } from './ModClient'
import { ModActionBarContext, ModControlContext, ModSiteContext } from './modSite'
import { ModTree } from './ModTree'
import { paneLayout } from './paneLayout'
import { hotkeysOf, pressHotkey } from './siteHotkeys'

/** Panes are drawn for this many text columns: what a mod reads as `e.props.bodyColumns`. */
const PANE_COLUMNS = 100

/** The last folder of a project path: which project a pane belongs to, at a glance. */
export const projectOf = (cwd: string | null) =>
  cwd
    ?.split(/[\\/]/)
    .reverse()
    .find((part) => part !== '') ?? ''

/**
 * One mod pane as a workspace tab (`mod-pane`): its drawing at workbench density, redrawn whenever
 * its mod asks, laid out as a pane of the app's (`paneLayout.ts`): the tab is its frame and title,
 * its last row of buttons the action bar under the body. Asked forward, the pane takes the keyboard — where its `autoFocus` control is, else
 * itself — and its Buttons' hotkeys press them while it holds it; Escape closes a pane opened with
 * `closeOnEscape`, as the person's close does.
 */
export function ModPaneBody({
  item,
}: {
  item: { id: string; title: string; payload?: Record<string, unknown> }
}) {
  const ref = modPaneTabPayload(item.payload)
  const overview = useModsOverview()
  const pane = overview.data?.panes.find(
    (open) => open.instance === ref?.instance && open.id === ref?.paneId,
  )
  // The tab is named by the pane's own title, which the mod may change while it is open.
  const title = pane ? (pane.title ?? pane.id) : null
  useEffect(() => {
    if (title && title !== item.title) useGridStore.getState().setTabTitle(item.id, title)
  }, [title, item.id, item.title])
  if (!overview.data) return <LoadingHint>Opening the pane…</LoadingHint>
  if (!pane) return <EmptyHint>This pane is closed.</EmptyHint>
  return <ModPane key={`${pane.instance}/${pane.id}`} pane={pane} />
}

function ModPane({ pane }: { pane: ModPaneRef }) {
  const [generation, setGeneration] = useState(0)
  const drawing = useModPane(pane, PANE_COLUMNS, () => setGeneration((count) => count + 1))
  const scope = useMemo<ModClientScopeValue>(
    () => ({
      instance: pane.instance,
      pane: pane.id,
      plugin: pane.plugin,
      generation,
      transport: modsApi,
    }),
    [pane.instance, pane.id, pane.plugin, generation],
  )
  const act = (action: Parameters<typeof modsApi.act>[2]) =>
    runMiniAppAction(() => modsApi.act(pane.instance, pane.id, action), 'The mod did not take that')
  const tree = drawing.data?.tree
  const hotkeys = useMemo(() => hotkeysOf(tree ?? []), [tree])
  const name = pane.title ?? pane.id
  const layout = useMemo(() => (tree ? paneLayout(tree, name) : null), [tree, name])
  const body = useRef<HTMLDivElement>(null)
  const drawn = Boolean(tree)
  useEffect(() => {
    if (!drawn || pane.focusRequest === 0) return
    const node = body.current
    ;(node?.querySelector<HTMLElement>('[data-autofocus]') ?? node)?.focus()
  }, [pane.focusRequest, drawn])
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        tone="content"
        title={
          <span className="truncate text-xs font-medium text-foreground">
            {pane.title ?? pane.id}
          </span>
        }
        summary={
          <span className="truncate text-2xs text-text-faint" title={pane.cwd ?? undefined}>
            {[pane.plugin, projectOf(pane.cwd)].filter(Boolean).join(' · ')}
          </span>
        }
        actions={
          <IconButton
            size="sm"
            aria-label={`${pane.plugin} settings`}
            tooltip="Open the plugin in the Store"
            onClick={() => openPluginPage(pane.plugin)}
          >
            <Settings2 />
          </IconButton>
        }
      />
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- delegated keys: Escape and the hotkeys come from the focused Buttons inside; the region only holds the focus scope */}
      <div
        ref={body}
        role="region"
        aria-label={pane.title ?? pane.id}
        tabIndex={-1}
        // The workbench pane's gutters (`visual-system.md`), on the pane's own ground.
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm outline-none @2xl:px-6"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && pane.closeOnEscape) {
            event.preventDefault()
            void closeModPane(pane)
            return
          }
          // While the pane holds the keyboard its Buttons' hotkeys press them.
          pressHotkey(event, hotkeys, act)
        }}
      >
        {!drawing.data ? (
          <LoadingHint>Drawing…</LoadingHint>
        ) : layout ? (
          <ModSiteContext.Provider value="pane">
            <ModClientScope.Provider value={scope}>
              <div className="flex flex-col gap-2">
                <ModTree nodes={layout.nodes} act={act} />
              </div>
              {layout.actions && (
                <div
                  role="group"
                  aria-label={`${name} actions`}
                  className="mt-4 flex flex-wrap items-center gap-2 text-xs text-text-soft"
                >
                  {/* The bar is chrome: its hint is in the UI's type, as its buttons are. */}
                  <ModActionBarContext.Provider value={true}>
                    <ModControlContext.Provider value={true}>
                      <ModTree nodes={layout.actions} act={act} />
                    </ModControlContext.Provider>
                  </ModActionBarContext.Provider>
                </div>
              )}
            </ModClientScope.Provider>
          </ModSiteContext.Provider>
        ) : (
          <EmptyHint>{drawing.data.problem ?? 'The mod draws nothing in this pane.'}</EmptyHint>
        )}
      </div>
    </div>
  )
}
