import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@localixai/kit/button'
import { Kbd } from '@localixai/kit/kbd'
import { ActionTooltip } from '@localixai/kit/tooltip'
import type { ModAction, ModElement } from '@/shared/api/modsApi'
import { summaryOf, type BandBlock } from './bandLayout'
import { BandScroller } from './BandScroller'
import { text } from './ModControls'
import { ModTree } from './ModTree'

/**
 * The rows of the band above the prompt box (`ModBand.tsx`): consecutive lines share one row that
 * scrolls sideways, a list of picks is a row of quiet chips with their keycaps, anything else is
 * drawn as it is. A line too long for its room ends in an ellipsis, its whole text in a tooltip.
 */

type Act = (action: ModAction) => void

/** Consecutive lines share one row; every other block is a row of its own. */
type LineBlock = Extract<BandBlock, { kind: 'line' }>
type BandRow = { kind: 'lines'; blocks: LineBlock[] } | { kind: 'block'; block: BandBlock }

export function rowsOf(blocks: readonly BandBlock[]): BandRow[] {
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
export const ROW = 'flex min-h-7 min-w-0 items-center'

/**
 * A pick in a list: the band's one button style (a ghost action, soft fill on hover) with the
 * kit's keycap after its label. A long label truncates; the whole of it is in the tooltip.
 */
function Choice({ button, act }: { button: ModElement; act: Act }) {
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

/**
 * One line of a row. Its text shrinks before its controls and ends in an ellipsis where the room
 * ends, rather than being cut at the edge; once cut short, its whole text is its tooltip.
 */
function Line({ block, act }: { block: LineBlock; act: Act }) {
  const ref = useRef<HTMLDivElement>(null)
  const [cut, setCut] = useState(false)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = () =>
      setCut(
        [node, ...node.querySelectorAll<HTMLElement>('span, div')].some(
          (part) => part.scrollWidth > part.clientWidth + 1,
        ),
      )
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [block])
  const line: ReactNode = (
    <div
      ref={ref}
      data-slot="mods-band-line"
      // The band's inset stands in for a top-level row's own side padding; its text truncates.
      className="flex max-w-[min(32rem,100%)] min-w-0 items-center gap-2 overflow-hidden [&_button]:shrink-0 [&_div]:min-w-0 [&_span]:min-w-0 [&_span]:overflow-hidden [&_span]:text-ellipsis [&_span]:whitespace-pre! [&>div]:px-0!"
    >
      <ModTree nodes={block.nodes} act={act} />
    </div>
  )
  return cut ? (
    <ActionTooltip label={block.summary}>
      <div className="min-w-0">{line}</div>
    </ActionTooltip>
  ) : (
    <div className="min-w-0">{line}</div>
  )
}

export function Row({ row, act }: { row: BandRow; act: Act }) {
  if (row.kind === 'lines')
    return (
      <BandScroller
        label="Mods band line"
        className={`${ROW} gap-3`}
        // New words start the row at its left edge again, never mid-scroll under its fade.
        resetKey={row.blocks.map((block) => block.summary).join('\u0000')}
      >
        {row.blocks.map((block, index) => (
          <Fragment key={index}>
            {index > 0 && <span aria-hidden="true" className="h-3.5 w-px bg-border-faint" />}
            <Line block={block} act={act} />
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
        <BandScroller label="Mods band choices" className="flex-1" resetKey={block.summary}>
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
