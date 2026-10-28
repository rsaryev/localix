import { useEffect, useEffectEvent, useRef, type RefObject } from 'react'
import { StickyNote, Type } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { MarkdownRenderer } from '@localixai/kit/markdown'
import { ActionSurfaceProvider } from '@localixai/mini-app-sdk/ui'
import type { SpaceColor } from '../../shared/format/schema'
import { toggleTask } from '../../shared/content/rich-text'
import type { NOTE_SIZES } from '../../shared/types/drawing'
import type { TextAlign, TextFont, TextValign } from '../../shared/types/text-style'
import { defineView, type ElementViewProps } from './contract'
import { colorControl, sizeControl } from './controls'
import { useFitFont } from './fit-text'
import { InlineText } from './InlineText'
import { RichText } from './RichText'
import {
  ALIGN_CLASS,
  alignControl,
  FONT_CLASS,
  fontControl,
  inkControl,
  textStyleClass,
  VALIGN_CLASS,
  valignControl,
} from './text-style'

/**
 * Sticky notes and free text. Each draws its content only; the node around it does selection,
 * resizing and connectors (see `contract.ts`).
 */
type NoteProps = {
  text: string
  color: SpaceColor
  size: (typeof NOTE_SIZES)[number]
  font: TextFont
  align: TextAlign
  valign: TextValign
}
const NOTE_SIZE: Record<Exclude<NoteProps['size'], 'auto'>, string> = {
  sm: 'text-base',
  md: 'text-xl',
  lg: 'text-2xl',
  xl: 'text-3xl',
}

/**
 * A sticky note: its text with its marks, set in the note's face and place. `auto` (a new note's
 * size) fits the text to the note as it grows, like writing smaller to fit a paper note; a fixed
 * size keeps the size and scrolls. A ticked task box is an edit of the text, one undo step.
 */
function NoteView({
  props,
  editing,
  commit,
  stopEditing,
  width,
  height,
}: ElementViewProps<NoteProps>) {
  const box = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const auto = props.size === 'auto'
  const fitted = useFitFont(box, content, {
    active: auto && !editing,
    key: `${props.text}|${props.font}|${width}x${height}`,
  })
  const typography = cn(
    props.size === 'auto' ? undefined : NOTE_SIZE[props.size],
    'leading-[1.35] text-inherit',
    FONT_CLASS[props.font],
    ALIGN_CLASS[props.align],
  )
  const fontSize = auto ? { fontSize: fitted } : undefined
  return (
    <div
      className={cn(
        'space-note flex h-full w-full flex-col overflow-hidden rounded-sm border p-4',
        `space-tone-${props.color}`,
      )}
    >
      {editing ? (
        <InlineText
          value={props.text}
          onCommit={(text) => commit({ text })}
          onDone={stopEditing}
          className={typography}
          style={fontSize}
          placeholder="Write…"
          formatting
        />
      ) : (
        <div
          ref={box}
          className={cn(
            'nowheel scrollbar-thin flex min-h-0 flex-1 flex-col overscroll-contain',
            auto ? 'overflow-hidden' : 'overflow-y-auto',
          )}
        >
          <div
            ref={content}
            className={cn('break-words', VALIGN_CLASS[props.valign], typography)}
            style={fontSize}
          >
            <RichText
              text={props.text}
              onToggleTask={(line) => commit({ text: toggleTask(props.text, line) })}
            />
          </div>
        </div>
      )}
    </div>
  )
}

type TextProps = {
  text: string
  size: 'sm' | 'md' | 'lg' | 'xl'
  font: TextFont
  align: TextAlign
  ink?: SpaceColor
}
const TEXT_SIZE: Record<TextProps['size'], string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-2xl font-semibold tracking-tight',
  xl: 'text-4xl font-semibold tracking-tight',
}

/**
 * A text element is as tall as what it renders. Its height was GUESSED when it was placed — 24px
 * per source line — and rendered Markdown is no source line: a `[!STATS]` row of five lines drew
 * as a grid of cards three times that tall, clipped at the guess. So the rendered height is
 * measured and written back, trailing so a resize drag or a loading image settles first.
 */
const FIT_SETTLE_MS = 250
const FIT_TOLERANCE_PX = 4

function useFitHeight(
  content: RefObject<HTMLDivElement | null>,
  {
    width,
    height,
    active,
    resize,
  }: Pick<ElementViewProps, 'width' | 'height' | 'resize'> & {
    /** Rendered text is on screen — not the editor, not the empty placeholder. */
    active: boolean
  },
) {
  const latest = useEffectEvent(() => ({ width, height, resize }))
  useEffect(() => {
    const node = content.current
    if (!active || !node) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const fit = () => {
      const needed = Math.max(24, Math.ceil(node.offsetHeight))
      const now = latest()
      if (Math.abs(needed - now.height) > FIT_TOLERANCE_PX) now.resize({ w: now.width, h: needed })
    }
    const observer = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(fit, FIT_SETTLE_MS)
    })
    observer.observe(node)
    return () => {
      observer.disconnect()
      clearTimeout(timer)
    }
  }, [content, active])
}

function TextView({
  props,
  editing,
  commit,
  stopEditing,
  width,
  height,
  resize,
}: ElementViewProps<TextProps>) {
  const content = useRef<HTMLDivElement>(null)
  useFitHeight(content, { width, height, resize, active: !editing && Boolean(props.text) })
  if (editing)
    return (
      <InlineText
        value={props.text}
        onCommit={(text) => commit({ text })}
        onDone={stopEditing}
        className={cn(TEXT_SIZE[props.size], textStyleClass(props))}
        placeholder="Text, Markdown allowed"
        formatting
      />
    )
  return (
    <div
      className={cn(
        'h-full w-full overflow-hidden text-foreground',
        TEXT_SIZE[props.size],
        textStyleClass(props),
      )}
    >
      {props.text ? (
        // The text is the element's store: a ticked checklist box is an edit of it, one undo step.
        <div
          ref={content}
          // Contain child margins: without this, the first form's margin escapes the measured
          // box and shifts its last line below the element's clipped edge.
          className="flow-root"
          onDoubleClick={(event) => {
            // Reading a tree, switching tabs or ticking a box must not also open the source
            // editor. Ordinary prose still bubbles to the node's double-click-to-edit.
            if (
              (event.target as Element).closest(
                'a, button, input, select, [role="tree"], [role="button"], [role="region"]',
              )
            )
              event.stopPropagation()
          }}
        >
          <ActionSurfaceProvider surface="board.element">
            <MarkdownRenderer onSourceChange={(text) => commit({ text })}>
              {props.text}
            </MarkdownRenderer>
          </ActionSurfaceProvider>
        </div>
      ) : (
        <span className="text-text-faint">Text</span>
      )}
    </div>
  )
}

export const drawingViews = [
  defineView({
    type: 'note',
    View: NoteView,
    Icon: StickyNote,
    editable: true,
    chrome: 'bare',
    insert: { order: 0, key: 'n', primary: true, description: 'Capture an idea on a sticky note' },
    controls: [
      colorControl,
      fontControl,
      sizeControl(['auto', 'sm', 'md', 'lg', 'xl']),
      alignControl,
      valignControl,
    ],
  }),
  defineView({
    type: 'text',
    View: TextView,
    Icon: Type,
    editable: true,
    chrome: 'bare',
    insert: {
      order: 1,
      key: 't',
      primary: true,
      description: 'Add text or a heading to the board',
    },
    controls: [fontControl, sizeControl(['sm', 'md', 'lg', 'xl']), alignControl, inkControl],
  }),
]
