import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronUp, Minus } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { Kbd } from '@localixai/kit/kbd'
import type { ModAction, ModElement } from '@/shared/api/modsApi'
import { bandLayout, summaryOf, type BandBlock } from './bandLayout'
import { BandScroller } from './BandScroller'
import { text } from './ModControls'
import { ModSiteContext } from './modStyle'
import { ModTree } from './ModTree'
import { hotkeysOf, pressHotkey } from './siteHotkeys'

/**
 * The band above the prompt box, as Claude Code draws its `AbovePrompt` site, presented as one of
 * the composer's header strips: the mods' tree at strip density (`modStyle.ts`), laid out by its
 * shape (`bandLayout.ts`) — lines side by side in a row that scrolls sideways, a list of picks as a
 * row of chips with their keys, anything else as drawn — rows divided by hairlines, a capped height
 * that scrolls, and one collapse control at the strip's action place.
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

/** A pick in a list: a compact chip with its key, pressed as the mod's Button. */
function Choice({ button, act }: { button: ModElement; act: ModBandProps['act'] }) {
  const hotkey = typeof button.props.hotkey === 'string' ? button.props.hotkey : undefined
  const label =
    typeof button.props.label === 'string' ? button.props.label : summaryOf(button.children)
  return (
    <Button
      size="xs"
      variant="secondary"
      className="max-w-64 gap-1.5 text-xs font-normal text-text-soft hover:text-foreground"
      aria-keyshortcuts={hotkey}
      title={label}
      onClick={() => act({ kind: 'press', element: text(button.props.key) })}
    >
      <span className="min-w-0 truncate">{label}</span>
      {hotkey && <Kbd>{hotkey}</Kbd>}
    </Button>
  )
}

function Row({ row, act }: { row: BandRow; act: ModBandProps['act'] }) {
  if (row.kind === 'lines')
    return (
      <BandScroller label="Mods band line" className="min-h-7 gap-3 py-0.5 pl-3">
        {row.blocks.map((block, index) => (
          <Fragment key={index}>
            {index > 0 && <span aria-hidden="true" className="h-3.5 w-px bg-border-faint" />}
            {/* The band's gutter stands in for a top-level row's own side padding. */}
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
      <div className="flex min-h-7 min-w-0 items-center gap-2 py-0.5 pl-3">
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
    <div className="min-w-0 py-1.5 pl-3">
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
    <div
      ref={root}
      // The composer strips' surface and seam (`WorkbenchNoticeBar`): one band of the header
      // stack, divided from the input below it.
      className="flex shrink-0 items-start gap-2 border-b border-border-soft bg-foreground/[0.04] pr-1.5 text-xs text-text-soft"
    >
      {collapsed ? (
        <BandScroller label="Mods band, collapsed" className="min-h-7 flex-1 py-0.5 pl-1.5">
          {blocks.map((block, index) => (
            <Button
              key={index}
              size="xs"
              variant="ghost"
              className="max-w-56 font-normal text-text-faint"
              title={block.summary}
              onClick={() => setCollapsed(false)}
            >
              <span className="min-w-0 truncate">{block.summary}</span>
            </Button>
          ))}
        </BandScroller>
      ) : (
        <div
          role="region"
          aria-label="Mods band"
          // The band takes the keyboard on a click or Tab, and its Buttons' hotkeys with it.
          tabIndex={0}
          className="max-h-40 min-w-0 flex-1 divide-y divide-border-faint overflow-y-auto rounded-sm focus-ring"
          onKeyDown={(event) => pressHotkey(event, hotkeys, act)}
        >
          <ModSiteContext.Provider value="band">
            {rowsOf(blocks).map((row, index) => (
              <Row key={index} row={row} act={act} />
            ))}
          </ModSiteContext.Provider>
        </div>
      )}
      <IconButton
        size="xs"
        className="mt-1 shrink-0"
        aria-label={collapsed ? 'Expand the band' : 'Collapse the band'}
        tooltip={collapsed ? 'Expand the band' : 'Collapse the band'}
        onClick={() => setCollapsed((value) => !value)}
      >
        {collapsed ? <ChevronUp className="size-3" /> : <Minus className="size-3" />}
      </IconButton>
    </div>
  )
}
