import {
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  CaseSensitive,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
} from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { SpaceColor } from '../../shared/format/schema'
import type { TextAlign, TextFont, TextValign } from '../../shared/types/text-style'
import type { ElementControl } from './contract'

/**
 * The text style vocabulary (`shared/types/text-style.ts`) as classes and as the bar's controls.
 * A face is a role resolved in `space-text.css`, so the board never ships a font file and a theme can
 * retune a face without touching a view.
 */
export const FONT_CLASS: Record<TextFont, string> = {
  sans: 'space-font-sans',
  serif: 'space-font-serif',
  mono: 'space-font-mono',
  hand: 'space-font-hand',
}

export const ALIGN_CLASS: Record<TextAlign, string> = {
  start: 'text-start',
  center: 'text-center',
  end: 'text-end',
}

/**
 * Where a block of text sits from top to bottom, as auto margins on the text inside a flex
 * column. Margins, not `justify-content`: text taller than its box then starts at the top and
 * scrolls, where a centred overflow would push its first lines out of reach above the box.
 */
export const VALIGN_CLASS: Record<TextValign, string> = {
  top: 'mb-auto',
  middle: 'my-auto',
  bottom: 'mt-auto',
}

export interface TextStyleProps {
  font?: TextFont
  align?: TextAlign
  ink?: SpaceColor
}

/** The classes a text box takes for its face, alignment and ink. */
export const textStyleClass = ({ font = 'sans', align = 'start', ink }: TextStyleProps) =>
  cn(FONT_CLASS[font], ALIGN_CLASS[align], ink && `space-ink space-tone-${ink}`)

/** A face's sample, set in the face itself, where a menu row draws its icon. */
const sample = (font: TextFont) =>
  function FontSample({ className }: { className?: string }) {
    return (
      <span
        aria-hidden
        className={cn(
          className,
          FONT_CLASS[font],
          'inline-flex w-auto items-center justify-center text-xs leading-none',
        )}
      >
        Aa
      </span>
    )
  }

export const fontControl: ElementControl = {
  kind: 'choice',
  prop: 'font',
  label: 'Font',
  Icon: CaseSensitive,
  group: 'text',
  options: [
    { value: 'sans', label: 'Sans', Icon: sample('sans') },
    { value: 'serif', label: 'Serif', Icon: sample('serif') },
    { value: 'mono', label: 'Mono', Icon: sample('mono') },
    { value: 'hand', label: 'Handwritten', Icon: sample('hand') },
  ],
}

export const alignControl: ElementControl = {
  kind: 'choice',
  prop: 'align',
  label: 'Align',
  group: 'text',
  options: [
    { value: 'start', label: 'Left', Icon: TextAlignStart },
    { value: 'center', label: 'Centre', Icon: TextAlignCenter },
    { value: 'end', label: 'Right', Icon: TextAlignEnd },
  ],
}

export const valignControl: ElementControl = {
  kind: 'choice',
  prop: 'valign',
  label: 'Vertical align',
  group: 'text',
  options: [
    { value: 'top', label: 'Top', Icon: AlignVerticalJustifyStart },
    { value: 'middle', label: 'Middle', Icon: AlignVerticalJustifyCenter },
    { value: 'bottom', label: 'Bottom', Icon: AlignVerticalJustifyEnd },
  ],
}

export const inkControl: ElementControl = {
  kind: 'color',
  prop: 'ink',
  label: 'Text colour',
  group: 'text',
}
