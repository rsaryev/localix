import { BadgeCheck } from 'lucide-react'
import { MonogramAvatar } from '@localixai/kit/avatar'
import { openMiniAppStore } from '@/shared/lib/openMiniAppStore'
import { closeSetup } from '@/shared/lib/setupDialog'
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

/**
 * The sentence ends in the store itself: setup steps aside — it opens again from the command
 * palette — and the same tab the rail's add button opens takes the window.
 */
export function MiniAppsAction() {
  return (
    <TipPickTrigger
      label="Mini apps"
      value="the store"
      onClick={() => {
        closeSetup()
        openMiniAppStore()
      }}
    />
  )
}
