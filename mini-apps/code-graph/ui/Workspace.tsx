import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react'
import { MessageSquareOff, Network, Sparkles } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { Button } from '@localixai/kit/button'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { StateNotice } from '@localixai/kit/state-notice'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'
import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'
import { fileId } from '../shared/ids'
import { LENS_KINDS, type CodeCard } from '../shared/lens'
import type { NodeSummaryView, ViewNode } from '../shared/view'
import type { LevelCrumb } from './Breadcrumbs'
import { graphMessageContext } from './bindings'
import { GraphCanvas } from './canvas/GraphCanvas'
import { FirstBuild } from './FirstBuild'
import { Inspector } from './inspector/Inspector'
import { LensCanvas } from './lens/LensCanvas'
import { levelFor } from './model/navigation'
import { StatusLine } from './StatusLine'
import { Toolbar } from './Toolbar'
import { useGraph } from './useGraph'
import { usePaneWidth } from './usePaneWidth'

/**
 * The map of this chat's project: one row of navigation, the level on the canvas, the inspector
 * at the side, the quiet facts underneath. Publishes exactly what is on screen as the agent's
 * context and clears it the moment the tab is not the one being looked at.
 */
const INSPECTOR_KEY = 'code-graph:inspector-open'
/** Below this the inspector floats over the map instead of taking a column from it. */
const SIDE_BY_SIDE_PX = 760

function readInspectorOpen(): boolean {
  try {
    // Closed until asked for: the map is the point of the tab, and the inspector is one click
    // (or a selection on a narrow pane) away.
    return localStorage.getItem(INSPECTOR_KEY) === '1'
  } catch {
    return false
  }
}

