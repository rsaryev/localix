import { BadgeCheck, LayoutGrid, Store } from 'lucide-react'
import type { MiniAppStoreEntryRecord } from '@localixai/api/client'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { MonogramAvatar } from '@localixai/kit/avatar'
import { isBusy } from '@/entities/mini-app-store/model/storeFilters'
import { useMiniAppStore } from '@/entities/mini-app-store/model/useMiniAppStore'
import { miniAppIconGlyph } from '@/entities/mini-app-store/ui/miniAppIconGlyph'
import { joinNames } from '@/shared/lib/background-activity/activityItems'
import { openMiniAppStore } from '@/shared/lib/openMiniAppStore'
import { TipPick } from '../TipPick'
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

/** How many more of Localix's own apps the pick offers beside the recommended ones. */
const MORE = 4

/** Where one app stands, as the row's hint says it. */
function standing(entry: MiniAppStoreEntryRecord): string {
  const job = entry.job
  if (job?.phase === 'queued') return 'Waiting'
  if (job?.phase === 'downloading')
    return job.total
      ? `Installing ${Math.round(((job.received ?? 0) / job.total) * 100)}%`
      : 'Installing'
  if (job?.phase === 'installing') return 'Installing'
  if (entry.installed) return 'Installed'
  return job?.phase === 'failed' ? 'Try again' : 'Install'
}

function row(entry: MiniAppStoreEntryRecord, install: (name: string) => unknown): MenuEntry {
  const settled = Boolean(entry.installed) || isBusy(entry)
  return {
    id: entry.name,
    label: entry.displayName ?? entry.name,
    icon: entry.icon ? miniAppIconGlyph(entry.icon) : LayoutGrid,
    hint: standing(entry),
    // Choosing installs it here and keeps the menu open, so its progress shows in the row.
    keepOpen: true,
    disabled: settled,
    onSelect: () => void install(entry.name),
  }
}

/**
 * The sentence ends in the apps themselves, picked in place like the other setup choices: the
 * recommended ones (installing on their own on a new installation, with where each stands), a
 * few more of Localix's own with Install, and the store last — opened behind setup, which stays.
 */
export function MiniAppsAction() {
  const { entries, install } = useMiniAppStore()
  const recommended = entries.filter((entry) => entry.recommended)
  const more = entries
    .filter(
      (entry) =>
        !entry.recommended && entry.publisher.verified && !entry.installed && !entry.incompatible,
    )
    .sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)))
    .slice(0, MORE)
  const value = recommended.length
    ? joinNames(recommended.map((entry) => entry.displayName ?? entry.name))
    : 'the store'
  const tryInstall = (name: string) => install(name).catch(() => {})
  return (
    <TipPick
      label="Mini apps"
      value={value}
      entries={[
        { header: 'Recommended' },
        ...recommended.map((entry) => row(entry, tryInstall)),
        { header: 'More from Localix' },
        ...more.map((entry) => row(entry, tryInstall)),
        { separator: true as const },
        { id: 'store', label: 'Open the store', icon: Store, onSelect: openMiniAppStore },
      ]}
    />
  )
}
