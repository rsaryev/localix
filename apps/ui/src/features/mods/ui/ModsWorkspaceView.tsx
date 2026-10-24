import type { ReactNode } from 'react'
import { Blocks, BookOpen, PanelRight } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { PanelHeader } from '@localixai/kit/panel-header'
import { StateNotice } from '@localixai/kit/state-notice'
import { ExternalAnchor } from '@/shared/ui/external-anchor'
import type { ModPaneRef, ModsOverview } from '@/shared/api/modsApi'
import { ModRows, PaneRows } from './ModsList'

/**
 * The Mods view as it reads: a compact list beside the pane on show — the panes mods opened, then
 * the installed mods — and, with no mod yet, what a mod is and where to get one.
 */

/** Where the guide explains mods: what Localix runs of them, and what it does not yet. */
export const MODS_GUIDE_URL = 'https://localix.ai/docs/extending--claude-code-plugins#mods'

export interface ModsWorkspaceViewProps {
  overview: ModsOverview
  selected: ModPaneRef | null
  onSelect: (pane: ModPaneRef) => void
  onOpenSettings: (plugin: string) => void
  onBrowsePlugins: () => void
  /** The drawing of the pane on show. */
  renderPane: (pane: ModPaneRef) => ReactNode
}

function GuideLink() {
  return (
    <Button asChild size="sm" variant="ghost">
      <ExternalAnchor href={MODS_GUIDE_URL}>
        <BookOpen />
        How mods work
      </ExternalAnchor>
    </Button>
  )
}

export function ModsWorkspaceView(props: ModsWorkspaceViewProps) {
  const { overview, selected } = props
  if (overview.mods.length === 0)
    return (
      <StateNotice
        icon={Blocks}
        title="No mods yet"
        body="A mod is a Claude Code plugin with a hooks module: it opens panes here, draws above the message box, and reacts to what the agent does. Install one from Plugins and turn it on."
        actions={
          <>
            <Button size="sm" variant="mono" onClick={props.onBrowsePlugins}>
              Browse plugins
            </Button>
            <GuideLink />
          </>
        }
      />
    )
  const running = overview.mods.filter((mod) => mod.status === 'running').length
  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border-soft @max-2xl:w-56">
        <PanelHeader
          tone="content"
          title="Mods"
          summary={<span className="text-2xs text-text-faint">{running} running</span>}
        />
        <nav aria-label="Mods" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-2">
          <PaneRows panes={overview.panes} selected={selected} onSelect={props.onSelect} />
          <ModRows mods={overview.mods} onOpenSettings={props.onOpenSettings} />
        </nav>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          props.renderPane(selected)
        ) : (
          <StateNotice
            icon={PanelRight}
            title="No pane open"
            body="A mod opens a pane when it has something to show — Replay Theater's diffs, Blast Radius holding a command. It appears here, and the mod can bring it forward."
            actions={<GuideLink />}
          />
        )}
      </section>
    </div>
  )
}
