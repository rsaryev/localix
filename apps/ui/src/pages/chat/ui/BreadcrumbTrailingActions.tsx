import { useCallback, type ReactNode } from 'react'
import { Download, Globe2, MoreHorizontal, SquareTerminal } from 'lucide-react'

import { StatusItems, useLiveStatusItemCount } from '@/shared/contrib/statusItems'
import { useChatStore } from '@/entities/chat/model/store'
import { useBreadcrumbDepth } from '@/entities/chat/model/useBreadcrumbDepth'
import { useDesktopUpdate } from '@/shared/hooks/useDesktopUpdate'
import { restartToUpdate } from '@/entities/chat/model/restartToUpdate'
import { Spinner } from '@localixai/kit/spinner'
import {
  useGridStore,
  focusedVisibleTabId,
  closeGridTab,
  type WorkItemKind,
} from '@/entities/workspace-grid/model'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { TitlebarOverflowItems } from '@/entities/chat/ui/TitlebarOverflowItems'
import { UpdateAnnouncement } from '@/entities/chat/ui/update-dialog/UpdateAnnouncement'
import { inspector } from '@/shared/lib/inspectorBus'
import { CMD, useChordHint } from '@/shared/lib/keybindings'
import { Tooltip, TooltipContent, TooltipTrigger } from '@localixai/kit/tooltip'
import { NotificationCenterLauncher } from '@/shared/ui/notification-center/NotificationCenterLauncher'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { chromeAction, chromeActionActive } from '@localixai/kit/chrome-action'
import { fitStatusStrip } from '@localixai/kit/workbench-statusbar'

/**
 * The workspace quick-access cluster in the titlebar, next to the unified navigation breadcrumb
 * (see {@link TitlebarContent}). Two zones, and the order is a contract:
 *
 *     … breadcrumb … │ [ contributed mini app items ] │ [ Terminal · Browser · Event Center ]
 *
 * ── THE CORE CLUSTER IS THE ANCHOR, AND IT IS PINNED RIGHT ──────────────────────
 * The terminal, browser and bell are always here, always LAST, and no mini app can move,
 * replace or crowd them out. They used to sit on either side of the mini app glyphs — palette and
 * terminal before, bell after — which made the row's right edge a different control depending on
 * how many mini apps happened to be speaking. Three fixed buttons behind one rule are a corner a
 * user can aim at without reading, which is the entire value of permanent chrome. The Event Center
 * in particular is the single place a user looks when something needs attention, and an anchor
 * that moves is not one.
 *
 * The contributed items therefore grow LEFTWARDS out of that corner, into the room the navigation
 * trail is not using. `StatusItems` renders contributed items only, and its budget counts only
 * those — a workspace with twenty mini apps pushes mini app glyphs into `…`, never the bell.
 *
 * ── Why a FIXED curated core set, not another drag-customizable one ─────────────
 * These are the always-relevant workspace tools, so they earn a stable, always-visible home in
 * the header, and this cluster is deliberately NOT drag-reorderable (Terminal was removed from
 * the left rail's customizable viewlets so nothing is duplicated). Review is intentionally absent
 * — the composer's SuggestionsChip already surfaces pending suggestions. The rail stays the full
 * customization surface for every other panel; this is the horizontal complement.
 *
 * Source control used to be a fourth hardcoded button here. It is a contributed item now, which
 * is the whole point of the middle zone: what belongs to a mini app lives in the mini app.
 */

