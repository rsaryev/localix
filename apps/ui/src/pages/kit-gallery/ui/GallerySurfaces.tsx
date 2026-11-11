import { useState, type ReactNode } from 'react'
import { Copy, Trash2 } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@localixai/kit/command'
import {
  PaneDialog,
  PaneDialogBody,
  PaneDialogContent,
  PaneDialogFooter,
  PaneDialogHeader,
  PaneDialogTitle,
} from '@localixai/kit/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { Input } from '@localixai/kit/input'
import {
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@localixai/kit/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@localixai/kit/tooltip'

/**
 * The real overlays, opened in place and non-modal so several stay up at once. A dialog surface is
 * shown through the pane dialog, which is the same modal material without a portal, so it can sit
 * in the page's flow; the centred dialog, the confirmation and the picker sheet are cut from it.
 */
function Stage({ children, className }: { children: ReactNode; className: string }) {
  return <div className={`relative overflow-hidden rounded-xl ${className}`}>{children}</div>
}

function OpenMenu() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm">
          Menu
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onCloseAutoFocus={(event) => event.preventDefault()}>
        <DropdownMenuLabel>Session</DropdownMenuLabel>
        <DropdownMenuItem>
          <Copy /> Copy link <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem data-highlighted="">Highlighted row</DropdownMenuItem>
        <DropdownMenuItem disabled>Disabled row</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem tone="danger">
          <Trash2 /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function OpenPopover() {
  return (
    <Popover open>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm">
          Popover
        </Button>
      </PopoverTrigger>
      <PopoverContent
        layout="structured"
        align="start"
        className="w-64"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <PopoverHeader>
          <PopoverTitle>Popover</PopoverTitle>
        </PopoverHeader>
        <PopoverBody className="flex flex-col gap-2">
          <Input placeholder="A field inside" />
          <span className="text-xs text-text-soft">Body text on the raised ground.</span>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  )
}

function OpenTooltip() {
  return (
    <TooltipProvider>
      <Tooltip open>
        <TooltipTrigger asChild>
          <Button variant="secondary" size="sm">
            Tooltip
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Tooltip label</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function DialogSample() {
  return (
    <PaneDialog modal={false} onClose={() => {}}>
      <PaneDialogContent onOpenAutoFocus={(event) => event.preventDefault()}>
        <PaneDialogHeader>
          <PaneDialogTitle>Rename session</PaneDialogTitle>
        </PaneDialogHeader>
        <PaneDialogBody className="flex flex-col gap-2 text-xs text-text-soft">
          A dialog: header, a body with a field, a footer with actions.
          <Input defaultValue="Morning notes" />
        </PaneDialogBody>
        <PaneDialogFooter>
          <Button variant="secondary" size="sm">
            Cancel
          </Button>
          <Button variant="mono" size="sm">
            Rename
          </Button>
        </PaneDialogFooter>
      </PaneDialogContent>
    </PaneDialog>
  )
}

function PaletteSample() {
  const [value, setValue] = useState('new session')
  return (
    <PaneDialog modal={false} onClose={() => {}}>
      <PaneDialogContent onOpenAutoFocus={(event) => event.preventDefault()}>
        <PaneDialogTitle className="sr-only">Command palette</PaneDialogTitle>
        <Command label="Commands" value={value} onValueChange={setValue}>
          <CommandInput placeholder="Type a command…" />
          <CommandList>
            <CommandGroup heading="Commands">
              <CommandItem value="new session">
                New session <CommandShortcut>⌘N</CommandShortcut>
              </CommandItem>
              <CommandItem value="open settings">Open settings</CommandItem>
              <CommandItem value="switch model">Switch model</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PaneDialogContent>
    </PaneDialog>
  )
}

/** Every raised surface, open at once, so one render shows how they sit over the window. */
export function SurfaceSet() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-56 items-start gap-48">
        <OpenMenu />
        <OpenPopover />
        <div className="ml-24">
          <OpenTooltip />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Stage className="h-80">
          <DialogSample />
        </Stage>
        <Stage className="h-80">
          <PaletteSample />
        </Stage>
      </div>
      <Stage className="flex h-24 items-center justify-center">
        <span className="text-xs text-foreground">Text under the full scrim</span>
        <div className="lx-scrim absolute inset-0" />
      </Stage>
    </div>
  )
}
