import { useState } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { IconButton } from '@localixai/kit/icon-button'
import { railBtn } from '@localixai/kit/rail-button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { MiniAppStore } from '@/entities/mini-app-store/ui/MiniAppStore'

/**
 * The rail's add button: the mini app store in a dialog — the same store Settings → Mini apps and
 * the first run show. An app installed here appears in the rail on its `mini-apps` poke.
 */
export function RailAddMiniApp() {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <IconButton
        size="touch"
        aria-label="Add mini apps"
        className={cn(railBtn)}
        onClick={() => setOpen(true)}
      >
        <Plus />
      </IconButton>
      <DialogContent size="3xl">
        <DialogHeader>
          <DialogTitle>Add mini apps</DialogTitle>
          <DialogDescription>
            Apps with their own screens and tools, from the catalog.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>{open && <MiniAppStore />}</DialogBody>
      </DialogContent>
    </Dialog>
  )
}
