import { EyeOff, Pilcrow, Ruler } from 'lucide-react'
import type { MenuSubmenuEntry } from '@localixai/mini-app-sdk/ui'

import { choiceSubmenu, type ReaderMenuChoice } from './choiceSubmenu'
import type { ReaderFocusMode } from './model'

/**
 * The ONE presentation of reading focus.
 *
 * The defect it stops: the same setting was offered in two menus under two vocabularies — "Off /
 * Paragraph / Ruler" in the appearance panel and "Off / Follow paragraph / Reading ruler" in the
 * reading tools — so a reader met one mode under two names. Both menus build their row from here.
 */
export const READER_FOCUS_CHOICES: readonly ReaderMenuChoice<ReaderFocusMode>[] = [
  { value: 'off', label: 'Off', description: 'The whole page at full strength', icon: EyeOff },
  {
    value: 'paragraph',
    label: 'Follow paragraph',
    description: 'Dims every paragraph but the one in focus',
    icon: Pilcrow,
  },
  {
    value: 'ruler',
    label: 'Reading ruler',
    description: 'A band across the page that follows the pointer',
    icon: Ruler,
  },
]

/** The "Reading focus ▸" row, its hint the current mode. */
export function readingFocusSubmenu(
  current: ReaderFocusMode,
  onPick: (mode: ReaderFocusMode) => void,
): MenuSubmenuEntry {
  return choiceSubmenu({
    id: 'reading-focus',
    label: 'Reading focus',
    icon: READER_FOCUS_CHOICES.find((choice) => choice.value === current)?.icon,
    current,
    choices: READER_FOCUS_CHOICES,
    onPick,
  })
}
