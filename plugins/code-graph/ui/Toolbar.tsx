import { useEffect, useRef } from 'react'
import { ArrowLeft, ArrowRight, ListFilter, PanelRight } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
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
  const search = useSearchShortcut()
  useNavigationShortcut(graph)
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

/** Browser-style history keys only while focus belongs to this workbench. */
function useNavigationShortcut(graph: GraphState) {
  const { back, forward, canBack, canForward } = graph
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (!target?.closest('[data-code-graph-root]')) return
      const backward =
        (event.altKey && event.key === 'ArrowLeft') || (event.metaKey && event.key === '[')
      const onward =
        (event.altKey && event.key === 'ArrowRight') || (event.metaKey && event.key === ']')
      if (!backward && !onward) return
      event.preventDefault()
      event.stopPropagation()
      if (backward && canBack) back()
      else if (onward && canForward) forward()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [back, forward, canBack, canForward])
}

/** `/` focuses the search from anywhere in the tab, unless the person is already typing. */
function useSearchShortcut() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      const scope = ref.current?.closest('[data-code-graph-root]')
      if (!scope || !target || !scope.contains(target)) return
      event.preventDefault()
      ref.current?.querySelector('input')?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return ref
}
