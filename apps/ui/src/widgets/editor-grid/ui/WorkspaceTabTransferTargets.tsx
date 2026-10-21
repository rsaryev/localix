import { useState } from 'react'
import { AppWindow, PanelsTopLeft } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { DROP_TARGET_TRANSITION } from '@localixai/kit/drop-target'
import { FLOATING_SURFACE } from '@localixai/kit/workbench-toolbar'
import { useGridStore } from '@/entities/workspace-grid/model'
import { useWorkItemDrag, workItemDragBus } from '@/shared/lib/workItemDragBus'
import {
  browserTabTransferBus,
  useBrowserTabTransferState,
} from '@/shared/lib/browserTabTransferBus'
import { moveTabToWorkspaceWindow, nativeTabTransferAvailable } from '../model/windowTransfer'
import { canTransferWorkItem, type TabWindowDestination } from '../model/windowTransferPayload'

const TARGETS = [
  {
    key: 'top',
    destination: 'tab',
    label: 'Move to a new workspace tab',
    Icon: PanelsTopLeft,
    position: 'inset-x-12 top-12 h-8',
  },
  {
    key: 'left',
    destination: 'window',
    label: 'Move to a new window',
    Icon: AppWindow,
    position: 'inset-y-12 left-0 h-auto w-12',
  },
  {
    key: 'right',
    destination: 'window',
    label: 'Move to a new window',
    Icon: AppWindow,
    position: 'inset-y-12 right-0 h-auto w-12',
  },
] as const

/** Bounded destinations stay at the workspace edges; the center remains available to existing groups. */
export function WorkspaceTabTransferTargets() {
  const drag = useWorkItemDrag()
  const browser = useBrowserTabTransferState()
  const item = useGridStore((state) => (drag?.itemId ? state.items[drag.itemId] : undefined))
  if (browser.drag && browser.available)
    return <TransferTargetZones key={`page:${browser.drag.pageId}`} />
  if (!drag?.itemId || !canTransferWorkItem(item) || !nativeTabTransferAvailable()) return null
  return <TransferTargetZones key={drag.itemId} />
}

function TransferTargetZones() {
  const [hovered, setHovered] = useState<string | null>(null)
  const move = (destination: TabWindowDestination) => {
    const page = browserTabTransferBus.get().drag
    const id = workItemDragBus.get()?.itemId
    browserTabTransferBus.end()
    workItemDragBus.end()
    setHovered(null)
    if (page) void browserTabTransferBus.move(page, destination)
    else if (id) void moveTabToWorkspaceWindow(id, destination)
  }
  return (
    <div
      className="pointer-events-none absolute inset-0 z-(--z-drag-overlay)"
      data-workspace-transfer-targets
    >
      {TARGETS.map(({ key, destination, label, Icon, position }) => {
        return (
          <Button
            key={key}
            type="button"
            variant="ghost"
            aria-label={label}
            data-workspace-transfer-target={key}
            data-drop-active={hovered === key ? 'true' : undefined}
            className={cn(
              'lx-glass-trigger pointer-events-auto absolute flex min-w-0 items-center justify-center rounded-md border-0 bg-transparent p-0 text-xs text-text-soft hover:bg-transparent hover:text-foreground',
              DROP_TARGET_TRANSITION,
              position,
            )}
            onClick={() => move(destination)}
            onDragOver={(event) => {
              event.preventDefault()
              event.stopPropagation()
              event.dataTransfer.dropEffect = 'move'
              setHovered(key)
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                setHovered(null)
            }}
            onDrop={(event) => {
              event.preventDefault()
              event.stopPropagation()
              move(destination)
            }}
          >
            <span
              className={cn(
                'lx-glass pointer-events-none flex items-center justify-center gap-2 rounded-md',
                key === 'top' ? 'h-6 w-full px-3' : 'h-[calc(100%-0.5rem)] w-6',
              )}
            >
              <Icon aria-hidden="true" />
              {key === 'top' && <span className="truncate">{label}</span>}
            </span>
            {key !== 'top' && (
              <span
                className={cn(
                  FLOATING_SURFACE,
                  'pointer-events-none absolute whitespace-nowrap px-3 py-1.5 text-xs font-medium shadow-none transition-opacity duration-(--dur-fast)',
                  hovered === key ? 'opacity-100' : 'opacity-0',
                  key === 'left' ? 'left-full ml-2' : 'right-full mr-2',
                )}
              >
                {label}
              </span>
            )}
          </Button>
        )
      })}
    </div>
  )
}
