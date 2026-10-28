import { BookOpen, Ellipsis, ScrollText } from 'lucide-react'
import type { Ref } from 'react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'

import { IconButton } from '@localixai/kit/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'

import { choiceSubmenu, type ReaderMenuChoice } from './choiceSubmenu'
import type { ReaderFocusMode, ReaderViewMode } from './model'
import { readingFocusSubmenu } from './readingFocus'

export interface ReaderReadingToolsMenuProps {
  triggerRef?: Ref<HTMLButtonElement>
  fixedPageDocument: boolean
  viewMode: ReaderViewMode
  focusMode: ReaderFocusMode
  autoScrollActive: boolean
  autoScrollPaused: boolean
  speedReadingWpm: number
  speedReadingAvailable: boolean
  parallelAvailable: boolean
  parallelActive: boolean
  onViewModeChange: (mode: ReaderViewMode) => void
  onFocusModeChange: (mode: ReaderFocusMode) => void
  onToggleAutoScroll: () => void
  onStopAutoScroll: () => void
  onStartSpeedReading: () => void
  onToggleParallel: () => void
}

const LAYOUTS: readonly ReaderMenuChoice<ReaderViewMode>[] = [
  {
    value: 'scroll',
    label: 'Continuous scroll',
    description: 'One long column per chapter',
    icon: ScrollText,
  },
  { value: 'page', label: 'Pages', description: 'Turn the chapter page by page', icon: BookOpen },
]

function readingToolsEntries({
  fixedPageDocument,
  viewMode,
  focusMode,
  autoScrollActive,
  autoScrollPaused,
  speedReadingWpm,
  speedReadingAvailable,
  parallelAvailable,
  parallelActive,
  onViewModeChange,
  onFocusModeChange,
  onToggleAutoScroll,
  onStopAutoScroll,
  onStartSpeedReading,
  onToggleParallel,
}: Omit<ReaderReadingToolsMenuProps, 'triggerRef'>): MenuEntry[] {
  // A fixed-page document (a comic) has no reflowable text to lay out, focus or play back.
  const readingModes: MenuEntry[] = fixedPageDocument
    ? []
    : [
        choiceSubmenu({
          id: 'layout',
          label: 'Layout',
          icon: LAYOUTS.find((layout) => layout.value === viewMode)?.icon,
          current: viewMode,
          choices: LAYOUTS,
          onPick: onViewModeChange,
        }),
        readingFocusSubmenu(focusMode, onFocusModeChange),
        { separator: true },
        { header: 'Playback' },
        ...(viewMode === 'scroll'
          ? [
              {
                id: 'auto-scroll',
                label: !autoScrollActive
                  ? 'Start auto-scroll'
                  : autoScrollPaused
                    ? 'Resume auto-scroll'
                    : 'Pause auto-scroll',
                hint: autoScrollActive ? 'Space' : 'Shift+A',
                onSelect: onToggleAutoScroll,
              },
            ]
          : []),
        ...(autoScrollActive
          ? [
              {
                id: 'stop-auto-scroll',
                label: 'Stop auto-scroll',
                hint: 'Esc',
                onSelect: onStopAutoScroll,
              },
            ]
          : []),
        {
          id: 'speed-reading',
          label: 'Speed reading…',
          hint: `${speedReadingWpm} wpm`,
          disabled: !speedReadingAvailable,
          onSelect: onStartSpeedReading,
        },
      ]
  return [
    ...readingModes,
    { separator: true },
    ...(parallelAvailable
      ? [
          {
            id: 'parallel',
            label: parallelActive ? 'Close parallel reader' : 'Open parallel reader',
            onSelect: onToggleParallel,
          },
        ]
      : []),
  ]
}

/**
 * Secondary reading modes live behind one stable toolbar affordance. Keeping this
 * component presentation-only prevents the Reader toolbar from knowing how any
 * mode stores progress, drives playback, or opens a second pane.
 */
export function ReaderReadingToolsMenu({ triggerRef, ...menu }: ReaderReadingToolsMenuProps) {
  const active = menu.autoScrollActive || menu.focusMode !== 'off' || menu.parallelActive

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          ref={triggerRef}
          aria-label="Reading tools"
          tooltip="Reading tools"
          // A running mode keeps the trigger engaged — the same step IconButton gives an open menu.
          className={active ? 'bg-surface-active text-foreground' : undefined}
        >
          <Ellipsis />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <MenuEntries entries={readingToolsEntries(menu)} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
