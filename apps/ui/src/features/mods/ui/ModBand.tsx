import { Fragment, useMemo, useRef, useState } from 'react'
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { useReducedMotion } from '@localixai/kit/environment'
import { IconButton } from '@localixai/kit/icon-button'
import { ActionTooltip } from '@localixai/kit/tooltip'
import type { ModAction, ModBandPage } from '@/shared/api/modsApi'
import { useModBandRotation } from '@/shared/lib/modBandRotationPref'
import { bandLayout } from './bandLayout'
import { BandPager } from './BandPager'
import { ROW, Row, rowsOf } from './BandRows'
import { BandScroller } from './BandScroller'
import { ModSiteContext } from './modSite'
import { hotkeysOf, pressHotkey } from './siteHotkeys'
import { useBandPages, type Schedule } from './useBandPages'
import { useComposerActivity, useComposerShell } from './useComposerShell'

/**
 * The band above the prompt box, as Claude Code draws its `AbovePrompt` site, drawn as part of the
 * composer rather than a strip bolted onto it: on the composer's own surface (no fill of its own),
 * inset to the composer's 12px padding, with one hairline between it and the input. The mods' tree
 * is at strip density (`modStyle.ts`), laid out by its shape (`bandLayout.ts`, `BandRows.tsx`), in
 * rows of one 28px height, a capped height that scrolls, and the band's controls — its pager and
 * one ghost collapse control — in a column of their own centred on the first row, never over text.
 *
 * When a mod's drawing hid the mods after it, the band has pages (`useBandPages.ts`): ‹ 1/2 › and
 * ⌥[ / ⌥] turn them, a short crossfade between them, and they may turn on their own while the
 * composer is idle. Only the page showing presses: its Buttons' hotkeys work while the band holds
 * the focus, and a digit typed alone into the empty prompt box presses its Button on that digit
 * (`useComposerShell.ts`). Collapsed, the band is one row of what each part of every page says.
 */

export interface ModBandProps {
  sessionId: string
  pages: readonly ModBandPage[]
  /** The chat's turn is running: the page holds still. */
  working?: boolean
  /** A control used on the page `page` drew. */
  act: (action: ModAction, page: number) => void
  /** Runs `run` once the person paused; injected by tests. */
  afterPause?: (run: () => void) => () => void
  /** When the band turns its page on its own; injected by tests. */
  schedule?: Schedule
}

export function ModBand({
  sessionId,
  pages,
  working = false,
  act,
  afterPause,
  schedule,
}: ModBandProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const rotation = useModBandRotation()
  const reducedMotion = useReducedMotion()
  const { activity, drafting } = useComposerActivity(root)
  const book = useBandPages({
    sessionId,
    pages,
    rotate: rotation && !reducedMotion,
    paused: hovered || focused || collapsed || working || drafting,
    activity,
    ...(schedule ? { schedule } : {}),
  })
  const page = pages[book.index]
  const tree = useMemo(() => page?.tree ?? [], [page])
  const hotkeys = useMemo(() => hotkeysOf(tree), [tree])
  const blocks = useMemo(() => bandLayout(tree), [tree])
  const summaries = useMemo(() => pages.map((each) => bandLayout(each.tree)), [pages])
  const actHere = (action: ModAction) => act(action, book.index)
  useComposerShell(root, {
    hotkeys,
    act: actHere,
    collapsed,
    ...(book.count > 1 ? { step: book.step } : {}),
    ...(afterPause ? { afterPause } : {}),
  })

  /** A part of the collapsed row opens the band on its page. */
  const open = (index: number) => {
    if (index !== book.index) book.choose(index)
    setCollapsed(false)
  }

  return (
    // Inset to the composer's own padding, so the band's text starts where the input's does.
    <div
      ref={root}
      className="@container shrink-0 px-3 text-2xs text-text-soft"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
      }}
    >
      <div
        data-slot="mods-band-seam"
        className="flex items-start gap-1 border-b border-border-faint py-0.5"
      >
        {collapsed ? (
          <BandScroller label="Mods band, collapsed" className={`${ROW} flex-1 -ml-2`}>
            {summaries.map((parts, index) => (
              <Fragment key={index}>
                {index > 0 && <span aria-hidden="true" className="h-3.5 w-px bg-border-faint" />}
                {parts.map((part, at) => (
                  <ActionTooltip key={at} label={part.summary}>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="max-w-56 font-normal text-text-faint"
                      onClick={() => open(index)}
                    >
                      <span className="min-w-0 truncate">{part.summary}</span>
                    </Button>
                  </ActionTooltip>
                ))}
              </Fragment>
            ))}
          </BandScroller>
        ) : (
          <div
            role="region"
            aria-label="Mods band"
            // The band takes the keyboard on a click or Tab, and its Buttons' hotkeys with it.
            tabIndex={0}
            className="max-h-40 min-w-0 flex-1 overflow-x-hidden overflow-y-auto rounded-sm focus-ring"
            onKeyDown={(event) => pressHotkey(event, hotkeys, actHere)}
          >
            <ModSiteContext.Provider value="band">
              {/* A new page fades in over the old one's place: short, and none with reduced motion. */}
              <div
                key={book.index}
                className="motion-safe:animate-in motion-safe:fade-in duration-(--dur-fast)"
              >
                {rowsOf(blocks).map((row, index) => (
                  <Row key={index} row={row} act={actHere} />
                ))}
              </div>
            </ModSiteContext.Provider>
          </div>
        )}
        {/* Centred on the first row, as the composer's other strip controls sit on theirs. */}
        <div className={`${ROW} shrink-0`}>
          {book.count > 1 && !collapsed && (
            <BandPager
              index={book.index}
              count={book.count}
              mods={page?.mods ?? []}
              step={book.step}
            />
          )}
          <IconButton
            size="xs"
            aria-label={collapsed ? 'Expand the band' : 'Collapse the band'}
            tooltip={collapsed ? 'Expand the band' : 'Collapse the band'}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <ChevronsUpDown /> : <ChevronsDownUp />}
          </IconButton>
        </div>
      </div>
    </div>
  )
}