/**
 * The CEILING on contributed items in the titlebar; how many actually show is a question of room.
 *
 * A cap rather than trust: every mini app could want a glyph here, and a titlebar that
 * grows until the breadcrumb has nowhere left to truncate is worse for the user than a menu.
 * Overflow, never truncation — an item that silently vanished would be indistinguishable from a
 * mini app that broke.
 *
 * It used to be a flat four on a window of any size, which was the wrong half of the trade, and
 * then a ten chosen to match the installed set — a number that has to be edited every time a mini app
 * starts or stops contributing. `fitStatusStrip` spends the MEASURED room instead, dropping the
 * items' live text before dropping the items themselves, so this is no longer the number that
 * decides anything on a normal window. It is the sanity ceiling above which a status bar has
 * become an icon drawer, and it sits above the installed set on purpose: a ceiling below what is
 * installed is not a ceiling, it is a fold nobody asked for.
 */
const MAX_VISIBLE_TITLEBAR_ITEMS = 12

export function BreadcrumbTrailingActions({
  titlebarWidth = null,
}: {
  /**
   * Width of the titlebar row in px, measured by its owner, or `null` before the first
   * measurement. Measured THERE rather than here: this cluster's own box is intrinsic (the grid's
   * trailing column sizes to it), so measuring it would be asking the strip how wide it is in
   * order to decide how wide to be.
   */
  titlebarWidth?: number | null
}) {
  // The titlebar is the chrome OF the chat on screen, like the breadcrumb beside it, so "which
  // chat is open" is the session it acts on — not a fallback. With no chat open there is nothing
  // for the terminal or the browser to belong to, so both are disabled rather than guessing.
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  // The id + kind of the FOCUSED group's VISIBLE active tab (scope-correct — the
  // same signal the rail uses to light its buttons), so a header action lights up
  // when its panel is the focused tab and a click then toggles it closed.
  const focusedId = useGridStore(focusedVisibleTabId)
  const focusedKind = useGridStore((s) => {
    const id = focusedVisibleTabId(s)
    return id ? (s.items[id]?.kind ?? null) : null
  })

  // Toggle: if a tab of this kind is focused, close it; otherwise open/reveal it.
  const toggle = (kind: WorkItemKind, open: () => void) =>
    focusedKind === kind && focusedId ? closeGridTab(focusedId) : open()

  // How many mini apps are DRAWING, against how much room the strip has. Counting declarations
  // instead was the bug behind the report: most titlebar items return `null` until they
  // have something to say (no open books, no environments, no running forwards), so a budget spent
  // on declarations reserved room for the silent ones and folded the speaking ones into `…`. The
  // set changes as a session does — that is the point of a live strip, not a reason to size it on
  // items nobody can see.
  const contributedCount = useLiveStatusItemCount('titlebar')
  // The row's other tenant, in the only currency neither half can distort. See the hook.
  const breadcrumbDepth = useBreadcrumbDepth()
  const fit = fitStatusStrip({
    containerWidth: titlebarWidth,
    count: contributedCount,
    max: MAX_VISIBLE_TITLEBAR_ITEMS,
    breadcrumbDepth,
  })

  return (
    // The parent titlebar grid owns the trailing column. `min-w-0` rather than `shrink-0`: the
    // mini app half is now allowed to be wide, so if the fit ever over-promised the excess must be
    // clipped inside this cluster instead of pushing a deep breadcrumb out of its own column.
    // NOT a `data-tauri-drag-region`, so controls remain clickable on macOS.
    <div
      data-tauri-drag-region="false"
      className="flex min-w-0 flex-nowrap items-center gap-0.5 pl-1"
    >
      {/* CONTRIBUTED items — declared, not drawn. A mini app says what it has (a glyph, live text,
          metrics, a menu) and the host renders the same control it gives its own buttons below.
          The seam this replaced was a free React surface, and the one button in it had already
          grown its own height and lost its focus ring.

          Its own group, named, and fenced on BOTH sides: between the navigation path and three
          fixed core controls, the mini app glyphs are the one part of this row whose membership
          changes, and a boundary is what lets a screen-reader user skip them the way a sighted one
          skips a cluster of icons. The leading rule appears only when the group has something in
          it — two rules with nothing between them is the seam an empty strip would leave. */}
      {contributedCount > 0 && <Rule />}
      <div
        role="group"
        aria-label="Mini app items"
        className="flex min-w-0 items-center gap-0.5 overflow-hidden"
      >
        <StatusItems
          placement="titlebar"
          sessionId={activeSessionId}
          max={fit.visible}
          compact={fit.compact}
          renderOverflow={(hidden) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-label={`${hidden.length} more mini app item${hidden.length === 1 ? '' : 's'}`}
                  className={chromeAction}
                >
                  <MoreHorizontal className="size-3.5 shrink-0" strokeWidth={1.75} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <TitlebarOverflowItems items={hidden} sessionId={activeSessionId} />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        />
      </div>

      <Rule />

      {/* The fixed core, pinned to the row's right edge and never folded. */}
      <div role="group" aria-label="Workspace actions" className="flex shrink-0 items-center gap-1">
        {/* Terminal — opens (or focuses) a shell as an editor-grid tab, center-stage
            beside the preview. Toggles closed when a terminal tab is already focused. */}
        <ActionButton
          label="Terminal"
          chordId={CMD.toggleTerminal}
          active={focusedKind === 'terminal'}
          disabled={!activeSessionId}
          onClick={() =>
            toggle('terminal', () => {
              if (activeSessionId) inspector.openTerminal(activeSessionId)
            })
          }
        >
          <SquareTerminal className="size-3.5 shrink-0" strokeWidth={1.75} />
        </ActionButton>

        <ActionButton
          label="Browser"
          active={focusedKind === 'preview'}
          disabled={!activeSessionId}
          onClick={() =>
            toggle('preview', () => {
              if (activeSessionId)
                inspector.openPreview({
                  url: 'about:blank',
                  version: 0,
                  sessionId: activeSessionId,
                })
            })
          }
        >
          <Globe2 className="size-3.5 shrink-0" strokeWidth={1.75} />
        </ActionButton>

        {/* The sole in-app notification surface: unread signal, actions and history. */}
        <EventCenterBell />

        {/* A signed update is ready: offer it right beside the other always-relevant actions
            instead of only in the rail or the composer strip. Hidden otherwise. */}
        <UpdateActionButton />
        {/* …and announces a newly found version once, in a dialog. */}
        <UpdateAnnouncement />
      </div>
    </div>
  )
}

/** The bell, whose offer of the app's update restarts through the same flow as the button. */
function EventCenterBell() {
  const { applyUpdate } = useDesktopUpdate({ poll: false })
  const restart = useCallback(() => void restartToUpdate(applyUpdate, () => {}), [applyUpdate])
  return <NotificationCenterLauncher restartToUpdate={restart} />
}

/** The update action, shown only once a signed update is actually available. */
function UpdateActionButton() {
  const { state, applyUpdate } = useDesktopUpdate()
  if (!state?.available) return null
  const applying = state.installing
  const label =
    applying && state.message.startsWith('Downloading')
      ? state.message
      : `Update & Restart${state.latestVersion ? ` (v${state.latestVersion})` : ''}`
  return (
    <ActionButton
      label={label}
      disabled={applying}
      onClick={() => void restartToUpdate(applyUpdate, () => {})}
    >
      {applying ? (
        <Spinner className="size-3.5" />
      ) : (
        <Download className="size-3.5 shrink-0" strokeWidth={1.75} />
      )}
    </ActionButton>
  )
}

/** The hairline that fences one zone of the titlebar off from the next. */
function Rule() {
  return <span className="mx-1 h-3 w-px shrink-0 bg-border-soft" aria-hidden="true" />
}

/** One header quick-action: compact icon (+ optional inline status), toggle-aware. */
function ActionButton({
  label,
  chordId,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  chordId?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  const hint = useChordHint()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          aria-pressed={active ?? undefined}
          className={cn(chromeAction, active && chromeActionActive)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{hint(label, chordId)}</TooltipContent>
    </Tooltip>
  )
}
