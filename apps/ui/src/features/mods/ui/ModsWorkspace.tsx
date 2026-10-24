import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { X } from 'lucide-react'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { IconButton } from '@localixai/kit/icon-button'
import { PanelHeader } from '@localixai/kit/panel-header'
import { runMiniAppAction } from '@localixai/mini-app-sdk/ui'
import { settingsUiUri } from '@localixai/mini-app-sdk/navigation'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { pluginSettingsUri } from '@/shared/lib/settingsAnchors'
import { navigateUi } from '@/shared/lib/uiNavigation'
import { modsApi, type ModPaneRef } from '@/shared/api/modsApi'
import { paneFocus } from '../model/paneFocus'
import { useModPane, useModsOverview } from '../model/useMods'
import { ModClientScope, type ModClientScopeValue } from './ModClient'
import { projectOf } from './ModsList'
import { ModsWorkspaceView } from './ModsWorkspaceView'
import { ModTree } from './ModTree'
import { hotkeysOf, pressHotkey } from './siteHotkeys'

/** Panes are drawn for this many text columns: what a mod reads as `e.props.bodyColumns`. */
const PANE_COLUMNS = 100

/**
 * The Mods view: the panes mods opened (`$.ui.open`), the installed mods, and the pane on show.
 * A pane a mod asks forward (`$.ui.open({ focus })`) is the one shown; a pane updates whenever its
 * mod asks for a redraw.
 */
export function ModsWorkspace() {
  const overview = useModsOverview()
  const navigation = useUiNavigation({ sessionId: null })
  const [chosen, setChosen] = useState<{ instance: string; id: string } | null>(null)
  const requested = useSyncExternalStore(
    (listener) => paneFocus.subscribe(listener),
    () => paneFocus.requested(),
  )
  useEffect(() => {
    if (requested) setChosen({ instance: requested.instance, id: requested.id })
  }, [requested])
  if (!overview.data) return <LoadingHint>Loading mods…</LoadingHint>
  const panes = overview.data.panes
  const selected =
    panes.find((pane) => pane.instance === chosen?.instance && pane.id === chosen?.id) ??
    panes[0] ??
    null
  return (
    <ModsWorkspaceView
      overview={overview.data}
      selected={selected}
      onSelect={setChosen}
      onOpenSettings={(plugin) => navigateUi(pluginSettingsUri(plugin), navigation)}
      onBrowsePlugins={() => navigateUi(settingsUiUri('plugins'), navigation)}
      renderPane={(pane) => <ModPane key={`${pane.instance}/${pane.id}`} pane={pane} />}
    />
  )
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
  const close = () =>
    runMiniAppAction(() => modsApi.close(pane.instance, pane.id), 'The pane did not close')
  const tree = drawing.data?.tree
  const hotkeys = useMemo(() => hotkeysOf(tree ?? []), [tree])
  // Asked forward, the pane takes the keyboard: where its `autoFocus` control is, else itself.
  const body = useRef<HTMLDivElement>(null)
  const drawn = Boolean(tree)
  useEffect(() => {
    if (!drawn || pane.focusRequest === 0) return
    const node = body.current
    ;(node?.querySelector<HTMLElement>('[data-autofocus]') ?? node)?.focus()
  }, [pane.focusRequest, drawn])
  return (
    <>
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
          <IconButton size="sm" aria-label="Close pane" onClick={close}>
            <X />
          </IconButton>
        }
      />
      <div
        ref={body}
        role="region"
        aria-label={pane.title ?? pane.id}
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm outline-none @2xl:px-6"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && pane.closeOnEscape) {
            event.preventDefault()
            close()
            return
          }
          // While the pane holds the keyboard its Buttons' hotkeys press them.
          pressHotkey(event, hotkeys, act)
        }}
      >
        {!drawing.data ? (
          <LoadingHint>Drawing…</LoadingHint>
        ) : drawing.data.tree ? (
          <div className="flex flex-col gap-2">
            <ModClientScope.Provider value={scope}>
              <ModTree nodes={drawing.data.tree} act={act} />
            </ModClientScope.Provider>
          </div>
        ) : (
          <EmptyHint>{drawing.data.problem ?? 'The mod draws nothing in this pane.'}</EmptyHint>
        )}
      </div>
    </>
  )
}
