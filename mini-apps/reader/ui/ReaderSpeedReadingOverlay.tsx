import type { Dispatch, SetStateAction } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { WorkbenchStatusBar, WorkbenchStatusItem } from '@localixai/kit/workbench-statusbar'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'

import { focusOnMount } from './focusOnMount'
import type { ReaderPreferences, ReaderSpeedToken } from './model'
import { readerSpeedTokenParts, readerSpeedWpmStep } from './readerPaneModel'

/** One word at a time over the reading surface, with its own controls and status. */
export function ReaderSpeedReadingOverlay({
  chapterTitle,
  preferences,
  setPreferences,
  tokens,
  tokenIndex,
  setTokenIndex,
  playing,
  setPlaying,
  onExit,
}: {
  chapterTitle: string
  preferences: ReaderPreferences
  setPreferences: (preferences: ReaderPreferences) => void
  tokens: ReaderSpeedToken[]
  tokenIndex: number
  setTokenIndex: Dispatch<SetStateAction<number>>
  playing: boolean
  setPlaying: Dispatch<SetStateAction<boolean>>
  onExit: () => void
}) {
  const token = tokens[tokenIndex]
  if (!token) return null
  const [before, focus, after] = readerSpeedTokenParts(token)
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- delegated keys: Escape, Space and the arrows come from the focused controls inside; the region is the focus scope that reads them
    <div
      className="reader-speed-reading absolute inset-0 z-(--z-controls) flex flex-col bg-[var(--reader-paper)]"
      role="region"
      aria-label={`Speed reading — ${chapterTitle}`}
      data-font-family={preferences.fontFamily}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onExit()
          return
        }
        if (event.key === ' ') {
          event.preventDefault()
          setPlaying((value) => !value)
          return
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          setPlaying(false)
          setTokenIndex((value) =>
            Math.max(0, Math.min(tokens.length - 1, value + (event.key === 'ArrowRight' ? 1 : -1))),
          )
          return
        }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          setPreferences({
            ...preferences,
            speedReadingWpm: readerSpeedWpmStep(
              preferences.speedReadingWpm,
              event.key === 'ArrowUp' ? 1 : -1,
            ),
          })
        }
      }}
    >
      <WorkbenchToolbar
        as="header"
        aria-label="Speed reading"
        className="border-[var(--reader-rule)]"
      >
        <WorkbenchToolbarSection className="min-w-0 flex-1">
          <div className="min-w-0">
            <div className="truncate text-xs font-medium">{chapterTitle}</div>
            <div className="text-2xs tabular-nums text-text-faint">
              {preferences.speedReadingWpm} words/min
            </div>
          </div>
        </WorkbenchToolbarSection>
        <WorkbenchToolbarSection align="end">
          <IconButton
            onClick={onExit}
            aria-label="Exit speed reading"
            tooltip="Exit speed reading (Esc)"
          >
            <X />
          </IconButton>
        </WorkbenchToolbarSection>
      </WorkbenchToolbar>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-4">
        <div className="reader-speed-guide" aria-hidden="true" />
        <div className="reader-speed-word" aria-hidden="true">
          <span>{before}</span>
          <span className="text-[var(--reader-accent)]">{focus}</span>
          <span>{after}</span>
        </div>
        <span className="sr-only">
          Visual speed reading mode. Use Space to pause, arrow keys to navigate or change pace, and
          Escape to return to the book.
        </span>
        <div className="flex items-center gap-1" role="group" aria-label="Speed reading controls">
          <IconButton
            disabled={tokenIndex <= 0}
            onClick={() => {
              setPlaying(false)
              setTokenIndex((value) => Math.max(0, value - 1))
            }}
            aria-label="Previous word"
            tooltip="Previous word (Left arrow)"
          >
            <ChevronLeft />
          </IconButton>
          <IconButton
            emphasis="solid"
            ref={focusOnMount}
            onClick={() => setPlaying((value) => !value)}
            aria-label={playing ? 'Pause speed reading' : 'Resume speed reading'}
            tooltip={playing ? 'Pause (Space)' : 'Resume (Space)'}
          >
            {playing ? <Pause /> : <Play />}
          </IconButton>
          <IconButton
            disabled={tokenIndex >= tokens.length - 1}
            onClick={() => {
              setPlaying(false)
              setTokenIndex((value) => Math.min(tokens.length - 1, value + 1))
            }}
            aria-label="Next word"
            tooltip="Next word (Right arrow)"
          >
            <ChevronRight />
          </IconButton>
        </div>
      </div>
      <WorkbenchStatusBar aria-label="Speed reading status" className="border-[var(--reader-rule)]">
        <WorkbenchStatusItem className="tabular-nums">
          {tokenIndex + 1} / {tokens.length}
        </WorkbenchStatusItem>
        <WorkbenchStatusItem className="ml-auto">
          Space pause · ↑↓ pace · Esc exit
        </WorkbenchStatusItem>
      </WorkbenchStatusBar>
    </div>
  )
}
