/**
 * AtRefMenu — suggestion popover for composer @-references.
 * Same surface + interaction pattern as SlashCommandMenu. For the project-wide
 * mention search it shows a filter tab row (all / files / folders / regex).
 */
import { AtSign, Info, Link2 } from 'lucide-react'

import { CompletionKeyHint } from './CompletionKeyHint'
import { CompletionMenu, type CompletionMenuItem } from './CompletionMenu'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import { MatchedText } from '@localixai/kit/matched-text'
import { SegmentedControl, SegmentedControlItem } from '@localixai/plugin-sdk/ui/segmented-control'
import { fileIcon, folderIcon } from '@/shared/ui/file-icon/fileIcon'
import { refKindIcon } from '../refKindPresentation'
import { MonogramAvatar } from '@localixai/kit/avatar'
import type { AtRefSuggestion, AtRefFilter, AtRefNotice } from './useAtRefAutocomplete'
import { ResourceGlyph } from './ResourceGlyph'

const FILTER_OPTIONS: { value: AtRefFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'files', label: 'Files' },
  { value: 'folders', label: 'Folders' },
  { value: 'regex', label: 'Regex' },
]

interface AtRefMenuProps {
  menuId?: string
  suggestions: AtRefSuggestion[]
  activeIndex: number
  /** The partial being typed, so matched characters in labels can be emphasised. */
  query: string
  onSelect: (s: AtRefSuggestion) => void
  onHover: (index: number) => void
  /** True while a drill level's children are being fetched (spinner row). */
  pending?: boolean
  /** Mode-aware empty-state copy (files / sessions / projects / resources…). */
  emptyLabel?: string
  /** Non-interactive notice rows from the listing (truncation, a failed read) —
   *  rendered as plain hints below the child rows, outside keyboard selection. */
  notices?: AtRefNotice[]
  /** Filter tabs are shown only for the project-wide mention search. */
  showFilters?: boolean
  filter?: AtRefFilter
  onFilterChange?: (f: AtRefFilter) => void
}

/** Glyph for a ref KIND — the SHARED kind→icon map (`refKindPresentation`), so the
 *  menu, the composer chips and the sent pills can never disagree on a kind's icon. */
function kindGlyph(kind: string) {
  const Icon = refKindIcon(kind)
  return <Icon className="size-3.5 text-text-soft" />
}

function SuggestionIcon({ s }: { s: AtRefSuggestion }) {
  // Action rows (the current container's "Link this …" at the top of a level).
  // `--accent-foreground`, not `--accent`: `--accent` is a FILL token — a 6% foreground veil under
  // glass — so the action row's glyph, the one meant to stand OUT, was the faintest in the list.
  if (s.isAction) return <Link2 className="size-3.5 text-accent-foreground" />
  // A participant: its monogram, the same tile the author line and the roster draw for it.
  if (s.kind === 'agent' && s.handle)
    return <MonogramAvatar identity={s.handle} label={s.description} size={14} />
  if (s.kind === 'session' || s.kind === 'project') return kindGlyph(s.kind)
  if (s.kind === 'resource') return <ResourceGlyph icon={s.resourceIcon} />
  if (s.kind === 'type') {
    return s.refKind ? kindGlyph(s.refKind) : <AtSign className="size-3.5 text-text-soft" />
  }
  if (s.isDir) {
    const { Icon, color } = folderIcon(false)
    return <Icon className={`size-3.5 ${color}`} />
  }
  // Strip a trailing slash defensively; file entries carry their basename label.
  const name = s.label.replace(/\/$/, '')
  const { Icon, color } = fileIcon(name)
  return <Icon className={`size-3.5 ${color}`} />
}

