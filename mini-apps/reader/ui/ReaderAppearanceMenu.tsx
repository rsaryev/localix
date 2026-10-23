import {
  AArrowDown,
  AArrowUp,
  ALargeSmall,
  ChevronsDown,
  Frame,
  MoveHorizontal,
  RotateCcw,
  TextAlignJustify,
  TextAlignStart,
  Type,
  UnfoldVertical,
  Zap,
} from 'lucide-react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'

import { IconButton } from '@localixai/kit/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'

import { choiceSubmenu, type ReaderMenuChoice } from './choiceSubmenu'
import { DEFAULT_READER_PREFERENCES, type ReaderPreferences } from './model'
import { readingFocusSubmenu } from './readingFocus'

/**
 * "Reading appearance" — how the page is set, as the app's menu.
 *
 * The defect it replaces: a popover of eight segmented rows and a pair of Smaller/Larger buttons,
 * a form for what is a set of independent picks. Every row was a different width, the paces wrapped
 * a "Custom 36" segment in beside the presets, and none of it looked like any other menu in the
 * app. Here each dimension is a submenu row whose hint is the current pick; text size steps in
 * place (the menu stays open, its header shows the size), and Reset is the one closing act.
 */

/** The text size range `normalizeReaderPreferences` clamps to. */
const MIN_FONT_SIZE = 14
const MAX_FONT_SIZE = 26

const TYPEFACES: readonly ReaderMenuChoice<ReaderPreferences['fontFamily']>[] = [
  { value: 'sans', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Mono' },
]

const LINE_SPACING: readonly ReaderMenuChoice<number>[] = [
  { value: 1.55, label: 'Compact' },
  { value: 1.75, label: 'Relaxed' },
  { value: 1.95, label: 'Airy' },
]

const TEXT_WIDTHS: readonly ReaderMenuChoice<number>[] = [
  { value: 58, label: 'Narrow', description: 'About 58 characters a line' },
  { value: 70, label: 'Balanced', description: 'About 70 characters a line' },
  { value: 82, label: 'Wide', description: 'About 82 characters a line' },
]

const PAGE_MARGINS: readonly ReaderMenuChoice<ReaderPreferences['pageMargin']>[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'roomy', label: 'Roomy' },
]

const ALIGNMENTS: readonly ReaderMenuChoice<ReaderPreferences['textAlign']>[] = [
  {
    value: 'start',
    label: 'Natural',
    description: 'A ragged edge, as the language reads',
    icon: TextAlignStart,
  },
  {
    value: 'justify',
    label: 'Justified',
    description: 'Flush to both edges',
    icon: TextAlignJustify,
  },
]

/**
 * A pace's presets, plus the stored value when it is none of them.
 *
 * A pace set elsewhere (an older build, a hand-edited preference) must still show as the current
 * pick; dropping it would leave the submenu with no selected row and the hint blank.
 */
function paceChoices(
  presets: ReadonlyArray<{ value: number; label: string }>,
  current: number,
  unit: string,
): ReaderMenuChoice<number>[] {
  const choices = presets.map((preset) => ({ ...preset, description: `${preset.value} ${unit}` }))
  if (!choices.some((choice) => choice.value === current)) {
    choices.push({ value: current, label: `Custom ${current}`, description: `${current} ${unit}` })
    choices.sort((left, right) => left.value - right.value)
  }
  return choices
}

function appearanceEntries(
  preferences: ReaderPreferences,
  onChange: (next: ReaderPreferences) => void,
): MenuEntry[] {
  const set = (patch: Partial<ReaderPreferences>) => onChange({ ...preferences, ...patch })
  const { fontSize } = preferences
  return [
    { header: `Text size · ${fontSize}px` },
    {
      id: 'text-smaller',
      label: 'Smaller',
      icon: AArrowDown,
      keepOpen: true,
      disabled: fontSize <= MIN_FONT_SIZE,
      onSelect: () => set({ fontSize: fontSize - 1 }),
    },
    {
      id: 'text-larger',
      label: 'Larger',
      icon: AArrowUp,
      keepOpen: true,
      disabled: fontSize >= MAX_FONT_SIZE,
      onSelect: () => set({ fontSize: fontSize + 1 }),
    },
    { separator: true },
    choiceSubmenu({
      id: 'typeface',
      label: 'Typeface',
      icon: Type,
      current: preferences.fontFamily,
      choices: TYPEFACES,
      onPick: (fontFamily) => set({ fontFamily }),
    }),
    choiceSubmenu({
      id: 'line-spacing',
      label: 'Line spacing',
      icon: UnfoldVertical,
      current: preferences.lineHeight,
      choices: LINE_SPACING,
      onPick: (lineHeight) => set({ lineHeight }),
    }),
    choiceSubmenu({
      id: 'text-width',
      label: 'Text width',
      icon: MoveHorizontal,
      current: preferences.measure,
      choices: TEXT_WIDTHS,
      onPick: (measure) => set({ measure }),
    }),
    choiceSubmenu({
      id: 'page-margins',
      label: 'Page margins',
      icon: Frame,
      current: preferences.pageMargin,
      choices: PAGE_MARGINS,
      onPick: (pageMargin) => set({ pageMargin }),
    }),
    choiceSubmenu({
      id: 'alignment',
      label: 'Alignment',
      icon: preferences.textAlign === 'justify' ? TextAlignJustify : TextAlignStart,
      current: preferences.textAlign,
      choices: ALIGNMENTS,
      onPick: (textAlign) => set({ textAlign }),
    }),
    readingFocusSubmenu(preferences.focusMode, (focusMode) => set({ focusMode })),
    { separator: true },
    choiceSubmenu({
      id: 'auto-scroll-pace',
      label: 'Auto-scroll pace',
      icon: ChevronsDown,
      current: preferences.autoScrollSpeed,
      choices: paceChoices(
        [
          { value: 16, label: 'Slow' },
          { value: 28, label: 'Steady' },
          { value: 44, label: 'Fast' },
        ],
        preferences.autoScrollSpeed,
        'px per second',
      ),
      onPick: (autoScrollSpeed) => set({ autoScrollSpeed }),
    }),
    choiceSubmenu({
      id: 'speed-reading-pace',
      label: 'Speed reading pace',
      icon: Zap,
      current: preferences.speedReadingWpm,
      choices: paceChoices(
        [
          { value: 200, label: 'Calm' },
          { value: 300, label: 'Steady' },
          { value: 400, label: 'Quick' },
        ],
        preferences.speedReadingWpm,
        'words per minute',
      ),
      onPick: (speedReadingWpm) => set({ speedReadingWpm }),
    }),
    { separator: true },
    {
      id: 'reset',
      label: 'Reset appearance',
      description: 'Uses the app theme and stays on this device',
      icon: RotateCcw,
      // The layout and the highlight colour are not appearance: a reset keeps them.
      onSelect: () =>
        onChange({
          ...DEFAULT_READER_PREFERENCES,
          viewMode: preferences.viewMode,
          highlightColor: preferences.highlightColor,
        }),
    },
  ]
}

export function ReaderAppearanceMenu({
  preferences,
  onChange,
}: {
  preferences: ReaderPreferences
  onChange: (next: ReaderPreferences) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label="Reading appearance" tooltip="Reading appearance">
          <ALargeSmall />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <MenuEntries entries={appearanceEntries(preferences, onChange)} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
