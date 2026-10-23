import { useId, useRef } from 'react'
import { useFocusEntry } from '@localixai/mini-app-sdk/ui/focus'
import { matchesChord } from '@localixai/kit/keybindings'
import { ArrowLeft, ArrowRight, ListFilter, PanelRight } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { IconButton } from '@localixai/kit/icon-button'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { RefreshAction } from '@localixai/kit/refresh-action'
import { SearchInput } from '@localixai/kit/search-input'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import { EDGE_KINDS } from '../shared/model'
import type { GraphSnapshot, NodeSummaryView } from '../shared/view'
import { Breadcrumbs, type LevelCrumb } from './Breadcrumbs'
import { EDGE_LABEL } from './kinds'
import { SearchResults } from './SearchResults'
import type { GraphState } from './useGraph'

/**
 * One row: where you are (each step of the breadcrumb goes back up), finding something, what is
 * drawn, and whether the side panel is open. Everything else lives in the inspector or the status
 * line, so the map keeps the space.
 */
export function Toolbar({
  graph,
  snapshot,
  inspectorOpen,
  onToggleInspector,
  crumbs,
  onLeaveTo,
  onPick,
}: {
  graph: GraphState
  snapshot: GraphSnapshot
  inspectorOpen: boolean
  onToggleInspector: () => void
  /** The level's path, then the functions open in the call lens. */
  crumbs: readonly LevelCrumb[]
  onLeaveTo: (crumb: LevelCrumb) => void
  onPick: (node: NodeSummaryView) => void
}) {
  const filtered = graph.kinds.size < EDGE_KINDS.length || graph.external
  const search = useGraphShortcuts(graph)
  const indexing = snapshot.status.state === 'indexing'
  return (
    <WorkbenchToolbar wrap aria-label="Code graph" className="gap-2">
      <div
        role="group"
        aria-label="Navigation history"
        className="flex shrink-0 items-center border-r border-border-soft pr-1"
      >
        <IconButton
          aria-label="Go back in Code Graph"
          tooltip="Back  Alt+←"
          size="sm"
          disabled={!graph.canBack}
          onClick={graph.back}
        >
          <ArrowLeft className="size-3.5" />
        </IconButton>
        <IconButton
          aria-label="Go forward in Code Graph"
          tooltip="Forward  Alt+→"
          size="sm"
          disabled={!graph.canForward}
          onClick={graph.forward}
        >
          <ArrowRight className="size-3.5" />
        </IconButton>
      </div>
      <Breadcrumbs crumbs={crumbs} onPick={onLeaveTo} />
      <WorkbenchToolbarSection
        align="end"
        spacing="compact"
        className="@max-md:w-full @max-md:justify-end"
      >
        <div ref={search} className="relative mr-1 w-36 @lg:w-56">
          <SearchInput
            value={graph.query}
            onValueChange={graph.setQuery}
            placeholder="Find…  /"
            aria-label="Search the code graph"
          />
          <SearchResults query={graph.query} results={snapshot.search} onPick={onPick} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="What the map draws"
              className={cn(filtered && 'text-status-info')}
            >
              <ListFilter className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {/* Independent on/off toggles, so `checked` rows that keep the menu open. */}
            <MenuEntries
              family="dropdown"
              entries={[
                { header: 'Draw edges' },
                ...EDGE_KINDS.map((kind) => ({
                  id: `kind:${kind}`,
                  label: EDGE_LABEL[kind].filter,
                  checked: graph.kinds.has(kind),
                  keepOpen: true,
                  onSelect: () => graph.toggleKind(kind),
                })),
                { separator: true },
                {
                  id: 'external',
                  label: 'Dependencies outside the project',
                  checked: graph.external,
                  keepOpen: true,
                  onSelect: () => graph.setExternal(!graph.external),
                },
              ]}
            />
          </DropdownMenuContent>
        </DropdownMenu>
        <RefreshAction
          aria-label="Re-index the project"
          tooltip={indexing ? 'Indexing…' : 'Re-index the project'}
          size="sm"
          disabled={indexing || graph.sending}
          busy={indexing}
          onClick={graph.reindex}
        />
        <IconButton
          aria-label={inspectorOpen ? 'Hide the inspector' : 'Show the inspector'}
          tooltip={inspectorOpen ? 'Hide the inspector' : 'Show the inspector'}
          size="sm"
          aria-pressed={inspectorOpen}
          onClick={onToggleInspector}
        >
          <PanelRight className="size-3.5" />
        </IconButton>
      </WorkbenchToolbarSection>
    </WorkbenchToolbar>
  )
}

/** Local navigation wins over workspace history; editing fields keep their own keys. */
function useGraphShortcuts(graph: GraphState) {
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  useFocusEntry({
    id: `code-graph:${id}`,
    kind: 'surface',
    scope: () => ref.current?.closest('[data-code-graph-root]') ?? null,
    onKeyDown: (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (
        target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
      )
        return
      const backward = matchesChord(event, 'alt+arrowleft') || matchesChord(event, 'mod+[')
      const onward = matchesChord(event, 'alt+arrowright') || matchesChord(event, 'mod+]')
      if (backward || onward) {
        event.preventDefault()
        if (backward && graph.canBack) graph.back()
        else if (onward && graph.canForward) graph.forward()
        return true
      }
      if (!matchesChord(event, '/')) return
      event.preventDefault()
      ref.current?.querySelector('input')?.focus()
      return true
    },
  })
  return ref
}