export function Workspace({
  active = true,
  publishMessageContext,
}: {
  active?: boolean
  publishMessageContext?: PublishMessageContext
}) {
  const graph = useGraph(active)
  const { snapshot } = graph
  const [paneRef, wide] = usePaneWidth<HTMLDivElement>(SIDE_BY_SIDE_PX)
  const [inspectorOpen, setInspectorOpen] = useState(readInspectorOpen)

  useEffect(() => {
    if (!active || !snapshot) {
      publishMessageContext?.(null)
      return
    }
    publishMessageContext?.(graphMessageContext(snapshot))
    return () => publishMessageContext?.(null)
  }, [active, snapshot, publishMessageContext])

  const toggleInspector = useCallback(() => {
    setInspectorOpen((open) => {
      try {
        localStorage.setItem(INSPECTOR_KEY, open ? '0' : '1')
      } catch {
        // The choice is remembered for this view only.
      }
      return !open
    })
  }, [])

  /**
   * Go to a node: containers open their own level, declarations open in the call lens. A search
   * hit can be absent from a crowded parent level's preview, so navigating through that parent
   * would leave the requested node off screen.
   */
  const jump = useCallback(
    (node: Pick<NodeSummaryView, 'id' | 'kind' | 'path' | 'parent'>) => {
      graph.setQuery('')
      if (LENS_KINDS.has(node.kind)) return graph.openLens(fileId(node.path), node.id)
      if (node.kind === 'directory' || node.kind === 'file') graph.open(node.id)
      else {
        const level = levelFor(node)
        if (level) graph.leaveTo(level, node.id)
        else graph.setSelected(node.id)
      }
      if (!wide) setInspectorOpen(true)
    },
    [graph, wide],
  )

  const activate = useCallback(
    (node: ViewNode) => {
      // A portal goes where it lives; a function opens its code; anything else is selected here.
      if ((node.role === 'portal' && node.kind !== 'package') || LENS_KINDS.has(node.kind)) {
        return jump(node)
      }
      graph.setSelected(node.id === graph.selected ? null : node.id)
    },
    [graph, jump],
  )

  const lensTrail = snapshot?.lens?.trail
  /** The level's path, then — in the lens — the chain of functions followed. */
  const scopePath = snapshot?.view?.scope.path
  const crumbs = useMemo<LevelCrumb[]>(
    () => [
      ...(snapshot?.view?.breadcrumb ?? []),
      // A followed declaration from another file says where it lives: the chain can cross files,
      // and the folder steps before it only describe the first.
      ...(lensTrail ?? []).map((card) => ({
        id: card.node.id,
        name: card.node.name,
        kind: card.node.kind,
        ...(card.node.path !== scopePath ? { hint: `${card.node.path}:${card.startLine}` } : {}),
      })),
    ],
    [snapshot?.view?.breadcrumb, lensTrail, scopePath],
  )

  const leaveTo = useCallback(
    (crumb: LevelCrumb) => {
      // A function in the chain: cut the chain back to it.
      const inTrail = lensTrail?.findIndex((card) => card.node.id === crumb.id) ?? -1
      if (inTrail >= 0) return graph.truncateTrail(inTrail + 1)
      const path = snapshot?.view?.breadcrumb ?? []
      const index = path.findIndex((c) => c.id === crumb.id)
      // Leaving the lens for its own file lands on the file's symbols with the function selected.
      const cameFrom =
        index === path.length - 1
          ? (lensTrail?.[0]?.node.id ?? null)
          : (path[index + 1]?.id ?? null)
      graph.leaveTo(crumb.id, cameFrom)
    },
    [graph, snapshot?.view?.breadcrumb, lensTrail],
  )

  // Opened in the chat this map belongs to (the tab's own session), never the one in front.
  const openFile = useCallback(
    (card: CodeCard) => {
      if (!graph.sessionId) return
      miniAppWorkspace.openFile({
        sessionId: graph.sessionId,
        path: `${snapshot?.root ?? ''}/${card.node.path}`,
        line: card.startLine,
      })
    },
    [graph.sessionId, snapshot?.root],
  )

  // Escape clears the search and the selection from anywhere inside the map. The root is a group
  // landmark, not a control, so the listener is attached to the element rather than as a JSX
  // handler. The element mounts only once the map is ready, hence state instead of a plain ref.
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null)
  const onEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    graph.setQuery('')
    graph.setSelected(null)
  })
  useEffect(() => {
    if (!rootElement) return
    const listener = (event: KeyboardEvent) => onEscape(event)
    rootElement.addEventListener('keydown', listener)
    return () => rootElement.removeEventListener('keydown', listener)
  }, [rootElement])

  if (!graph.sessionId) {
    return (
      <StateNotice
        icon={MessageSquareOff}
        title="No chat for this map"
        body="The Code Graph maps the project of a chat. Open it from a chat to see that project."
      />
    )
  }
  if (!snapshot) {
    return graph.loading ? (
      <LoadingHint>Opening the code map…</LoadingHint>
    ) : (
      <StateNotice
        icon={Network}
        title="The code map is unavailable"
        body={graph.error ?? undefined}
        actions={
          <Button size="sm" variant="field" onClick={() => graph.refresh()}>
            Try again
          </Button>
        }
      />
    )
  }
  const { view, selection } = snapshot
  if (!view) return <FirstBuild snapshot={snapshot} onRetry={graph.reindex} />

  const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : undefined
  const agentNote = snapshot.agent && graph.highlighted.size > 0 ? snapshot.agent : null
  const showInspector = inspectorOpen && selection
  return (
    <div
      ref={setRootElement}
      data-code-graph-root
      role="group"
      aria-label="Code Graph"
      className="@container flex h-full min-h-0 flex-col"
    >
      <Toolbar
        graph={graph}
        snapshot={snapshot}
        inspectorOpen={inspectorOpen}
        onToggleInspector={toggleInspector}
        crumbs={crumbs}
        onLeaveTo={leaveTo}
        onPick={jump}
      />
      {agentNote && (
        <WorkbenchNoticeBar
          tone="info"
          icon={<Sparkles className="size-3.5" />}
          title={agentNote.note ?? `The agent highlighted ${agentNote.highlight.length} node(s).`}
          onDismiss={graph.dismissAgent}
          dismissLabel="Clear the highlight"
        />
      )}
      <div ref={paneRef} className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {snapshot.lens ? (
            <LensCanvas
              active={active}
              agent={snapshot.agent}
              scope={view.scope.id}
              lens={snapshot.lens}
              onFollow={graph.follow}
              onPrepend={graph.prepend}
              onOpenFile={openFile}
              onReveal={graph.leaveTo}
            />
          ) : view.nodes.length === 0 ? (
            <StateNotice
              icon={Network}
              title="Nothing here the map can read"
              body="This level holds no supported source files."
            />
          ) : (
            <GraphCanvas
              active={active}
              agent={snapshot.agent}
              view={view}
              selected={graph.selected}
              highlighted={graph.highlighted}
              kinds={graph.kinds}
              onEnter={graph.open}
              onActivate={activate}
              onLeave={() => parent && leaveTo(parent)}
            />
          )}
        </div>
        {showInspector && (
          <aside
            aria-label="Inspector"
            className={cn(
              'w-80 shrink-0 overflow-y-auto border-l border-border-soft bg-background',
              !wide &&
                'absolute inset-y-0 right-0 z-(--z-overlay) max-w-[88%] shadow-(--shadow-drawer)',
            )}
          >
            <Inspector
              sessionId={graph.sessionId}
              snapshot={snapshot}
              detail={selection}
              isLevel={
                selection.node.id === view.scope.id ||
                selection.node.id === lensTrail?.at(-1)?.node.id
              }
              onJump={jump}
              onEnter={graph.open}
              onClear={() => graph.setSelected(null)}
            />
          </aside>
        )}
      </div>
      <StatusLine snapshot={snapshot} />
    </div>
  )
}