export function AtRefMenu({
  menuId,
  suggestions,
  activeIndex,
  query,
  onSelect,
  onHover,
  pending,
  emptyLabel,
  notices,
  showFilters,
  filter,
  onFilterChange,
}: AtRefMenuProps) {
  // The filter row keeps the menu useful even when a filter yields no hits, and
  // a fetching/empty drill level shows a spinner/empty note instead of the menu
  // vanishing (which read as broken) — so only a state with nothing at all to
  // say closes the surface.
  if (suggestions.length === 0 && !showFilters && !pending && !emptyLabel && !notices?.length)
    return null

  // Spinner while a drill level fetches and there are no child rows yet to show
  // (leading action rows may already be visible above it).
  const showSpinner = Boolean(pending) && !suggestions.some((s) => !s.isAction)

  const items: CompletionMenuItem[] = suggestions.map((s, i) => {
    // Section header when a resource ROOT's provider group changes (Databases,
    // a container workbench…). Only root nodes carry `resourceGroup`, so drilled
    // listings and non-resource modes render no headers.
    const showGroupHeader =
      !!s.resourceGroup && s.resourceGroup !== suggestions[i - 1]?.resourceGroup
    // "Actions" header above the leading action rows; "Go deeper" header at the
    // first drillable/child row that follows an action row — so the two sections
    // (actions-at-top, children-below) read clearly at every level.
    const showActionsHeader = s.isAction && !suggestions[i - 1]?.isAction
    const showChildrenHeader = !s.isAction && !!suggestions[i - 1]?.isAction
    return {
      key: s.id,
      index: i,
      onSelect: () => onSelect(s),
      sectionHeaders: [
        ...(showActionsHeader ? [{ label: 'Actions' }] : []),
        ...(showChildrenHeader ? [{ label: 'Go deeper', divider: true }] : []),
        ...(showGroupHeader ? [{ label: s.resourceGroup ?? '', divider: i > 0 }] : []),
      ],
      content: (
        <>
          <span className="shrink-0">
            <SuggestionIcon s={s} />
          </span>
          <span className="shrink-0 text-sm font-medium">
            <MatchedText
              text={s.label}
              query={query}
              plainClassName="text-foreground"
              dimClassName="text-text-soft"
            />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-text-soft">{s.description}</span>
          {i === activeIndex && (
            <CompletionKeyHint
              hints={
                s.isAction
                  ? [{ key: '↵', label: 'link' }]
                  : s.isDir
                    ? s.navigationOnly
                      ? [{ key: '↵', label: 'open' }]
                      : [
                          { key: '↵', label: 'open' },
                          { key: '→', label: 'link' },
                        ]
                    : [{ key: '⇥' }]
              }
            />
          )}
        </>
      ),
    }
  })

  const filterTabs = showFilters && filter && onFilterChange && (
    <div className="px-1 pb-1">
      <SegmentedControl variant="muted">
        {FILTER_OPTIONS.map((opt) => (
          <SegmentedControlItem
            key={opt.value}
            active={filter === opt.value}
            onClick={() => onFilterChange(opt.value)}
          >
            {opt.label}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
    </div>
  )

  const bottom = (
    <>
      {showSpinner && (
        <ActivitySignal
          label="Loading references"
          className="justify-center px-2.5 py-2 text-sm text-text-soft"
          labelClassName="min-w-0"
        />
      )}
      {/* In-band listing notices (truncation, a failed read) — plain hints, never
          selectable, so a dropped page is stated instead of silently missing. */}
      {(notices ?? []).map((n) => (
        <div
          key={`${n.label}:${n.detail ?? ''}`}
          className="flex items-center gap-2.5 px-2.5 py-1.5 text-sm text-text-soft"
        >
          <Info className="size-3.5 shrink-0 opacity-60" />
          <span className="min-w-0 truncate">{n.label}</span>
          {n.detail && <span className="shrink-0 text-2xs text-text-faint">{n.detail}</span>}
        </div>
      ))}
    </>
  )

  return (
    <CompletionMenu
      id={menuId}
      items={items}
      activeIndex={activeIndex}
      onHover={onHover}
      top={filterTabs || undefined}
      bottom={bottom}
      empty={
        showSpinner ? undefined : (
          <div className="px-2.5 py-2 text-sm text-text-soft">
            {emptyLabel ?? 'No matching files.'}
          </div>
        )
      }
    />
  )
}
