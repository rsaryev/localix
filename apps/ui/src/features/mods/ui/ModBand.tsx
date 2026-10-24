import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { Kbd } from '@localixai/kit/kbd'
import { ActionTooltip } from '@localixai/kit/tooltip'
import type { ModAction, ModElement } from '@/shared/api/modsApi'
import { bandLayout, summaryOf, type BandBlock } from './bandLayout'
import { BandScroller } from './BandScroller'
import { text } from './ModControls'
import { ModSiteContext } from './modSite'
import { ModTree } from './ModTree'
import { hotkeysOf, pressHotkey } from './siteHotkeys'

/**
 * The band above the prompt box, as Claude Code draws its `AbovePrompt` site, drawn as part of the
 * composer rather than a strip bolted onto it: on the composer's own surface (no fill of its own),
 * inset to the composer's 12px padding, with one hairline between it and the input. The mods' tree
 * is at strip density (`modStyle.ts`), laid out by its shape (`bandLayout.ts`) — lines side by
 * side in a row that scrolls sideways, a list of picks as a row of quiet chips with their keycaps,
 * anything else as drawn — in rows of one 28px height, a capped height that scrolls, and one
 * ghost collapse control centred on the first row.
 *
 * Its Buttons' hotkeys work while the band holds the focus. A digit hotkey also answers a digit
 * typed alone into the empty prompt box, once the person pauses: the digit goes, the Button is
 * pressed. Collapsed, the band is one row of what each part says, and nothing presses in it.
 */

/** How long the box must hold the digit alone before it presses the band's Button. */
const DIGIT_PAUSE_MS = 600

