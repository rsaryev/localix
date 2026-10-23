import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { IconButton } from '@localixai/kit/icon-button'
import { SectionLabel } from '@localixai/kit/section-label'
import { MENU_ROW, SELECTED_ROW } from '@localixai/kit/selected-row'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { runMiniAppAction } from '@localixai/mini-app-sdk/ui'
import { modsApi, type ModPaneRef } from '@/shared/api/modsApi'
import { useModPane, useModsOverview } from '../model/useMods'
import { ModClientScope, type ModClientScopeValue } from './ModClient'
import { ModTree } from './ModTree'

/** Panes are drawn for this many text columns: what a mod reads as `e.props.bodyColumns`. */
const PANE_COLUMNS = 100

/** The last folder of a project path: which project a pane belongs to, at a glance. */
const projectOf = (cwd: string | null) =>
  cwd
    ?.split(/[\\/]/)
    .reverse()
    .find((part) => part !== '') ?? ''

/**
 * The mods loaded here and the panes they opened (`$.ui.open`), one drawn at a time beside the
 * list. A mod runs once per project, so a pane names its project. A mod that failed to load says
 * why; a pane updates whenever its mod asks for a redraw.
 */
export function ModsWorkspace() {
  const overview = useModsOverview()
  const [chosen, setChosen] = useState<{ instance: string; id: string } | null>(null)
  const panes = overview.data?.panes ?? []
  const selected =
    panes.find((pane) => pane.instance === chosen?.instance && pane.id === chosen?.id) ??
    panes[0] ??
    null
  if (!overview.data) return <LoadingHint>Loading mods…</LoadingHint>
  const failures = Object.entries(overview.data.failures)
  if (overview.data.mods.length === 0 && failures.length === 0)
    return (
      <EmptyHint>
        No mod is loaded. A mod is a Claude Code plugin whose hooks/hooks.json names a hooks module;
        install one and turn it on in Settings → Plugins.
      </EmptyHint>
    )
  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-2">
        <SectionLabel className="px-2.5 py-1">Panes</SectionLabel>
        {panes.length === 0 && <p className="px-2.5 text-xs text-text-soft">None open</p>}
        {panes.map((pane) => (
          <button
            key={`${pane.instance}/${pane.id}`}
            type="button"
            className={cn(MENU_ROW, selected === pane && SELECTED_ROW)}
            onClick={() => setChosen(pane)}
          >
            <span className="truncate">{pane.title ?? pane.id}</span>
            <span
              className="ml-auto truncate text-2xs text-text-faint"
              title={pane.cwd ?? undefined}
            >
              {projectOf(pane.cwd) || pane.plugin}
            </span>
          </button>
        ))}
        <SectionLabel className="mt-3 px-2.5 py-1">Mods</SectionLabel>
        {overview.data.mods.map((mod) => (
          <p key={mod} className="truncate px-2.5 text-xs">
            {mod}
          </p>
        ))}
        {failures.map(([mod, reason]) => (
          <p key={mod} className="px-2.5 text-xs text-destructive" title={reason}>
            {mod} did not load: {reason}
          </p>
        ))}
      </nav>
      <section className="min-w-0 flex-1 overflow-y-auto">
        {selected ? <ModPane pane={selected} /> : <EmptyHint>No mod has opened a pane.</EmptyHint>}
      </section>
    </div>
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
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <header className="flex items-center gap-2">
        <h2 className="truncate text-sm font-medium">{pane.title ?? pane.id}</h2>
        <span className="truncate text-2xs text-text-faint" title={pane.cwd ?? undefined}>
          {[pane.plugin, projectOf(pane.cwd)].filter(Boolean).join(' · ')}
        </span>
        <IconButton
          className="ml-auto"
          aria-label="Close pane"
          onClick={() =>
            runMiniAppAction(() => modsApi.close(pane.instance, pane.id), 'The pane did not close')
          }
        >
          <X />
        </IconButton>
      </header>
      {!drawing.data ? (
        <LoadingHint>Drawing…</LoadingHint>
      ) : drawing.data.tree ? (
        <div className="flex flex-col gap-2 text-sm">
          <ModClientScope.Provider value={scope}>
            <ModTree nodes={drawing.data.tree} act={act} />
          </ModClientScope.Provider>
        </div>
      ) : (
        <EmptyHint>{drawing.data.problem ?? 'The mod draws nothing in this pane.'}</EmptyHint>
      )}
    </div>
  )
}
