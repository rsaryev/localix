import { useState } from 'react'
import { Braces, Check, FilePlus2, Keyboard, Lock, Plus } from 'lucide-react'
import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'
import { FIELD_SURFACE, cn } from '@localixai/mini-app-sdk/ui/classes'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@localixai/kit/command'
import { IconButton } from '@localixai/kit/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@localixai/kit/popover'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@localixai/kit/dialog'
import { BOARD_FILE } from '../../shared/resource'
import { spaceTypes } from '../../shared/types'
import { INSERTABLE } from '../elements'
import { LinkForm } from '../elements/WebLink'
import type { Tool } from './useTools'

export function ToolCatalog({
  sessionId,
  tool,
  locked,
  onTool,
  onLock,
  onAddFiles,
  onShortcuts,
}: {
  sessionId: string
  tool: Tool
  locked: boolean
  onTool: (tool: Tool, props?: Record<string, unknown>) => void
  onLock: () => void
  onAddFiles: () => void
  onShortcuts: () => void
}) {
  const [open, setOpen] = useState(false)
  const [linkInput, setLinkInput] = useState(false)
  const choose = (action: () => void) => {
    setOpen(false)
    action()
  }
  const activeView = INSERTABLE.find((view) => view.type === tool && !view.insert?.primary)
  const CatalogIcon = activeView?.Icon ?? Plus
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <IconButton
            size="lg"
            aria-label="More tools"
            tooltip={
              activeView
                ? `${spaceTypes.get(activeView.type)?.label ?? tool} · More tools`
                : 'More tools'
            }
            tooltipSide="right"
            aria-pressed={Boolean(activeView)}
          >
            <CatalogIcon className="size-4" />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={10}
          className="w-80 gap-0 p-0"
          aria-label="Board tools catalog"
        >
          <Command label="Board tools">
            <CommandInput placeholder="Search tools…" />
            <CommandList className="max-h-[min(28rem,65vh)]">
              <CommandEmpty>No tools match your search.</CommandEmpty>
              <CommandGroup heading="Create">
                {INSERTABLE.map((view) => {
                  const label = spaceTypes.get(view.type)?.label ?? view.type
                  return (
                    <CommandItem
                      key={view.type}
                      value={label}
                      keywords={[view.type, view.insert?.description ?? '']}
                      onSelect={() =>
                        choose(() =>
                          view.insert?.input === 'link' ? setLinkInput(true) : onTool(view.type),
                        )
                      }
                      className="gap-2 py-2"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          FIELD_SURFACE,
                          'flex size-8 shrink-0 items-center justify-center',
                        )}
                      >
                        <view.Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium">{label}</span>
                        <span className="block text-2xs leading-snug text-text-faint">
                          {view.insert?.description ?? 'Click the board to place'}
                        </span>
                      </span>
                      {tool === view.type && (
                        <Check aria-label="Active tool" className="size-3.5" />
                      )}
                      {view.insert?.key && (
                        <CommandShortcut>{view.insert.key.toUpperCase()}</CommandShortcut>
                      )}
                    </CommandItem>
                  )
                })}
                <CommandItem onSelect={() => choose(onAddFiles)}>
                  <FilePlus2 className="size-4" /> Add files from disk
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Board">
                <CommandItem onSelect={() => choose(onLock)}>
                  <Lock className="size-4" /> Keep tool after placing
                  {locked && <Check aria-label="Enabled" className="ml-auto size-3.5" />}
                  <CommandShortcut>Q</CommandShortcut>
                </CommandItem>
                <CommandItem
                  onSelect={() =>
                    choose(() => miniAppWorkspace.openFile({ sessionId, path: BOARD_FILE }))
                  }
                >
                  <Braces className="size-4" /> Open board file
                </CommandItem>
                <CommandItem onSelect={() => choose(onShortcuts)}>
                  <Keyboard className="size-4" /> Keyboard shortcuts{' '}
                  <CommandShortcut>?</CommandShortcut>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Dialog open={linkInput} onOpenChange={setLinkInput}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Add a web link</DialogTitle>
            <DialogDescription>
              Enter an address, then click the board to place the link.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <LinkForm
              onSave={(props) => {
                setLinkInput(false)
                onTool('link', props)
              }}
              onCancel={() => setLinkInput(false)}
            />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  )
}
