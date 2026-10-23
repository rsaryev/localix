import type { ReaderPreferences } from './model'
import { ReaderAppearanceMenu } from './ReaderAppearanceMenu'
import { ReaderReadingToolsMenu } from './ReaderReadingToolsMenu'
import type { useReaderAutoScroll } from './useReaderAutoScroll'
import type { useReaderSpeedReading } from './useReaderSpeedReading'

/** The toolbar's trailing menus: appearance, and the reading tools a format allows. */
export function ReaderPaneToolMenus({
  preferences,
  setPreferences,
  fixedPageDocument,
  autoScroll,
  speed,
  parallel,
  onViewModeChange,
}: {
  preferences: ReaderPreferences
  setPreferences: (next: ReaderPreferences) => void
  fixedPageDocument: boolean
  autoScroll: ReturnType<typeof useReaderAutoScroll>
  speed: ReturnType<typeof useReaderSpeedReading>
  parallel: { onRead?: () => void; active: boolean }
  onViewModeChange: (viewMode: ReaderPreferences['viewMode']) => void
}) {
  const { autoScrollActive, autoScrollPaused, setAutoScrollPaused } = autoScroll
  return (
    <>
      <ReaderAppearanceMenu preferences={preferences} onChange={setPreferences} />
      {(!fixedPageDocument || parallel.onRead) && (
        <ReaderReadingToolsMenu
          triggerRef={speed.speedReadingTriggerRef}
          fixedPageDocument={fixedPageDocument}
          viewMode={preferences.viewMode}
          focusMode={preferences.focusMode}
          autoScrollActive={autoScrollActive}
          autoScrollPaused={autoScrollPaused}
          speedReadingWpm={preferences.speedReadingWpm}
          speedReadingAvailable={Boolean(speed.speedTokens.length)}
          parallelAvailable={Boolean(parallel.onRead)}
          parallelActive={parallel.active}
          onViewModeChange={onViewModeChange}
          onFocusModeChange={(focusMode) => setPreferences({ ...preferences, focusMode })}
          onToggleAutoScroll={() => {
            if (!autoScrollActive) autoScroll.startAutoScroll()
            else setAutoScrollPaused((value) => !value)
          }}
          onStopAutoScroll={autoScroll.stopAutoScroll}
          onStartSpeedReading={speed.startSpeedReading}
          onToggleParallel={() => parallel.onRead?.()}
        />
      )}
    </>
  )
}
