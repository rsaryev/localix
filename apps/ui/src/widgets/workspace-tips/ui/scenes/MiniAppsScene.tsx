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

/** How many cards the slide draws. */
const CARDS = 3

/** A card's state, in the three words the slide styles. */
function cardState(entry: Listing): 'Install' | 'Installing' | 'Installed' {
  if (entry.installs.length) return 'Installed'
  return isActiveJob(entry.job) ? 'Installing' : 'Install'
}

/**
 * The Store's own apps, the ones that matter first: the recommended (installing on their own),
 * then the vouched-for featured ones. The core names no mini app (X4), so the slide draws whatever
 * the Store offers, and blank cards when it offers nothing yet.
 */
function useStoreApps() {
  const generation = useResourceGeneration('store')
  const { data } = useSWR(['tips-mini-apps', generation], () =>
    storeApi.page({ shelf: 'package:mini-app', limit: LISTINGS_PAGE_MAX }),
  )
  return data?.listings ?? []
}

/** The store as the person meets it: apps as cards, one action each, publishers vouched for. */
export function MiniAppsScene() {
  const listings = useStoreApps()
  const rank = (entry: Listing) => (entry.recommended ? 0 : entry.featured ? 1 : 2)
  const apps = listings
    .filter((entry) => entry.recommended || entry.publisher.verified)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, CARDS)
  const blanks = Array.from({ length: CARDS - apps.length }, (_, index) => index)
  return (
    <div aria-hidden className="wt-mini-apps">
      {apps.map((entry) => (
        <div key={entry.ref.id} className="wt-pane wt-mini-app-card" data-state={cardState(entry)}>
          <div className="wt-mini-app-head">
            <MonogramAvatar identity={entry.ref.id} label={entry.displayName} size={20} />
            <span className="wt-mini-app-name">{entry.displayName}</span>
            {entry.publisher.verified ? <BadgeCheck className="size-3 text-status-info" /> : null}
          </div>
          {entry.category ? <span className="wt-mini-app-what">{entry.category}</span> : null}
          <span className="wt-mini-app-action">{cardState(entry)}</span>
        </div>
      ))}
      {blanks.map((index) => (
        <div key={`blank-${index}`} className="wt-pane wt-mini-app-card" data-state="blank" />
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
  const entries = useStoreApps()
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