const setFieldValue = (field: HTMLTextAreaElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

export interface ModBandProps {
  tree: Array<ModElement | string>
  act: (action: ModAction) => void
  /** Runs `run` once the person paused; injected by tests. */
  afterPause?: (run: () => void) => () => void
}

const pauseThen = (run: () => void) => {
  const timer = setTimeout(run, DIGIT_PAUSE_MS)
  return () => clearTimeout(timer)
}

/** Consecutive lines share one row; every other block is a row of its own. */
type LineBlock = Extract<BandBlock, { kind: 'line' }>
type BandRow = { kind: 'lines'; blocks: LineBlock[] } | { kind: 'block'; block: BandBlock }

function rowsOf(blocks: readonly BandBlock[]): BandRow[] {
  const rows: BandRow[] = []
  for (const block of blocks) {
    const last = rows.at(-1)
    if (block.kind === 'line' && last?.kind === 'lines') last.blocks.push(block)
    else if (block.kind === 'line') rows.push({ kind: 'lines', blocks: [block] })
    else rows.push({ kind: 'block', block })
  }
  return rows
}

/** One row of the band: the composer strips' 28px row, its content centred on it. */
const ROW = 'flex min-h-7 min-w-0 items-center'

/**
 * A pick in a list: the band's one button style (a ghost action, soft fill on hover) with the
 * kit's keycap after its label. A long label truncates; the whole of it is in the tooltip.
 */
function Choice({ button, act }: { button: ModElement; act: ModBandProps['act'] }) {
  const hotkey = typeof button.props.hotkey === 'string' ? button.props.hotkey : undefined
  const label =
    typeof button.props.label === 'string' ? button.props.label : summaryOf(button.children)
  return (
    <ActionTooltip label={label}>
      <Button
        size="xs"
        variant="ghost"
        className="max-w-64 gap-1.5 font-normal text-text-soft"
        aria-keyshortcuts={hotkey}
        onClick={() => act({ kind: 'press', element: text(button.props.key) })}
      >
        <span className="min-w-0 truncate">{label}</span>
        {hotkey && <Kbd>{hotkey}</Kbd>}
      </Button>
    </ActionTooltip>
  )
}

function Row({ row, act }: { row: BandRow; act: ModBandProps['act'] }) {
  if (row.kind === 'lines')
    return (
      <BandScroller label="Mods band line" className={`${ROW} gap-3`}>
        {row.blocks.map((block, index) => (
          <Fragment key={index}>
            {index > 0 && <span aria-hidden="true" className="h-3.5 w-px bg-border-faint" />}
            {/* The band's inset stands in for a top-level row's own side padding. */}
            <div className="flex max-w-[min(32rem,100%)] min-w-0 items-center gap-2 overflow-hidden [&_span]:whitespace-pre! [&>div]:px-0!">
              <ModTree nodes={block.nodes} act={act} />
            </div>
          </Fragment>
        ))}
      </BandScroller>
    )
  const { block } = row
  if (block.kind === 'choices')
    return (
      <div className={`${ROW} gap-2`}>
        {/* The list's label (`next:`) is a muted label beside the picks, not a heading. */}
        {block.label && (
          <span className="shrink-0 text-2xs text-text-faint [&_span]:text-inherit!">
            <ModTree nodes={block.label} act={act} />
          </span>
        )}
        <BandScroller label="Mods band choices" className="flex-1">
          {block.buttons.map((button, index) => (
            <Choice key={text(button.props.key, String(index))} button={button} act={act} />
          ))}
        </BandScroller>
      </div>
    )
  return (
    <div className="min-w-0 py-1">
      <ModTree nodes={block.nodes} act={act} />
    </div>
  )
}

export function ModBand({ tree, act, afterPause = pauseThen }: ModBandProps) {
  const [collapsed, setCollapsed] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const hotkeys = useMemo(() => hotkeysOf(tree), [tree])
  const blocks = useMemo(() => bandLayout(tree), [tree])
  const latest = useRef({ hotkeys, act, collapsed, afterPause })
  useLayoutEffect(() => {
    latest.current = { hotkeys, act, collapsed, afterPause }
  })

  // A digit alone in this composer's empty prompt box answers the band's Button on that digit.
  useEffect(() => {
    const shell = root.current?.closest('[data-agent-link-drop-target]')
    if (!shell) return
    let cancel: (() => void) | undefined
    const onInput = (event: Event) => {
      cancel?.()
      const field = event.target
      if (!(field instanceof HTMLTextAreaElement) || !shell.contains(field)) return
      const { hotkeys: keys, collapsed: folded, afterPause: wait } = latest.current
      const digit = field.value
      if (folded || !/^[0-9]$/.test(digit) || !keys.has(digit)) return
      cancel = wait(() => {
        if (field.value !== digit) return
        setFieldValue(field, '')
        latest.current.act({ kind: 'press', element: keys.get(digit)! })
      })
    }
    shell.addEventListener('input', onInput)
    return () => {
      cancel?.()
      shell.removeEventListener('input', onInput)
    }
  }, [])

  return (
    // Inset to the composer's own padding, so the band's text starts where the input's does.
    <div ref={root} className="shrink-0 px-3 text-2xs text-text-soft">
      <div
        data-slot="mods-band-seam"
        className="flex items-start gap-1 border-b border-border-faint py-0.5"
      >
        {collapsed ? (
          <BandScroller label="Mods band, collapsed" className={`${ROW} flex-1 -ml-2`}>
            {blocks.map((block, index) => (
              <ActionTooltip key={index} label={block.summary}>
                <Button
                  size="xs"
                  variant="ghost"
                  className="max-w-56 font-normal text-text-faint"
                  onClick={() => setCollapsed(false)}
                >
                  <span className="min-w-0 truncate">{block.summary}</span>
                </Button>
              </ActionTooltip>
            ))}
          </BandScroller>
        ) : (
          <div
            role="region"
            aria-label="Mods band"
            // The band takes the keyboard on a click or Tab, and its Buttons' hotkeys with it.
            tabIndex={0}
            className="max-h-40 min-w-0 flex-1 overflow-y-auto rounded-sm focus-ring"
            onKeyDown={(event) => pressHotkey(event, hotkeys, act)}
          >
            <ModSiteContext.Provider value="band">
              {rowsOf(blocks).map((row, index) => (
                <Row key={index} row={row} act={act} />
              ))}
            </ModSiteContext.Provider>
          </div>
        )}
        {/* Centred on the first row, as the composer's other strip controls sit on theirs. */}
        <div className={`${ROW} shrink-0`}>
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
