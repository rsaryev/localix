import { BadgeCheck, LayoutGrid, Store } from 'lucide-react'
import useSWR from 'swr'
import { isActiveJob, LISTINGS_PAGE_MAX, type Listing } from '@localixai/store'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { MonogramAvatar } from '@localixai/kit/avatar'
import { storeApi } from '@/shared/api/store-client'
import { useResourceGeneration } from '@/shared/api/resourceGeneration'
import { joinNames } from '@/shared/lib/background-activity/activityItems'
import { openMiniAppStore } from '@/shared/lib/openStore'
import { TipPick } from '../TipPick'
import { miniAppIconGlyph } from './miniAppIconGlyph'
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
function standing(entry: Listing): string {
  const job = entry.job
  if (job?.phase === 'queued') return 'Waiting'
  if (job?.phase === 'downloading')
    return job.total
      ? `Installing ${Math.round(((job.received ?? 0) / job.total) * 100)}%`
      : 'Installing'
  if (job?.phase === 'installing') return 'Installing'
  if (entry.installs.length) return 'Installed'
  return job?.phase === 'failed' ? 'Try again' : 'Install'
}

function row(entry: Listing, install: (entry: Listing) => unknown): MenuEntry {
  const settled = entry.installs.length > 0 || isActiveJob(entry.job)
  return {
    id: entry.ref.id,
    label: entry.displayName,
    icon: entry.icon ? miniAppIconGlyph(entry.icon) : LayoutGrid,
    hint: standing(entry),
    // Choosing installs it here and keeps the menu open, so its progress shows in the row.
    keepOpen: true,
    disabled: settled,
    onSelect: () => void install(entry),
  }
}

/**
 * The sentence ends in the apps themselves, picked in place like the other setup choices: the
 * recommended ones (installing on their own on a new installation, with where each stands), a
 * few more of Localix's own with Install, and the Store last — opened behind setup, which stays.
 */
export function MiniAppsAction() {
  const generation = useResourceGeneration('store')
  const { data } = useSWR(['tips-mini-apps', generation], () =>
    storeApi.page({ shelf: 'package:mini-app', limit: LISTINGS_PAGE_MAX }),
  )
  const entries = data?.listings ?? []
  const recommended = entries.filter((entry) => entry.recommended)
  const more = entries
    .filter(
      (entry) =>
        !entry.recommended &&
        entry.publisher.verified &&
        entry.installs.length === 0 &&
        !entry.incompatible,
    )
    .sort((a, b) => Number(b.featured) - Number(a.featured))
    .slice(0, MORE)
  const value = recommended.length
    ? joinNames(recommended.map((entry) => entry.displayName))
    : 'the Store'
  const tryInstall = (entry: Listing) =>
    storeApi.install(entry.ref, 'user', { plan: false }).catch(() => {})
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
        { id: 'store', label: 'Open the Store', icon: Store, onSelect: openMiniAppStore },
      ]}
    />
  )
}
