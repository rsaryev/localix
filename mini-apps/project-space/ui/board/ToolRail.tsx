import { Hand, Layers, Lock, MousePointer2, Redo2, Search, Undo2, Presentation } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { FloatingActionDivider, FloatingActionGroup } from '@localixai/kit/workbench-toolbar'
import { formatChordText } from '@localixai/kit/keybindings'
import { spaceTypes } from '../../shared/types'
import { INSERTABLE } from '../elements'
import { ToolCatalog } from './ToolCatalog'
import { ToolVariants } from './ToolVariants'
import type { Tool } from './useTools'

/** Everyday creation tools, board navigation and a separate history group. */
export function ToolRail({
  sessionId,
  tool,
  toolProps,
  locked,
  onTool,
  onLock,
  onAddFiles,
  undo,
  redo,
  canUndo,
  canRedo,
  layersOpen,
  onLayers,
  onFind,
  onShortcuts,
  onPresent,
}: {
  sessionId: string
  tool: Tool
  toolProps?: Record<string, unknown>
  locked: boolean
  layersOpen: boolean
  onLayers: () => void
  onFind: () => void
  onShortcuts: () => void
  /** Present the frames as slides; absent when the board has none. */
  onPresent?: () => void
  onTool: (tool: Tool, props?: Record<string, unknown>) => void
  onLock: () => void
  onAddFiles: () => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}) {
  return (
    <div
      data-canvas-chrome=""
      className="nodrag nowheel pointer-events-none absolute left-3 top-1/2 z-(--z-controls) flex max-h-[calc(100%-1.5rem)] -translate-y-1/2 flex-col gap-2"
    >
      <FloatingActionGroup
        aria-label="Board tools"
        className="scrollbar-thin static right-auto top-auto min-h-0 max-w-none flex-col gap-1 overflow-y-auto overscroll-contain rounded-xl p-1"
      >
        <IconButton
          size="lg"
          aria-label="Select"
          tooltip="Select (V)"
          tooltipSide="right"
          aria-pressed={tool === 'select'}
          onClick={() => onTool('select')}
        >
          <MousePointer2 className="size-4" />
        </IconButton>
        <IconButton
          size="lg"
          aria-label="Hand"
          tooltip="Hand (H, or hold Space)"
          tooltipSide="right"
          aria-pressed={tool === 'hand'}
          onClick={() => onTool('hand')}
        >
          <Hand className="size-4" />
        </IconButton>
        <FloatingActionDivider className="mx-0 my-0.5 h-px w-6" />
        {INSERTABLE.filter((view) => view.insert?.primary).map((view) => {
          const label = spaceTypes.get(view.type)?.label ?? view.type
          const key = view.insert?.key?.toUpperCase()
          const variant =
            view.insert?.variants ??
            view.controls?.find(
              (control) => control.kind === 'choice' && control.prop === view.insert?.variantProp,
            )
          if (variant?.kind === 'choice')
            return (
              <ToolVariants
                key={view.type}
                view={view}
                control={variant}
                active={tool === view.type}
                value={toolProps?.[variant.prop]}
                onTool={onTool}
              />
            )
          return (
            <IconButton
              key={view.type}
              size="lg"
              aria-label={label}
              tooltip={`${label}${key ? ` (${key})` : ''} — ${view.insert?.gesture === 'draw' ? 'drag to draw' : 'click to place'}`}
              tooltipSide="right"
              aria-pressed={tool === view.type}
              onClick={() => onTool(tool === view.type ? 'select' : view.type)}
            >
              <view.Icon className="size-4" />
            </IconButton>
          )
        })}
        <ToolCatalog
          sessionId={sessionId}
          tool={tool}
          locked={locked}
          onTool={onTool}
          onLock={onLock}
          onAddFiles={onAddFiles}
          onShortcuts={onShortcuts}
        />
        {locked && (
          <IconButton
            size="lg"
            aria-label="Unlock the tool"
            tooltip="Keep tool after placing (Q)"
            tooltipSide="right"
            aria-pressed
            onClick={onLock}
          >
            <Lock className="size-4" />
          </IconButton>
        )}
        <FloatingActionDivider className="mx-0 my-0.5 h-px w-6" />
        <IconButton
          size="lg"
          aria-label="Find on the board"
          tooltip="Find on the board (/)"
          tooltipSide="right"
          onClick={onFind}
        >
          <Search className="size-4" />
        </IconButton>
        {onPresent && (
          <IconButton
            size="lg"
            aria-label="Present the frames"
            tooltip="Present the frames as slides"
            tooltipSide="right"
            onClick={onPresent}
          >
            <Presentation className="size-4" />
          </IconButton>
        )}
        <IconButton
          size="lg"
          aria-label={layersOpen ? 'Hide layers' : 'Show layers'}
          tooltip="Layers (L)"
          tooltipSide="right"
          aria-pressed={layersOpen}
          onClick={onLayers}
        >
          <Layers className="size-4" />
        </IconButton>
      </FloatingActionGroup>
      <FloatingActionGroup
        aria-label="Board history"
        className="static right-auto top-auto max-w-none shrink-0 flex-col gap-1 rounded-xl p-1"
      >
        <IconButton
          size="lg"
          aria-label="Undo"
          tooltip={`Undo (${formatChordText('mod+z')})`}
          tooltipSide="right"
          disabled={!canUndo}
          onClick={undo}
        >
          <Undo2 className="size-4" />
        </IconButton>
        <IconButton
          size="lg"
          aria-label="Redo"
          tooltip={`Redo (${formatChordText('mod+shift+z')})`}
          tooltipSide="right"
          disabled={!canRedo}
          onClick={redo}
        >
          <Redo2 className="size-4" />
        </IconButton>
      </FloatingActionGroup>
    </div>
  )
}
