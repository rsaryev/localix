import { useState } from 'react'
import { BadgeCheck } from 'lucide-react'
import { MonogramAvatar } from '@localixai/kit/avatar'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { MiniAppStore } from '@/entities/mini-app-store/ui/MiniAppStore'
import { TipPickTrigger } from '../TipPick'
import './mini-apps-scene.css'

/** Three cards of the store, the middle one being installed. */
const CARDS = [
  { name: 'chess', label: 'Chess', what: 'Games', state: 'Install' },
  { name: 'kanban', label: 'Kanban', what: 'Utilities', state: 'Installing' },
  { name: 'reader', label: 'Reader', what: 'Content', state: 'Installed' },
] as const

/** The store as the person meets it: apps as cards, one action each, publishers vouched for. */
export function MiniAppsScene() {
  return (
    <div aria-hidden className="wt-mini-apps">
      {CARDS.map((card) => (
        <div key={card.name} className="wt-pane wt-mini-app-card" data-state={card.state}>
          <div className="wt-mini-app-head">
            <MonogramAvatar identity={card.name} label={card.label} size={20} />
            <span className="wt-mini-app-name">{card.label}</span>
            <BadgeCheck className="size-3 text-status-info" />
          </div>
          <span className="wt-mini-app-what">{card.what}</span>
          <span className="wt-mini-app-action">{card.state}</span>
        </div>
      ))}
    </div>
  )
}

/** The sentence ends in the catalog itself: the same store the rail's add button opens. */
export function MiniAppsAction() {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <TipPickTrigger label="Mini apps" value="the catalog" onClick={() => setOpen(true)} />
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
